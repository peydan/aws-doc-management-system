import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createApiHandler, ApiHandlerContext } from '../shared/api-handler';
import { DynamoManager } from '../shared/dynamo';
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

    const versions = await DynamoManager.listVersions(documentId);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        document_id: documentId,
        versions: versions.map((v) => ({
          application_version: v.application_version,
          s3_version_id: v.s3_version_id,
          metadata_revision: v.metadata_revision,
          checksum: v.content_checksum,
          state: v.state,
        })),
      }),
    };
  },
  {
    allowedRoles: ['Document.Reader', 'Document.Writer', 'Document.MetadataEditor', 'Document.Admin'],
    handlerName: 'list-versions',
  }
);
