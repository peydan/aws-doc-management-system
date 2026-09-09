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

  const samplePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Synthetic Document) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF', 'utf-8');
  const sampleJpg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64'
  );
  const sampleDocx = Buffer.from(
    'UEsDBBQAAAAIAK9SKV31KchK6wAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCEX8XyFcUOHBBCSXrg5wgcygOs7E1i1X/yuqV9ezZt6QFVPdqz38xoutU+eLHDQi7FXt6rVgqMJlkXp15+r9+bJymoQrTgU8ReHpDkaujWh4wkmI3Uy7nW/Kw1mRkDkEoZIytjKgEqP8ukM5gNTKgf2vZRmxQrxtrUxUMO3SuOsPVVvO35+9SDcSleTndLVC8hZ+8MVJb1ouqrXEFPN8BdtP/aNedmisnjDc0u09054ZOHKc6i+IJSPyCwnf5JxWqbzDZwhLpd9EpeGkdn8MIvbrkkg0S8ePDqogRw8a+HPs49/AJQSwMEFAAAAAgAr1IpXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIAK9SKV3eNMft/AAAAKQBAAARAAAAd29yZC9kb2N1bWVudC54bWyFkM1qwzAQhF9l0Tm1lEBLEbFDGigt+FBI+wCKtXEMktaslLh++/qHuhQKvewiNPPtMNvdp3dwQ44NhVysMyUAQ0W2CXUuPt6f7x4FxGSCNY4C5qLHKHbFttOWqqvHkGAAhKi7XFxSarWUsbqgNzGjFsPwdyb2Jg1PrmVHbFumCmMc+N7JjVIP0psmiBF5ItuPu53GG0/rmHqH0Ombcbl4QTMmWwtZbOWimUYqDuQ9ctUYByWZAPuaEceIozRNBp5ty5HJeZKz/4mYqUPWv/QLHvaVRzgQt8QmDXVBmWz2DzsVcxRP15A0vJZH2KzulVoppf6wyu8S5E/BxRdQSwECFAMUAAAACACvUild9SnISusAAACtAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAK9SKV2b/TfqrQAAACkBAAALAAAAAAAAAAAAAACAARwBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAK9SKV3eNMft/AAAAKQBAAARAAAAAAAAAAAAAACAAfIBAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAAAdAwAAAAA=',
    'base64'
  );

  for (const doc of dataset) {
    let rawBytes = samplePdf;
    if (doc.content_type.includes('wordprocessingml') || doc.content_type.includes('docx')) {
      rawBytes = sampleDocx;
    } else if (doc.content_type === 'image/jpeg' || doc.content_type === 'image/jpg') {
      rawBytes = sampleJpg;
    }
    const checksum = crypto.createHash('sha256').update(rawBytes).digest('hex');
    const now = new Date().toISOString();

    const fullMetadata: Record<string, any> = {
      ...doc,
      annotation_schema: 'bank.document-metadata/1',
      schema_version: 1,
      content_length: rawBytes.length,
      content_checksum: 'sha256:' + checksum,
      created_at: now,
      created_by: 'system-reload-pipeline',
      metadata_updated_at: now,
      metadata_updated_by: 'system-reload-pipeline',
    };

    validateMetadataSchema(fullMetadata);

    const s3Key = S3Manager.getDocumentKey(doc.document_class, doc.document_id);
    const s3Result = await S3Manager.putContent(s3Key, rawBytes, doc.content_type, checksum);

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
