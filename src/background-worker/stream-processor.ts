import { DynamoDBStreamEvent } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });

const AUDIT_BUCKET_NAME = process.env.AUDIT_BUCKET_NAME || 'doc-platform-mvp-audit';
const INDEX_QUEUE_URL = process.env.INDEX_QUEUE_URL || '';

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    if (!record.dynamodb?.NewImage && !record.dynamodb?.OldImage) continue;

    const newImage = record.dynamodb.NewImage ? unmarshall(record.dynamodb.NewImage as any) : null;
    const oldImage = record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage as any) : null;

    const pk = newImage?.pk || oldImage?.pk || '';
    const sk = newImage?.sk || oldImage?.sk || '';

    // Handle Document item updates
    if (pk.startsWith('DOC#') && sk === 'DOC') {
      const documentId = newImage?.document_id || oldImage?.document_id;
      const documentClass = newImage?.document_class || oldImage?.document_class;
      const s3VersionId = newImage?.current_s3_version_id;
      const metadataRevision = newImage?.current_metadata_revision;
      const status = newImage?.status || 'ACTIVE';

      // 1. Audit event log entry to S3 audit bucket
      const auditEvent = {
        event_id: record.eventID,
        event_name: record.eventName,
        timestamp: new Date().toISOString(),
        document_id: documentId,
        document_class: documentClass,
        s3_version_id: s3VersionId,
        metadata_revision: metadataRevision,
        status: status,
      };

      const auditKey = `audit/${new Date().toISOString().substring(0, 10)}/${documentId}_${record.eventID}.json`;
      try {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: AUDIT_BUCKET_NAME,
            Key: auditKey,
            Body: JSON.stringify(auditEvent, null, 2),
            ContentType: 'application/json',
          })
        );
      } catch (err) {
        console.error('Failed to write audit event to S3 audit bucket:', err);
      }

      // 2. Queue message to SQS Index Queue if INDEX_QUEUE_URL is provided
      if (INDEX_QUEUE_URL) {
        const indexMessage = {
          document_id: documentId,
          document_class: documentClass,
          s3_version_id: s3VersionId,
          metadata_revision: metadataRevision,
          status: status,
          timestamp: new Date().toISOString(),
        };

        try {
          await sqsClient.send(
            new SendMessageCommand({
              QueueUrl: INDEX_QUEUE_URL,
              MessageBody: JSON.stringify(indexMessage),
            })
          );
        } catch (err) {
          console.error('Failed to enqueue index message to SQS:', err);
        }
      }
    }
  }
}
