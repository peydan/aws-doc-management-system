import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { validateMetadataSchema } from '../shared/validator';
import { S3Manager } from '../shared/s3';
import { DynamoManager } from '../shared/dynamo';
import { Logger } from '../shared/logger';
import {
  PlatformError,
  ValidationError,
  InlineUploadLimitExceededError,
  ChecksumMismatchError,
} from '../shared/errors';

const INLINE_MAX_BYTES = parseInt(process.env.INLINE_UPLOAD_MAX_BYTES || '4194304', 10);

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Writer', 'Document.Admin']);

    const idempotencyKey = event.headers['Idempotency-Key'] || event.headers['idempotency-key'];
    const clientProvidedSha256 = event.headers['X-Content-SHA256'] || event.headers['x-content-sha256'];
    const metadataHeader = event.headers['X-Document-Metadata'] || event.headers['x-document-metadata'];

    if (!metadataHeader) {
      throw new ValidationError('Missing required header X-Document-Metadata');
    }

    let metadataRaw: Record<string, any>;
    try {
      const decodedStr = Buffer.from(metadataHeader, 'base64').toString('utf-8');
      metadataRaw = JSON.parse(decodedStr.startsWith('{') ? decodedStr : metadataHeader);
    } catch {
      try {
        metadataRaw = JSON.parse(metadataHeader);
      } catch {
        throw new ValidationError('Invalid JSON in X-Document-Metadata header');
      }
    }

    if (!event.body) {
      throw new ValidationError('Binary request body is empty');
    }

    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'utf-8');

    if (bodyBuffer.length > INLINE_MAX_BYTES) {
      throw new InlineUploadLimitExceededError(INLINE_MAX_BYTES);
    }

    const calculatedSha256 = crypto.createHash('sha256').update(bodyBuffer).digest('hex');
    if (clientProvidedSha256 && clientProvidedSha256 !== calculatedSha256 && clientProvidedSha256 !== `sha256:${calculatedSha256}`) {
      throw new ChecksumMismatchError('X-Content-SHA256 header does not match calculated body checksum');
    }

    const documentId = uuidv4();
    const documentClass = metadataRaw.document_class || 'loan_agreement';
    const now = new Date().toISOString();

    const fullMetadata: Record<string, any> = {
      annotation_schema: 'bank.document-metadata/1',
      document_id: documentId,
      document_class: documentClass,
      application_version: 1,
      metadata_revision: 1,
      schema_version: 1,
      document_type: metadataRaw.document_type || 'SIGNED_AGREEMENT',
      customer_id: metadataRaw.customer_id,
      loan_number: metadataRaw.loan_number,
      loan_amount_minor_units: metadataRaw.loan_amount_minor_units,
      currency: metadataRaw.currency || 'ILS',
      loan_type: metadataRaw.loan_type || 'MORTGAGE',
      branch_code: metadataRaw.branch_code,
      signed_date: metadataRaw.signed_date || now.substring(0, 10),
      content_type: event.headers['Content-Type'] || event.headers['content-type'] || 'application/pdf',
      content_length: bodyBuffer.length,
      content_checksum: `sha256:${calculatedSha256}`,
      filename: metadataRaw.filename || `document_${documentId}.pdf`,
      created_at: now,
      created_by: user.userId,
      metadata_updated_at: now,
      metadata_updated_by: user.userId,
    };

    validateMetadataSchema(fullMetadata);

    const s3Key = S3Manager.getDocumentKey(documentClass, documentId);
    const contentResult = await S3Manager.putContent(
      s3Key,
      bodyBuffer,
      fullMetadata.content_type,
      calculatedSha256
    );

    const annotationResult = await S3Manager.putAnnotation(
      documentClass,
      documentId,
      contentResult.versionId,
      fullMetadata
    );

    const docRecord = await DynamoManager.commitDocumentCreation({
      documentId,
      documentClass,
      s3Key,
      s3VersionId: contentResult.versionId,
      annotationEtag: annotationResult.eTag,
      checksum: fullMetadata.content_checksum,
      idempotencyKey,
      clientId: user.userId,
      requestHash: calculatedSha256,
    });

    Logger.info('Inline document upload succeeded', { documentId, version: 1, correlationId });

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: documentId,
        application_version: 1,
        s3_version_id: contentResult.versionId,
        metadata_revision: 1,
        status: 'ACTIVE',
        created_at: now,
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
    Logger.error('Unhandled error in inline upload handler', err, { correlationId });
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
