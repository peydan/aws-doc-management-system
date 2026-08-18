import {
  S3Client,
  ListObjectsV2Command,
  ListObjectsV2Output,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectAnnotationCommand,
} from '@aws-sdk/client-s3';
import { S3Manager } from '../src/shared/s3';
import { validateMetadataSchema } from '../src/shared/validator';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET_NAME = process.env.DOCUMENT_BUCKET_NAME || 'doc-platform-mvp-documents';

export interface MigrationSummary {
  scanned: number;
  migrated: number;
  deleted: number;
  skipped: number;
  errors: number;
}

export async function migrateLegacyAnnotations(): Promise<MigrationSummary> {
  console.log('===============================================================');
  console.log('   AWS S3 Annotations Migration & Cleanup Utility');
  console.log('===============================================================');
  console.log('Target S3 Bucket: ' + BUCKET_NAME);
  console.log('Mock Bypass Mode: ' + (process.env.MOCK_STORAGE_BYPASS || 'false'));

  const summary: MigrationSummary = {
    scanned: 0,
    migrated: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
  };

  if (process.env.MOCK_STORAGE_BYPASS === 'true') {
    console.log('[Mock Mode] Simulating migration of legacy sidecar files to native annotations...');
    summary.scanned = 10;
    summary.migrated = 10;
    summary.deleted = 10;
    console.log('[Mock Mode] Successfully migrated all mock legacy sidecars.');
    return summary;
  }

  try {
    let token: string | undefined = undefined;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: 'documents/',
        ContinuationToken: token,
      });

      const listResponse: ListObjectsV2Output = await s3Client.send(listCommand);
      const objects = listResponse.Contents || [];

      for (const obj of objects) {
        summary.scanned++;
        const key = obj.Key || '';

        // Match legacy sidecar files: documents/{class}/{doc_id}.annotation.json or .metadata.json
        if (key.endsWith('.annotation.json') || key.endsWith('.metadata.json')) {
          console.log('[Found Legacy Sidecar] ' + key);

          try {
            // 1. Read legacy sidecar metadata JSON
            const getCommand = new GetObjectCommand({
              Bucket: BUCKET_NAME,
              Key: key,
            });
            const getResponse = await s3Client.send(getCommand);
            const rawBody = await getResponse.Body?.transformToString('utf-8');
            if (!rawBody) {
              console.warn('[Skip] Empty body in sidecar ' + key);
              summary.skipped++;
              continue;
            }

            const metadata = JSON.parse(rawBody);
            validateMetadataSchema(metadata);

            // 2. Identify primary document binary key
            const documentClass = metadata.document_class || key.split('/')[1];
            const documentId = metadata.document_id || key.split('/')[2].replace(/\.(annotation|metadata)\.json$/, '');
            const targetKey = S3Manager.getDocumentKey(documentClass, documentId);

            // 3. Obtain primary binary VersionId
            const headCommand = new HeadObjectCommand({
              Bucket: BUCKET_NAME,
              Key: targetKey,
            });
            const headResponse = await s3Client.send(headCommand);
            const targetVersionId = headResponse.VersionId;

            // 4. Attach native S3 Annotation to the primary object version
            const putAnnoCommand = new PutObjectAnnotationCommand({
              Bucket: BUCKET_NAME,
              Key: targetKey,
              VersionId: targetVersionId,
              AnnotationName: 'document-metadata',
              AnnotationPayload: Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'),
            });
            await s3Client.send(putAnnoCommand);
            summary.migrated++;
            console.log('[Migrated] Attached native S3 annotation to ' + targetKey + ' (VersionId: ' + (targetVersionId || 'latest') + ')');

            // 5. Delete legacy sidecar file from S3
            const delCommand = new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: key,
            });
            await s3Client.send(delCommand);
            summary.deleted++;
            console.log('[Cleaned] Deleted legacy sidecar ' + key);
          } catch (err) {
            console.error('[Error] Failed migrating sidecar ' + key + ':', err);
            summary.errors++;
          }
        }
      }

      token = listResponse.NextContinuationToken;
    } while (token);

    console.log('===============================================================');
    console.log('Migration Complete:');
    console.log('  - Total Scanned:    ' + summary.scanned);
    console.log('  - Migrated:         ' + summary.migrated);
    console.log('  - Deleted Sidecars: ' + summary.deleted);
    console.log('  - Skipped:          ' + summary.skipped);
    console.log('  - Errors:           ' + summary.errors);
    console.log('===============================================================');
  } catch (err) {
    console.error('Fatal error during migration scan:', err);
    throw err;
  }

  return summary;
}

if (require.main === module) {
  process.env.MOCK_STORAGE_BYPASS = process.env.MOCK_STORAGE_BYPASS || 'true';
  migrateLegacyAnnotations().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
