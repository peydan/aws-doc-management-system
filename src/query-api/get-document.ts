import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { DynamoManager } from '../shared/dynamo';
import { S3Manager } from '../shared/s3';
import { PlatformError, ValidationError, isPlatformError } from '../shared/errors';
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

    const requestedFormat = event.queryStringParameters?.format?.toLowerCase();
    const doc = await DynamoManager.getDocument(documentId);
    const anno = await S3Manager.getAnnotation(doc.document_class, documentId, doc.current_s3_version_id);
    const originalContentType = anno.metadata.content_type || 'application/octet-stream';

    let targetKey = doc.current_s3_key;
    let targetVersionId: string | undefined = doc.current_s3_version_id;
    let deliveryFormat = originalContentType;
    let isDerivative = false;
    let derivativeOrigin: Record<string, any> | undefined;

    if (requestedFormat === 'pdf') {
      if (originalContentType === 'image/jpeg' || originalContentType === 'image/jpg' || originalContentType === 'image/png') {
        targetKey = await S3Manager.getOrCreatePdfDerivative(doc.document_class, doc.current_s3_key, {
          documentId: doc.document_id,
          sourceVersionId: doc.current_s3_version_id,
          sourceChecksum: anno.metadata.content_checksum || '',
          sourceContentType: originalContentType,
          applicationVersion: doc.current_application_version,
        });
        targetVersionId = undefined;
        deliveryFormat = 'application/pdf';
        isDerivative = true;
        derivativeOrigin = {
          source_content_type: originalContentType,
          source_s3_version_id: doc.current_s3_version_id,
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
        document_id: doc.document_id,
        document_class: doc.document_class,
        status: doc.status,
        current_application_version: doc.current_application_version,
        current_s3_version_id: doc.current_s3_version_id,
        current_metadata_revision: doc.current_metadata_revision,
        metadata: anno.metadata,
        delivery_format: deliveryFormat,
        is_derivative: isDerivative,
        ...(derivativeOrigin ? { derivative_origin: derivativeOrigin } : {}),
        download_url: downloadUrl,
        download_url_expires_at: new Date(Date.now() + 900 * 1000).toISOString(),
        created_at: doc.created_at,
        updated_at: doc.updated_at,
      }),
    };
  } catch (err: any) {
    console.error(`[${event.path || 'get-document'}] Error:`, err);
    if (err instanceof PlatformError || isPlatformError(err)) {
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
          message: err?.message || 'An unexpected internal error occurred',
          correlation_id: correlationId,
          retryable: true,
        },
      }),
    };
  }
}
