import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { createApiHandler, getHeader, ApiHandlerContext } from '../shared/api-handler';
import { validateMetadataSchema, buildFullMetadata } from '../shared/validator';
import { S3Manager } from '../shared/s3';
import { DynamoManager } from '../shared/dynamo';
import { Logger } from '../shared/logger';
import {
  ValidationError,
  InlineUploadLimitExceededError,
  ChecksumMismatchError,
} from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';
import { detectFileFormat, getPdfPageCount } from '../shared/pdf-converter';

const INLINE_MAX_BYTES = parseInt(process.env.INLINE_UPLOAD_MAX_BYTES || '4194304', 10);

export const handler = createApiHandler(
  async (event: APIGatewayProxyEvent, { correlationId, user }: ApiHandlerContext): Promise<APIGatewayProxyResult> => {
    const idempotencyKey = getHeader(event, 'Idempotency-Key');
    const clientProvidedSha256 = getHeader(event, 'X-Content-SHA256');
    const metadataHeader = getHeader(event, 'X-Document-Metadata');

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

    if (idempotencyKey) {
      const existing = await DynamoManager.checkOrSetIdempotency(
        user.userId,
        idempotencyKey,
        calculatedSha256
      );
      if (existing && existing.status === 'COMPLETED' && existing.response_summary) {
        Logger.info('Idempotent request: returning cached response', { idempotencyKey, correlationId });
        return {
          statusCode: 201,
          headers: CORS_HEADERS,
          body: JSON.stringify(existing.response_summary),
        };
      }
    }

    const documentClass = metadataRaw.document_class;
    if (!documentClass) {
      throw new ValidationError('document_class is required in metadata');
    }

    const documentId = uuidv4();
    const contentType = getHeader(event, 'Content-Type') || 'application/octet-stream';
    const filename = metadataRaw.filename || 'document.bin';

    const format = detectFileFormat(contentType, filename);
    let pageCount: number | undefined;
    if (format === 'pdf') {
      try {
        pageCount = await getPdfPageCount(bodyBuffer);
      } catch {
        pageCount = undefined;
      }
    }

    const fullMetadata = buildFullMetadata({
      documentId,
      documentClass,
      filename,
      contentType,
      contentLength: bodyBuffer.length,
      checksum: `sha256:${calculatedSha256}`,
      userId: user.userId,
      clientMetadata: metadataRaw,
      format,
      pageCount,
    });

    validateMetadataSchema(fullMetadata);

    const s3Key = S3Manager.getDocumentKey(documentClass, documentId);

    const contentResult = await S3Manager.putContent(
      s3Key,
      bodyBuffer,
      contentType,
      calculatedSha256
    );

    const annotationResult = await S3Manager.putAnnotation(
      documentClass,
      documentId,
      contentResult.versionId,
      fullMetadata
    );

    await DynamoManager.commitDocumentCreation({
      documentId,
      documentClass,
      s3Key,
      s3VersionId: contentResult.versionId,
      annotationEtag: annotationResult.eTag,
      checksum: `sha256:${calculatedSha256}`,
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
        format,
        ...(pageCount !== undefined ? { page_count: pageCount } : {}),
        created_at: fullMetadata.created_at,
      }),
    };
  },
  { allowedRoles: ['Document.Writer', 'Document.Admin'], handlerName: 'upload-inline' }
);
