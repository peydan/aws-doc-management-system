import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { S3Manager } from '../shared/s3';
import { DynamoManager, dynamoDocClient } from '../shared/dynamo';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../shared/logger';
import { PlatformError, ValidationError } from '../shared/errors';

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'doc-platform-mvp-control';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Writer', 'Document.Admin']);

    const uploadId = event.pathParameters?.upload_id;
    if (!uploadId) {
      throw new ValidationError('upload_id path parameter is required');
    }

    const session = await DynamoManager.getUploadSession(uploadId);
    if (session.state !== 'INITIATED') {
      throw new ValidationError(`Upload session ${uploadId} is not in INITIATED state (current: ${session.state})`);
    }

    const s3Key = S3Manager.getDocumentKey(session.document_class, session.document_id);
    const s3Head = await S3Manager.verifyObjectExists(s3Key);

    const annotationResult = await S3Manager.putAnnotation(
      session.document_class,
      session.document_id,
      s3Head.versionId,
      session.metadata
    );

    const docRecord = await DynamoManager.commitDocumentCreation({
      documentId: session.document_id,
      documentClass: session.document_class,
      s3Key,
      s3VersionId: s3Head.versionId,
      annotationEtag: annotationResult.eTag,
      checksum: session.checksum,
    });

    await dynamoDocClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: `UPLOAD#${uploadId}`, sk: 'SESSION' },
        UpdateExpression: 'SET #st = :st',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':st': 'ACTIVE' },
      })
    );

    Logger.info('Direct upload completed successfully', { uploadId, documentId: session.document_id, correlationId });

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: session.document_id,
        application_version: 1,
        s3_version_id: s3Head.versionId,
        metadata_revision: 1,
        status: 'ACTIVE',
        created_at: docRecord.created_at,
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
    Logger.error('Unhandled error in direct upload complete handler', err, { correlationId });
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
