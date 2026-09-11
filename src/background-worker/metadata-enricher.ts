import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3Manager } from '../shared/s3';
import { DynamoManager } from '../shared/dynamo';
import { validateMetadataSchema } from '../shared/validator';
import { enrichMetadataWithBedrock } from '../shared/enricher';
import { Logger } from '../shared/logger';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const AUDIT_BUCKET_NAME = process.env.AUDIT_BUCKET_NAME || 'doc-platform-mvp-audit';

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    let payload: any;
    try {
      payload = JSON.parse(record.body);
    } catch {
      console.warn('Skipping unparseable SQS enrichment message:', record.body);
      continue;
    }

    const { document_id, document_class, s3_version_id, expected_metadata_revision } = payload;

    if (!document_id || !document_class || !s3_version_id) {
      console.warn('Skipping invalid enrichment message payload:', payload);
      continue;
    }

    const expectedRevision = typeof expected_metadata_revision === 'number' ? expected_metadata_revision : 1;

    try {
      // 1. Fetch current canonical metadata from S3 Annotation
      const { metadata: currentMetadata } = await S3Manager.getAnnotation(
        document_class,
        document_id,
        s3_version_id
      );

      // 2. Pre-flight Skip Check:
      // - Explicit client skip flag
      // - If primary domain identifier (e.g. loan_number) is already present
      if (currentMetadata.skip_enrichment === true) {
        Logger.info('Enrichment skipped: client requested skip_enrichment', { document_id });
        continue;
      }

      if (currentMetadata.document_class === 'loan_agreement' && currentMetadata.loan_number) {
        Logger.info('Enrichment skipped: loan_number already present', { document_id });
        continue;
      }

      // 3. Fetch document content from S3 to construct text snippet
      const s3Key = S3Manager.getDocumentKey(document_class, document_id);
      const { body } = await S3Manager.getObjectBuffer(s3Key, s3_version_id);
      const textSnippet = body.toString('utf-8');

      // 4. Invoke Bedrock LLM extraction (Claude 3 Haiku)
      const { enrichedMetadata, auditDetails } = await enrichMetadataWithBedrock(
        textSnippet,
        currentMetadata,
        document_class
      );

      // 5. Bump metadata revision for OCC commit
      const newRevision = expectedRevision + 1;
      enrichedMetadata.metadata_revision = newRevision;
      enrichedMetadata.metadata_updated_at = new Date().toISOString();
      enrichedMetadata.metadata_updated_by = 'system:llm-enricher';
      enrichedMetadata.enrichment_audit = {
        model_id: auditDetails.model_id,
        prompt_tokens: auditDetails.prompt_tokens,
        completion_tokens: auditDetails.completion_tokens,
        total_tokens: auditDetails.total_tokens,
        latency_ms: auditDetails.latency_ms,
        applied_at: new Date().toISOString(),
      };

      // 6. Validate against precompiled Ajv JSON schema
      try {
        validateMetadataSchema(enrichedMetadata);
      } catch (valErr: any) {
        Logger.warn('Enriched metadata failed schema validation. Discarding enrichment.', {
          document_id,
          details: valErr.details || valErr.message,
        });
        continue; // Acknowledge message without retrying
      }

      // 7. Write updated authoritative S3 Annotation first (idempotent, safe to orphan if DynamoDB OCC fails)
      const annotationResult = await S3Manager.putAnnotation(
        document_class,
        document_id,
        s3_version_id,
        enrichedMetadata
      );

      // 8. Commit revision bump to DynamoDB with real eTag and Optimistic Concurrency Control (OCC gate)
      try {
        await DynamoManager.updateMetadataRevision(
          document_id,
          expectedRevision,
          newRevision,
          annotationResult.eTag
        );
      } catch (err: any) {
        if (
          err.name === 'ConditionalCheckFailedException' ||
          err.code === 'ConditionalCheckFailedException' ||
          err.code === 'METADATA_CONFLICT'
        ) {
          Logger.info('Enrichment OCC conflict: document modified concurrently by user. Dropping enrichment.', {
            document_id,
            expectedRevision,
          });
          continue;
        }
        throw err;
      }

      // 9. Write immutable LLM audit log to S3 Audit Bucket
      const datePrefix = new Date().toISOString().substring(0, 10);
      const auditKey = `audit/llm-enrichment/${datePrefix}/${document_id}_rev${newRevision}.json`;
      const auditPayload = {
        event_type: 'METADATA_LLM_ENRICHMENT',
        document_id,
        document_class,
        s3_version_id,
        previous_metadata_revision: expectedRevision,
        new_metadata_revision: newRevision,
        timestamp: new Date().toISOString(),
        llm_details: auditDetails,
        applied_metadata: {
          contains_pii: enrichedMetadata.contains_pii,
          pii_categories: enrichedMetadata.pii_categories,
        },
      };

      try {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: AUDIT_BUCKET_NAME,
            Key: auditKey,
            Body: JSON.stringify(auditPayload, null, 2),
            ContentType: 'application/json',
          })
        );
      } catch (auditErr) {
        Logger.error('Failed to write LLM audit log to S3 audit bucket', auditErr, { document_id });
      }

      Logger.info('LLM metadata enrichment successfully committed', {
        document_id,
        newRevision,
        totalTokens: auditDetails.total_tokens,
      });
    } catch (err: any) {
      Logger.error('Error during document metadata enrichment', err, { document_id });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
