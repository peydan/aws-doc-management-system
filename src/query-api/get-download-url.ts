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
    const doc = await DynamoManager.getDocument(documentId);

    let versionId = doc.current_s3_version_id;
    if (versionQuery) {
      const vNum = parseInt(versionQuery, 10);
      if (!isNaN(vNum)) {
        const verItem = await DynamoManager.getVersion(documentId, vNum);
        versionId = verItem.s3_version_id;
      }
    }

    const downloadUrl = await S3Manager.generatePresignedDownloadUrl(doc.current_s3_key, versionId, 900);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        s3_version_id: versionId,
        download_url: downloadUrl,
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
