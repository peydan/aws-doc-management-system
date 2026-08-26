import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { validateMetadataSchema, parseJsonBody, buildFullMetadata } from '../shared/validator';
import { S3Manager } from '../shared/s3';
import { DynamoManager, UploadSessionItem } from '../shared/dynamo';
import { Logger } from '../shared/logger';
import { PlatformError, ValidationError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Writer', 'Document.Admin']);

    const payload = parseJsonBody(event);
    const documentClass = payload.document_class || 'loan_agreement';
    const filename = payload.filename;
    const contentType = payload.content_type || 'application/pdf';
    const contentLength = payload.content_length;
    const checksum = payload.checksum;
    const clientMetadata = payload.metadata || {};

    if (!filename || !contentLength || !checksum) {
      throw new ValidationError('filename, content_length, and checksum are required');
    }

    const documentId = uuidv4();
    const uploadId = `01J4${uuidv4().replace(/-/g, '').substring(0, 20).toUpperCase()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    const fullMetadata = buildFullMetadata({
      documentId,
      documentClass,
      filename,
      contentType,
      contentLength,
      checksum,
      userId: user.userId,
      clientMetadata,
    });

    validateMetadataSchema(fullMetadata);

    const s3Key = S3Manager.getDocumentKey(documentClass, documentId);
    const presignedUrl = await S3Manager.generatePresignedUploadUrl(s3Key, contentType, 900);

    const sessionItem: UploadSessionItem = {
      pk: `UPLOAD#${uploadId}`,
      sk: 'SESSION',
      upload_id: uploadId,
      document_id: documentId,
      document_class: documentClass,
      filename,
      content_type: contentType,
      content_length: contentLength,
      checksum: fullMetadata.content_checksum,
      metadata: fullMetadata,
      state: 'INITIATED',
      expires_at: expiresAt,
      created_at: now.toISOString(),
    };

    await DynamoManager.createUploadSession(sessionItem);

    Logger.info('Direct upload session initiated', { uploadId, documentId, correlationId });

    return {
      statusCode: 201,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        upload_id: uploadId,
        document_id: documentId,
        upload_method: 'SINGLE_PUT',
        upload_url: presignedUrl,
        required_headers: {
          'content-type': contentType,
        },
        expires_at: expiresAt,
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
    Logger.error('Unhandled error in direct upload init handler', err, { correlationId });
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
