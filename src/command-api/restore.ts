import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createApiHandler, ApiHandlerContext } from '../shared/api-handler';
import { DynamoManager } from '../shared/dynamo';
import { S3Manager } from '../shared/s3';
import { OpenSearchManager } from '../shared/opensearch';
import { Logger } from '../shared/logger';
import { ValidationError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';

export const handler = createApiHandler(
  async (event: APIGatewayProxyEvent, { correlationId }: ApiHandlerContext): Promise<APIGatewayProxyResult> => {
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
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        status: 'ACTIVE',
        updated_at: updatedDoc.updated_at,
      }),
    };
  },
  { allowedRoles: ['Document.Admin'], handlerName: 'restore' }
);
