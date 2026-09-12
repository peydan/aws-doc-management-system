import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createApiHandler, ApiHandlerContext } from '../shared/api-handler';
import { DynamoManager, dynamoDocClient } from '../shared/dynamo';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ValidationError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';
import { isMockStorageEnabled } from '../shared/adapters/in-memory-storage';

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'doc-platform-mvp-control';

export const handler = createApiHandler(
  async (event: APIGatewayProxyEvent, _ctx: ApiHandlerContext): Promise<APIGatewayProxyResult> => {
    const uploadId = event.pathParameters?.upload_id;
    if (!uploadId) {
      throw new ValidationError('upload_id is required');
    }

    await DynamoManager.getUploadSession(uploadId);

    if (!isMockStorageEnabled()) {
      await dynamoDocClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: `UPLOAD#${uploadId}`, sk: 'SESSION' },
          UpdateExpression: 'SET #st = :st',
          ExpressionAttributeNames: { '#st': 'state' },
          ExpressionAttributeValues: { ':st': 'ABORTED' },
        })
      );
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ upload_id: uploadId, status: 'ABORTED' }),
    };
  },
  { allowedRoles: ['Document.Writer', 'Document.Admin'], handlerName: 'upload-cancel' }
);
