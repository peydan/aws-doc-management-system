import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createApiHandler, ApiHandlerContext } from '../shared/api-handler';
import { validateMetadataSchema, parseJsonBody, getImmutableFields } from '../shared/validator';
import { S3Manager } from '../shared/s3';
import { DynamoManager } from '../shared/dynamo';
import { Logger } from '../shared/logger';
import { ValidationError, MetadataConflictError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';

export const handler = createApiHandler(
  async (event: APIGatewayProxyEvent, { correlationId, user }: ApiHandlerContext): Promise<APIGatewayProxyResult> => {
    const documentId = event.pathParameters?.document_id;
    if (!documentId) {
      throw new ValidationError('document_id path parameter is required');
    }

    const payload = parseJsonBody(event);
    const expectedRevision = payload.expected_metadata_revision;
    const changes = payload.changes || {};

    if (typeof expectedRevision !== 'number') {
      throw new ValidationError('expected_metadata_revision is required and must be an integer');
    }

    const currentDoc = await DynamoManager.getDocument(documentId);
    if (currentDoc.status === 'SOFT_DELETED') {
      throw new ValidationError(`Cannot update metadata on soft-deleted document ${documentId}`);
    }

    // Check for attempts to mutate immutable fields (dynamically loaded from schema)
    const immutableFields = getImmutableFields(currentDoc.document_class);
    for (const key of Object.keys(changes)) {
      if (immutableFields.has(key)) {
        throw new ValidationError(`Field '${key}' is immutable and cannot be updated`);
      }
    }

    if (currentDoc.current_metadata_revision !== expectedRevision) {
      throw new MetadataConflictError(expectedRevision, currentDoc.current_metadata_revision);
    }

    const annoResult = await S3Manager.getAnnotation(
      currentDoc.document_class,
      documentId,
      currentDoc.current_s3_version_id
    );
    const currentMetadata = annoResult.metadata;

    const nextRevision = expectedRevision + 1;
    const now = new Date().toISOString();

    const updatedMetadata: Record<string, any> = {
      ...currentMetadata,
      ...changes,
      metadata_revision: nextRevision,
      metadata_updated_at: now,
      metadata_updated_by: user.userId,
    };

    validateMetadataSchema(updatedMetadata);

    // 1. Write the authoritative S3 annotation first (idempotent; safe to orphan if DynamoDB OCC fails)
    const annotationPut = await S3Manager.putAnnotation(
      currentDoc.document_class,
      documentId,
      currentDoc.current_s3_version_id,
      updatedMetadata
    );

    // 2. Atomically claim the revision in DynamoDB with real annotation eTag (OCC gate)
    await DynamoManager.updateMetadataRevision(
      documentId,
      expectedRevision,
      nextRevision,
      annotationPut.eTag
    );

    Logger.info('Metadata updated successfully', {
      documentId,
      expectedRevision,
      newRevision: nextRevision,
      correlationId,
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        metadata_revision: nextRevision,
        updated_at: now,
        metadata: updatedMetadata,
      }),
    };
  },
  { allowedRoles: ['Document.MetadataEditor', 'Document.Writer', 'Document.Admin'], handlerName: 'metadata-update' }
);
