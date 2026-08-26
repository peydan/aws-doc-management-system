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

    const doc = await DynamoManager.getDocument(documentId);
    const anno = await S3Manager.getAnnotation(doc.document_class, documentId, doc.current_s3_version_id);
    const downloadUrl = await S3Manager.generatePresignedDownloadUrl(doc.current_s3_key, doc.current_s3_version_id, 900);

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
