import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { DynamoManager } from '../shared/dynamo';
import { S3Manager } from '../shared/s3';
import { PlatformError, ValidationError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Reader', 'Document.Writer', 'Document.MetadataEditor', 'Document.Admin']);

    const documentId = event.pathParameters?.document_id;
    const versionStr = event.pathParameters?.version;
    if (!documentId || !versionStr) {
      throw new ValidationError('document_id and version path parameters are required');
    }

    const versionNum = parseInt(versionStr, 10);
    if (isNaN(versionNum)) {
      throw new ValidationError('version parameter must be a valid integer');
    }

    const requestedFormat = event.queryStringParameters?.format?.toLowerCase();
    const doc = await DynamoManager.getDocument(documentId);
    const ver = await DynamoManager.getVersion(documentId, versionNum);

    let targetKey = ver.s3_key;
    let targetVersionId: string | undefined = ver.s3_version_id;
    let deliveryFormat: string | undefined;
    let isDerivative = false;
    let derivativeOrigin: Record<string, any> | undefined;

    if (requestedFormat === 'pdf') {
      const anno = await S3Manager.getAnnotation(doc.document_class, documentId, ver.s3_version_id);
      const originalContentType = anno.metadata.content_type || 'application/octet-stream';

      if (originalContentType === 'image/jpeg' || originalContentType === 'image/jpg' || originalContentType === 'image/png') {
        targetKey = await S3Manager.getOrCreatePdfDerivative(doc.document_class, ver.s3_key, {
          documentId,
          sourceVersionId: ver.s3_version_id,
          sourceChecksum: ver.content_checksum || anno.metadata.content_checksum || '',
          sourceContentType: originalContentType,
          applicationVersion: ver.application_version,
        });
        targetVersionId = undefined;
        deliveryFormat = 'application/pdf';
        isDerivative = true;
        derivativeOrigin = {
          source_content_type: originalContentType,
          source_s3_version_id: ver.s3_version_id,
          source_content_checksum: ver.content_checksum || anno.metadata.content_checksum || '',
          converted_at: new Date().toISOString(),
        };
      } else if (originalContentType === 'application/pdf') {
        deliveryFormat = 'application/pdf';
        isDerivative = false;
      } else {
        throw new ValidationError(
          `Format conversion to PDF is only supported for JPEG and PNG images (current content_type: ${originalContentType})`
        );
      }
    }

    const downloadUrl = await S3Manager.generatePresignedDownloadUrl(targetKey, targetVersionId, 900);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        application_version: ver.application_version,
        s3_version_id: ver.s3_version_id,
        metadata_revision: ver.metadata_revision,
        checksum: ver.content_checksum,
        state: ver.state,
        download_url: downloadUrl,
        ...(deliveryFormat ? { delivery_format: deliveryFormat } : {}),
        is_derivative: isDerivative,
        ...(derivativeOrigin ? { derivative_origin: derivativeOrigin } : {}),
      }),
    };
  } catch (err: any) {
    if (err instanceof PlatformError) {
      return {
        statusCode: err.statusCode,
        headers: CORS_HEADERS,
        body: JSON.stringify(err.toResponse(correlationId)),
      };
    }
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected internal error occurred',
          correlation_id: correlationId,
          retryable: true,
        },
      }),
    };
  }
}
