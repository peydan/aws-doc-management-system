import { handler as batchDownloadHandler } from '../../src/query-api/batch-download';
import { DynamoManager } from '../../src/shared/dynamo';
import { S3Manager } from '../../src/shared/s3';
import JSZip from 'jszip';

describe('Batch Document Download & ZIP Export Tests', () => {
  const documentClass = 'loan_agreement';
  const docId1 = 'batch-test-pdf-001';
  const docId2 = 'batch-test-jpg-002';
  const docIdSoftDeleted = 'batch-test-deleted-003';

  beforeAll(async () => {
    process.env.MOCK_STORAGE_BYPASS = 'true';
    process.env.MOCK_AUTH_BYPASS = 'true';

    const sampleJpg = Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
      'base64'
    );
    const samplePdf = Buffer.from('%PDF-1.4 sample pdf content for batch testing', 'utf-8');

    // Document 1: PDF
    await DynamoManager.commitDocumentCreation({
      documentId: docId1,
      documentClass,
      s3Key: `documents/${documentClass}/${docId1}`,
      s3VersionId: 's3-ver-pdf-1',
      annotationEtag: 'etag-pdf-1',
      checksum: 'sha256:11111111pdf',
    });
    await S3Manager.putContent(`documents/${documentClass}/${docId1}`, samplePdf, 'application/pdf');
    await S3Manager.putAnnotation(documentClass, docId1, 's3-ver-pdf-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: docId1,
      document_class: documentClass,
      filename: 'loan_contract.pdf',
      content_type: 'application/pdf',
      content_checksum: 'sha256:11111111pdf',
      application_version: 1,
      metadata_revision: 1,
    });

    // Document 2: JPEG
    await DynamoManager.commitDocumentCreation({
      documentId: docId2,
      documentClass,
      s3Key: `documents/${documentClass}/${docId2}`,
      s3VersionId: 's3-ver-jpg-1',
      annotationEtag: 'etag-jpg-1',
      checksum: 'sha256:22222222jpg',
    });
    await S3Manager.putContent(`documents/${documentClass}/${docId2}`, sampleJpg, 'image/jpeg');
    await S3Manager.putAnnotation(documentClass, docId2, 's3-ver-jpg-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: docId2,
      document_class: documentClass,
      filename: 'id_scan.jpg',
      content_type: 'image/jpeg',
      content_checksum: 'sha256:22222222jpg',
      application_version: 1,
      metadata_revision: 1,
    });

    // Document 3: Soft-Deleted Document
    await DynamoManager.commitDocumentCreation({
      documentId: docIdSoftDeleted,
      documentClass,
      s3Key: `documents/${documentClass}/${docIdSoftDeleted}`,
      s3VersionId: 's3-ver-del-1',
      annotationEtag: 'etag-del-1',
      checksum: 'sha256:33333333del',
    });
    await S3Manager.putContent(`documents/${documentClass}/${docIdSoftDeleted}`, samplePdf, 'application/pdf');
    await S3Manager.putAnnotation(documentClass, docIdSoftDeleted, 's3-ver-del-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: docIdSoftDeleted,
      document_class: documentClass,
      filename: 'deleted.pdf',
      content_type: 'application/pdf',
      content_checksum: 'sha256:33333333del',
      application_version: 1,
      metadata_revision: 1,
    });
    await DynamoManager.setDocumentStatus(docIdSoftDeleted, 'SOFT_DELETED');
  });

  it('successfully creates a ZIP with multiple documents in original format and returns presigned URL', async () => {
    const event: any = {
      requestContext: { requestId: 'req-batch-1' },
      body: JSON.stringify({
        document_ids: [docId1, docId2],
        format: 'original',
        include_metadata: true,
      }),
      headers: {},
    };

    const res = await batchDownloadHandler(event);
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.batch_id).toBeDefined();
    expect(body.download_url).toContain('https://mock-s3-download.local/exports/');
    expect(body.zip_filename).toMatch(/^documents_export_.*\.zip$/);
    expect(body.file_count).toBe(2);
    expect(body.documents).toHaveLength(2);
    expect(body.failed_documents).toHaveLength(0);

    // Verify ZIP content structure in mock storage
    const zipData = await S3Manager.getObjectBuffer(`exports/${body.batch_id}.zip`);
    const unzipped = await JSZip.loadAsync(zipData.body);

    // Should contain original files, metadata files, and manifest.json
    expect(unzipped.file('manifest.json')).not.toBeNull();
    const manifestStr = await unzipped.file('manifest.json')!.async('string');
    const manifest = JSON.parse(manifestStr);
    expect(manifest.successful_count).toBe(2);
    expect(manifest.failed_count).toBe(0);

    // Verify metadata files were included
    expect(unzipped.file(`${docId1.substring(0, 8)}_metadata.json`)).not.toBeNull();
    expect(unzipped.file(`${docId2.substring(0, 8)}_metadata.json`)).not.toBeNull();
  });

  it('converts convertible documents to PDF derivatives when format="pdf"', async () => {
    const event: any = {
      requestContext: { requestId: 'req-batch-pdf' },
      body: JSON.stringify({
        document_ids: [docId1, docId2],
        format: 'pdf',
        include_metadata: false,
      }),
      headers: {},
    };

    const res = await batchDownloadHandler(event);
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.file_count).toBe(2);

    const zipData = await S3Manager.getObjectBuffer(`exports/${body.batch_id}.zip`);
    const unzipped = await JSZip.loadAsync(zipData.body);

    const manifest = JSON.parse(await unzipped.file('manifest.json')!.async('string'));
    expect(manifest.format).toBe('pdf');

    // Both files in zip should have .pdf extension
    const fileNames = Object.keys(unzipped.files).filter((name) => name !== 'manifest.json');
    expect(fileNames.every((f) => f.endsWith('.pdf'))).toBe(true);

    // Metadata JSON should NOT be included
    expect(unzipped.file(`${docId1.substring(0, 8)}_metadata.json`)).toBeNull();
  });

  it('delivers direct binary ZIP when Accept: application/zip is specified', async () => {
    const event: any = {
      requestContext: { requestId: 'req-batch-binary' },
      body: JSON.stringify({
        document_ids: [docId1],
      }),
      headers: {
        Accept: 'application/zip',
      },
    };

    const res = await batchDownloadHandler(event);
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBe(true);
    expect(res.headers?.['Content-Type']).toBe('application/zip');
    expect(res.headers?.['Content-Disposition']).toContain('attachment; filename="documents_export_');

    // Decode binary zip and verify PK magic header
    const zipBuffer = Buffer.from(res.body, 'base64');
    expect(zipBuffer[0]).toBe(0x50); // 'P'
    expect(zipBuffer[1]).toBe(0x4b); // 'K'
    expect(zipBuffer[2]).toBe(0x03);
    expect(zipBuffer[3]).toBe(0x04);
  });

  it('supports granular version selection via items array', async () => {
    const event: any = {
      requestContext: { requestId: 'req-batch-versioned' },
      body: JSON.stringify({
        items: [
          { document_id: docId1, version: 1 },
          { document_id: docId2, version: 1 },
        ],
      }),
      headers: {},
    };

    const res = await batchDownloadHandler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.file_count).toBe(2);
  });

  it('handles partial failures by skipping soft-deleted or non-existent documents', async () => {
    const event: any = {
      requestContext: { requestId: 'req-batch-partial' },
      body: JSON.stringify({
        document_ids: [docId1, docIdSoftDeleted, '00000000-0000-0000-0000-000000000000'],
      }),
      headers: {},
    };

    const res = await batchDownloadHandler(event);
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.file_count).toBe(1);
    expect(body.documents[0].document_id).toBe(docId1);
    expect(body.failed_documents).toHaveLength(2);
    expect(body.failed_documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ document_id: docIdSoftDeleted, reason: 'Document is soft-deleted' }),
        expect.objectContaining({ document_id: '00000000-0000-0000-0000-000000000000' }),
      ])
    );
  });

  it('returns 400 VALIDATION_ERROR when document list is empty', async () => {
    const event: any = {
      requestContext: { requestId: 'req-batch-empty' },
      body: JSON.stringify({
        document_ids: [],
      }),
      headers: {},
    };

    const res = await batchDownloadHandler(event);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when format is invalid', async () => {
    const event: any = {
      requestContext: { requestId: 'req-batch-invalid-fmt' },
      body: JSON.stringify({
        document_ids: [docId1],
        format: 'docx',
      }),
      headers: {},
    };

    const res = await batchDownloadHandler(event);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
