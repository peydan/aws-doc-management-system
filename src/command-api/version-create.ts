import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { S3Manager } from '../shared/s3';
import { DynamoManager, dynamoDocClient, VersionItem } from '../shared/dynamo';
import { UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../shared/logger';
import { PlatformError, ValidationError } from '../shared/errors';

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'doc-platform-mvp-control';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Writer', 'Document.Admin']);

    const documentId = event.pathParameters?.document_id;
    if (!documentId) {
      throw new ValidationError('document_id is required');
    }

    const currentDoc = await DynamoManager.getDocument(documentId);
    const existingAnno = await S3Manager.getAnnotation(currentDoc.document_class, documentId);

    if (!event.body) {
      throw new ValidationError('Binary body for new content version is required');
    }

    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'utf-8');

    const calculatedSha256 = crypto.createHash('sha256').update(bodyBuffer).digest('hex');
    const s3Key = currentDoc.current_s3_key;
    const contentType = event.headers['Content-Type'] || event.headers['content-type'] || currentDoc.current_s3_key.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';

    const contentResult = await S3Manager.putContent(s3Key, bodyBuffer, contentType, calculatedSha256);

    const nextAppVersion = currentDoc.current_application_version + 1;
    const now = new Date().toISOString();

    const newMetadata: Record<string, any> = {
      ...existingAnno.metadata,
      application_version: nextAppVersion,
      metadata_revision: 1,
      content_type: contentType,
      content_length: bodyBuffer.length,
      content_checksum: `sha256:${calculatedSha256}`,
      metadata_updated_at: now,
      metadata_updated_by: user.userId,
    };

    const annotationResult = await S3Manager.putAnnotation(
      currentDoc.document_class,
      documentId,
      contentResult.versionId,
      newMetadata
    );

    const docPk = `DOC#${documentId}`;
    const verItem: VersionItem = {
      pk: docPk,
      sk: `VER#${DynamoManager.padVersion(nextAppVersion)}`,
      application_version: nextAppVersion,
      s3_key: s3Key,
      s3_version_id: contentResult.versionId,
      metadata_revision: 1,
      annotation_etag: annotationResult.eTag,
      content_checksum: `sha256:${calculatedSha256}`,
      state: 'ACTIVE',
    };

    if (process.env.MOCK_STORAGE_BYPASS === 'true') {
      await DynamoManager.commitDocumentCreation({
        documentId,
        documentClass: currentDoc.document_class,
        s3Key,
        s3VersionId: contentResult.versionId,
        annotationEtag: annotationResult.eTag,
        checksum: `sha256:${calculatedSha256}`,
      });
    } else {
      await dynamoDocClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: TABLE_NAME,
                Key: { pk: docPk, sk: 'DOC' },
                UpdateExpression:
                  'SET current_application_version = :nextVer, current_s3_version_id = :s3Ver, current_metadata_revision = :metRev, current_annotation_etag = :etag, updated_at = :now',
                ConditionExpression: 'current_application_version = :currVer',
                ExpressionAttributeValues: {
                  ':nextVer': nextAppVersion,
                  ':s3Ver': contentResult.versionId,
                  ':metRev': 1,
                  ':etag': annotationResult.eTag,
                  ':now': now,
                  ':currVer': currentDoc.current_application_version,
                },
              },
            },
            {
              Put: {
                TableName: TABLE_NAME,
                Item: verItem,
              },
            },
          ],
        })
      );
    }

    Logger.info('New content version created', { documentId, version: nextAppVersion, correlationId });

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: documentId,
        application_version: nextAppVersion,
        s3_version_id: contentResult.versionId,
        metadata_revision: 1,
        created_at: now,
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
    Logger.error('Unhandled error in version create handler', err, { correlationId });
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
