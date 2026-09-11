import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { S3Manager } from '../shared/s3';
import { DynamoManager } from '../shared/dynamo';
import { validateMetadataSchema } from '../shared/validator';
import { Logger } from '../shared/logger';
import { PlatformError, ValidationError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';
import { detectFileFormat, getPdfPageCount } from '../shared/pdf-converter';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Writer', 'Document.Admin']);

    const documentId = event.pathParameters?.document_id;
    if (!documentId) {
      throw new ValidationError('document_id is required');
    }

    const currentDoc = await DynamoManager.getDocument(documentId);
    if (currentDoc.status === 'SOFT_DELETED') {
      throw new ValidationError(`Cannot create version for soft-deleted document ${documentId}`);
    }

    const existingAnno = await S3Manager.getAnnotation(
      currentDoc.document_class,
      documentId,
      currentDoc.current_s3_version_id
    );

    if (!event.body) {
      throw new ValidationError('Binary body for new content version is required');
    }

    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'utf-8');

    const calculatedSha256 = crypto.createHash('sha256').update(bodyBuffer).digest('hex');
    const s3Key = currentDoc.current_s3_key;
    const contentType = event.headers['Content-Type'] || event.headers['content-type'] || (currentDoc.current_s3_key.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');

    const contentResult = await S3Manager.putContent(s3Key, bodyBuffer, contentType, calculatedSha256);

    const nextAppVersion = currentDoc.current_application_version + 1;
    const now = new Date().toISOString();

    const format = detectFileFormat(contentType, currentDoc.current_s3_key);
    let pageCount: number | undefined;
    if (format === 'pdf') {
      pageCount = await getPdfPageCount(bodyBuffer);
    }

    const newMetadata: Record<string, any> = {
      ...existingAnno.metadata,
      application_version: nextAppVersion,
      metadata_revision: 1,
      content_type: contentType,
      format,
      ...(pageCount !== undefined ? { page_count: pageCount } : {}),
      content_length: bodyBuffer.length,
      content_checksum: `sha256:${calculatedSha256}`,
      metadata_updated_at: now,
      metadata_updated_by: user.userId,
    };
    if (format !== 'pdf') {
      delete newMetadata.page_count;
    }

    validateMetadataSchema(newMetadata);

    const annotationResult = await S3Manager.putAnnotation(
      currentDoc.document_class,
      documentId,
      contentResult.versionId,
      newMetadata
    );

    await DynamoManager.commitNewVersion({
      documentId,
      nextAppVersion,
      expectedAppVersion: currentDoc.current_application_version,
      s3Key,
      s3VersionId: contentResult.versionId,
      annotationEtag: annotationResult.eTag,
      checksum: `sha256:${calculatedSha256}`,
    });

    Logger.info('New content version created', { documentId, version: nextAppVersion, correlationId });

    return {
      statusCode: 201,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        application_version: nextAppVersion,
        s3_version_id: contentResult.versionId,
        metadata_revision: 1,
        format,
        ...(pageCount !== undefined ? { page_count: pageCount } : {}),
        created_at: now,
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
    Logger.error('Unhandled error in version create handler', err, { correlationId });
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
