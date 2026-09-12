import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createApiHandler, ApiHandlerContext } from '../shared/api-handler';
import { DynamoManager } from '../shared/dynamo';
import { S3Manager } from '../shared/s3';
import { ValidationError, NotFoundError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';

export const handler = createApiHandler(
  async (event: APIGatewayProxyEvent, _ctx: ApiHandlerContext): Promise<APIGatewayProxyResult> => {
    const documentId = event.pathParameters?.document_id;
    if (!documentId) {
      throw new ValidationError('document_id is required');
    }

    const doc = await DynamoManager.getDocument(documentId);
    if (doc.status === 'SOFT_DELETED') {
      throw new NotFoundError(`Document ${documentId} not found`);
    }
    const anno = await S3Manager.getAnnotation(doc.document_class, documentId, doc.current_s3_version_id);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        metadata_revision: doc.current_metadata_revision,
        metadata: anno.metadata,
      }),
    };
  },
  {
    allowedRoles: ['Document.Reader', 'Document.Writer', 'Document.MetadataEditor', 'Document.Admin'],
    handlerName: 'get-metadata',
  }
);
