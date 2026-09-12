import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createApiHandler, ApiHandlerContext } from '../shared/api-handler';
import { DynamoManager } from '../shared/dynamo';
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

    const updatedDoc = await DynamoManager.setDocumentStatus(documentId, 'SOFT_DELETED');

    try {
      await OpenSearchManager.removeDocumentProjection(documentId);
    } catch (err) {
      Logger.warn('OpenSearch remove projection non-fatal warning during soft-delete', { documentId, error: err });
    }

    Logger.info('Document soft deleted', { documentId, correlationId });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        status: 'SOFT_DELETED',
        updated_at: updatedDoc.updated_at,
      }),
    };
  },
  { allowedRoles: ['Document.Admin'], handlerName: 'soft-delete' }
);
