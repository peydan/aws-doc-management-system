import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { DynamoManager } from '../shared/dynamo';
import { S3Manager } from '../shared/s3';
import { OpenSearchManager } from '../shared/opensearch';
import { Logger } from '../shared/logger';
import { PlatformError, ValidationError } from '../shared/errors';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Admin']);

    const documentId = event.pathParameters?.document_id;
    if (!documentId) {
      throw new ValidationError('document_id is required');
    }

    const updatedDoc = await DynamoManager.setDocumentStatus(documentId, 'ACTIVE');

    try {
      const annoResult = await S3Manager.getAnnotation(
        updatedDoc.document_class,
        documentId,
        updatedDoc.current_s3_version_id
      );
      await OpenSearchManager.upsertDocumentProjection(annoResult.metadata, 'ACTIVE');
    } catch (err) {
      Logger.warn('OpenSearch re-index warning during restore', { documentId, error: err });
    }

    Logger.info('Document restored', { documentId, correlationId });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: documentId,
        status: 'ACTIVE',
        updated_at: updatedDoc.updated_at,
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
