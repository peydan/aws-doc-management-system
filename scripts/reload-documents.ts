import * as crypto from 'crypto';
import { generateSyntheticDataset } from './seed-demo-dataset';
import { S3Manager } from '../src/shared/s3';
import { DynamoManager } from '../src/shared/dynamo';
import { validateMetadataSchema } from '../src/shared/validator';

export async function reloadDocuments(count = 25): Promise<{ loaded: number }> {
  console.log('===============================================================');
  console.log('   AWS Document Platform - Clean Ingestion & Reload');
  console.log('===============================================================');
  console.log('Generating and loading ' + count + ' documents with Native AWS S3 Annotations...');

  const dataset = generateSyntheticDataset(count);
  let loadedCount = 0;

  for (const doc of dataset) {
    const fakePdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Synthetic Document) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF', 'utf-8');
    const checksum = crypto.createHash('sha256').update(fakePdfBytes).digest('hex');
    const now = new Date().toISOString();

    const fullMetadata: Record<string, any> = {
      annotation_schema: 'bank.document-metadata/1',
      document_id: doc.document_id,
      document_class: doc.document_class,
      application_version: 1,
      metadata_revision: 1,
      schema_version: 1,
      document_type: doc.document_type,
      customer_id: doc.customer_id,
      loan_number: doc.loan_number,
      loan_amount_minor_units: doc.loan_amount_minor_units,
      currency: doc.currency,
      loan_type: doc.loan_type,
      branch_code: doc.branch_code,
      signed_date: doc.signed_date,
      content_type: doc.content_type,
      content_length: fakePdfBytes.length,
      content_checksum: 'sha256:' + checksum,
      filename: doc.filename,
      created_at: now,
      created_by: 'system-reload-pipeline',
      metadata_updated_at: now,
      metadata_updated_by: 'system-reload-pipeline',
    };

    validateMetadataSchema(fullMetadata);

    const s3Key = S3Manager.getDocumentKey(doc.document_class, doc.document_id);
    const s3Result = await S3Manager.putContent(s3Key, fakePdfBytes, doc.content_type, checksum);

    const annoResult = await S3Manager.putAnnotation(
      doc.document_class,
      doc.document_id,
      s3Result.versionId,
      fullMetadata
    );

    await DynamoManager.commitDocumentCreation({
      documentId: doc.document_id,
      documentClass: doc.document_class,
      s3Key,
      s3VersionId: s3Result.versionId,
      annotationEtag: annoResult.eTag,
      checksum: fullMetadata.content_checksum,
    });

    loadedCount++;
    if (loadedCount % 5 === 0 || loadedCount === count) {
      console.log('Loaded ' + loadedCount + '/' + count + ' documents (Native Annotation Attached)');
    }
  }

  console.log('===============================================================');
  console.log('Successfully reloaded ' + loadedCount + ' documents using Native S3 Annotations!');
  console.log('===============================================================');
  return { loaded: loadedCount };
}

if (require.main === module) {
  process.env.MOCK_STORAGE_BYPASS = process.env.MOCK_STORAGE_BYPASS || 'true';
  reloadDocuments(20).catch(err => {
    console.error('Reload failed:', err);
    process.exit(1);
  });
}
