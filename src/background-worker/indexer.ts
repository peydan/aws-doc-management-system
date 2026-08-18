import { SQSEvent } from 'aws-lambda';
import { S3Manager } from '../shared/s3';
import { DynamoManager } from '../shared/dynamo';
import { OpenSearchManager } from '../shared/opensearch';

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    const payload = JSON.parse(record.body);
    const { document_id, document_class, metadata_revision, status } = payload;

    if (!document_id || !document_class) {
      console.warn('Skipping invalid SQS index message:', record.body);
      continue;
    }

    // Read current DynamoDB pointer to prevent out-of-order index overwrites
    try {
      const currentDoc = await DynamoManager.getDocument(document_id);

      if (status === 'SOFT_DELETED' || currentDoc.status === 'SOFT_DELETED') {
        await OpenSearchManager.removeDocumentProjection(document_id);
        console.log(`OpenSearch index removed for soft-deleted document ${document_id}`);
        continue;
      }

      if (metadata_revision && currentDoc.current_metadata_revision > metadata_revision) {
        console.log(
          `Ignoring stale index message revision ${metadata_revision} for doc ${document_id} (current: ${currentDoc.current_metadata_revision})`
        );
        continue;
      }

      const anno = await S3Manager.getAnnotation(
        document_class,
        document_id,
        currentDoc.current_s3_version_id
      );
      await OpenSearchManager.upsertDocumentProjection(anno.metadata, currentDoc.status);

      console.log(`Successfully indexed document ${document_id} into OpenSearch`);
    } catch (err: any) {
      console.error(`Error indexing document ${document_id}:`, err);
      throw err; // Throw to trigger SQS retry / DLQ routing
    }
  }
}
