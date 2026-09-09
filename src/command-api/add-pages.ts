import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { S3Manager } from '../shared/s3';
import { DynamoManager } from '../shared/dynamo';
import { Logger } from '../shared/logger';
import { PlatformError, ValidationError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';
import { validateAddPagesPayload } from '../shared/validator';
import { addPagesToPdf, convertDocumentToPdf, isConvertibleToPdf } from '../shared/pdf-converter';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Writer', 'Document.Admin']);

    const documentId = event.pathParameters?.document_id;
    if (!documentId) {
      throw new ValidationError('document_id is required');
    }

    if (!event.body) {
      throw new ValidationError('Request body is required');
    }

    let parsedBody: any;
    try {
      parsedBody = JSON.parse(event.body);
    } catch {
      throw new ValidationError('Invalid JSON request body');
    }

    const payload = validateAddPagesPayload(parsedBody);

    const currentDoc = await DynamoManager.getDocument(documentId);
    if (currentDoc.status === 'SOFT_DELETED') {
      throw new ValidationError(`Cannot add pages to soft-deleted document ${documentId}`);
    }

    const existingAnno = await S3Manager.getAnnotation(
      currentDoc.document_class,
      documentId,
      currentDoc.current_s3_version_id
    );

    const s3Key = currentDoc.current_s3_key;
    const { body: rawContentBuffer, contentType: rawContentType } = await S3Manager.getObjectBuffer(
      s3Key,
      currentDoc.current_s3_version_id
    );

    const effectiveBaseType = (
      existingAnno.metadata?.content_type ||
      rawContentType ||
      (s3Key.endsWith('.pdf') ? 'application/pdf' : '')
    ).toLowerCase();

    let basePdfBuffer: Buffer;
    if (effectiveBaseType === 'application/pdf' || s3Key.endsWith('.pdf')) {
      basePdfBuffer = rawContentBuffer;
    } else if (isConvertibleToPdf(effectiveBaseType)) {
      basePdfBuffer = await convertDocumentToPdf(rawContentBuffer, effectiveBaseType);
    } else {
      throw new ValidationError(
        `Base document format (${effectiveBaseType}) is not a PDF and cannot be converted to PDF to add pages`
      );
    }

    let donorBuffer: Buffer;
    try {
      donorBuffer = Buffer.from(payload.pages_base64, 'base64');
    } catch {
      throw new ValidationError('Failed to decode base64 donor pages');
    }

    if (donorBuffer.length === 0) {
      throw new ValidationError('Decoded donor pages buffer is empty');
    }

    const addResult = await addPagesToPdf({
      sourcePdfBuffer: basePdfBuffer,
      pagesBuffer: donorBuffer,
      pagesContentType: payload.content_type,
      position: payload.position,
      pageIndices: payload.page_indices,
    });

    const calculatedSha256 = crypto.createHash('sha256').update(addResult.pdfBuffer).digest('hex');
    const contentResult = await S3Manager.putContent(
      s3Key,
      addResult.pdfBuffer,
      'application/pdf',
      calculatedSha256
    );

    const nextAppVersion = currentDoc.current_application_version + 1;
    const now = new Date().toISOString();

    const newMetadata: Record<string, any> = {
      ...existingAnno.metadata,
      application_version: nextAppVersion,
      metadata_revision: 1,
      content_type: 'application/pdf',
      format: 'pdf',
      content_length: addResult.pdfBuffer.length,
      content_checksum: `sha256:${calculatedSha256}`,
      page_count: addResult.pageCountAfter,
      metadata_updated_at: now,
      metadata_updated_by: user.userId,
    };

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

    Logger.info('PDF pages successfully added', {
      documentId,
      version: nextAppVersion,
      pageCountBefore: addResult.pageCountBefore,
      pageCountAfter: addResult.pageCountAfter,
      pagesAdded: addResult.pagesAdded,
      correlationId,
    });

    return {
      statusCode: 201,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        application_version: nextAppVersion,
        s3_version_id: contentResult.versionId,
        format: 'pdf',
        page_count: addResult.pageCountAfter,
        pages_added: addResult.pagesAdded,
        metadata_revision: 1,
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
    Logger.error('Unhandled error in add-pages handler', err, { correlationId });
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected internal error occurred while adding pages to PDF',
          correlation_id: correlationId,
          retryable: true,
        },
      }),
    };
  }
}
