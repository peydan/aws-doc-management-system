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
    if (!documentId) {
      throw new ValidationError('document_id is required');
    }

    const versionQuery = event.queryStringParameters?.version;
    const requestedFormat = event.queryStringParameters?.format?.toLowerCase();
    const doc = await DynamoManager.getDocument(documentId);

    let versionId = doc.current_s3_version_id;
    let appVersion = doc.current_application_version;
    let s3Key = doc.current_s3_key;

    if (versionQuery) {
      const vNum = parseInt(versionQuery, 10);
      if (!isNaN(vNum)) {
        const verItem = await DynamoManager.getVersion(documentId, vNum);
        versionId = verItem.s3_version_id;
        appVersion = verItem.application_version;
        s3Key = verItem.s3_key || doc.current_s3_key;
      }
    }

    let targetKey = s3Key;
    let targetVersionId: string | undefined = versionId;
    let deliveryFormat: string | undefined;
    let isDerivative = false;
    let derivativeOrigin: Record<string, any> | undefined;

    if (requestedFormat === 'pdf') {
      const anno = await S3Manager.getAnnotation(doc.document_class, documentId, versionId);
      const originalContentType = anno.metadata.content_type || 'application/octet-stream';

      if (originalContentType === 'image/jpeg' || originalContentType === 'image/jpg' || originalContentType === 'image/png') {
        targetKey = await S3Manager.getOrCreatePdfDerivative(doc.document_class, s3Key, {
          documentId,
          sourceVersionId: versionId,
          sourceChecksum: anno.metadata.content_checksum || '',
          sourceContentType: originalContentType,
          applicationVersion: appVersion,
        });
        targetVersionId = undefined;
        deliveryFormat = 'application/pdf';
        isDerivative = true;
        derivativeOrigin = {
          source_content_type: originalContentType,
          source_s3_version_id: versionId,
          source_content_checksum: anno.metadata.content_checksum || '',
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
        s3_version_id: versionId,
        download_url: downloadUrl,
        ...(deliveryFormat ? { delivery_format: deliveryFormat } : {}),
        is_derivative: isDerivative,
        ...(derivativeOrigin ? { derivative_origin: derivativeOrigin } : {}),
        expires_at: new Date(Date.now() + 900 * 1000).toISOString(),
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
