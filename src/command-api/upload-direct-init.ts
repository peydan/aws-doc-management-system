import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { validateMetadataSchema, parseJsonBody } from '../shared/validator';
import { S3Manager } from '../shared/s3';
import { DynamoManager, UploadSessionItem } from '../shared/dynamo';
import { Logger } from '../shared/logger';
import { PlatformError, ValidationError } from '../shared/errors';

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

    const fullMetadata: Record<string, any> = {
      annotation_schema: 'bank.document-metadata/1',
      document_id: documentId,
      document_class: documentClass,
      application_version: 1,
      metadata_revision: 1,
      schema_version: 1,
      document_type: clientMetadata.document_type || 'SIGNED_AGREEMENT',
      customer_id: clientMetadata.customer_id,
      loan_number: clientMetadata.loan_number,
      loan_amount_minor_units: clientMetadata.loan_amount_minor_units,
      currency: clientMetadata.currency || 'ILS',
      loan_type: clientMetadata.loan_type || 'MORTGAGE',
      branch_code: clientMetadata.branch_code,
      signed_date: clientMetadata.signed_date || now.toISOString().substring(0, 10),
      content_type: contentType,
      content_length: contentLength,
      content_checksum: checksum.startsWith('sha256:') ? checksum : `sha256:${checksum}`,
      filename: filename,
      created_at: now.toISOString(),
      created_by: user.userId,
      metadata_updated_at: now.toISOString(),
      metadata_updated_by: user.userId,
    };

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
      headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(err.toResponse(correlationId)),
      };
    }
    Logger.error('Unhandled error in direct upload init handler', err, { correlationId });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
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
