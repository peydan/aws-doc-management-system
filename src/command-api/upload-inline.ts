import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { validateMetadataSchema, buildFullMetadata } from '../shared/validator';
import { S3Manager } from '../shared/s3';
import { DynamoManager } from '../shared/dynamo';
import { Logger } from '../shared/logger';
import {
  PlatformError,
  ValidationError,
  InlineUploadLimitExceededError,
  ChecksumMismatchError,
} from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';

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
    const contentType = event.headers['Content-Type'] || event.headers['content-type'] || 'application/pdf';
    const filename = metadataRaw.filename || `document_${documentId}.pdf`;

    const fullMetadata = buildFullMetadata({
      documentId,
      documentClass,
      filename,
      contentType,
      contentLength: bodyBuffer.length,
      checksum: calculatedSha256,
      userId: user.userId,
      clientMetadata: metadataRaw,
    });

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
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        application_version: 1,
        s3_version_id: contentResult.versionId,
        metadata_revision: 1,
        status: 'ACTIVE',
        created_at: fullMetadata.created_at,
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
    Logger.error('Unhandled error in inline upload handler', err, { correlationId });
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
