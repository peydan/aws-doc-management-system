import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { validateMetadataSchema, parseJsonBody } from '../shared/validator';
import { S3Manager } from '../shared/s3';
import { DynamoManager } from '../shared/dynamo';
import { Logger } from '../shared/logger';
import { PlatformError, ValidationError, MetadataConflictError } from '../shared/errors';

const IMMUTABLE_FIELDS = new Set([
  'document_id',
  'document_class',
  'application_version',
  'schema_version',
  'annotation_schema',
  'content_type',
  'content_length',
  'content_checksum',
  'created_at',
  'created_by',
]);

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.MetadataEditor', 'Document.Writer', 'Document.Admin']);

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

    // Check for attempts to mutate immutable fields
    for (const key of Object.keys(changes)) {
      if (IMMUTABLE_FIELDS.has(key)) {
        throw new ValidationError(`Field '${key}' is immutable and cannot be updated`);
      }
    }

    const currentDoc = await DynamoManager.getDocument(documentId);
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

    const annotationPut = await S3Manager.putAnnotation(
      currentDoc.document_class,
      documentId,
      currentDoc.current_s3_version_id,
      updatedMetadata
    );

    const updatedDoc = await DynamoManager.updateMetadataRevision(
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: documentId,
        metadata_revision: nextRevision,
        updated_at: now,
        metadata: updatedMetadata,
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
    Logger.error('Unhandled error in metadata update handler', err, { correlationId });
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
