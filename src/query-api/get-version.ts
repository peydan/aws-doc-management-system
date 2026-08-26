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

    const doc = await DynamoManager.getDocument(documentId);
    const ver = await DynamoManager.getVersion(documentId, versionNum);
    const downloadUrl = await S3Manager.generatePresignedDownloadUrl(ver.s3_key, ver.s3_version_id, 900);

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
