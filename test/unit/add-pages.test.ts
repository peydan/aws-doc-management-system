import { handler as addPagesHandler } from '../../src/command-api/add-pages';
import { DynamoManager } from '../../src/shared/dynamo';
import { S3Manager } from '../../src/shared/s3';
import { convertImageToPdf } from '../../src/shared/pdf-converter';

describe('Add Pages Command API Unit Tests', () => {
  const documentClass = 'loan_agreement';
  const pdfDocId = 'doc-addpages-pdf-001';
  const imgDocId = 'doc-addpages-img-002';
  const softDeletedDocId = 'doc-addpages-del-003';

  // Minimal valid 1x1 PNG base64
  const samplePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  let samplePdfBase64: string;
  let samplePngBase64: string;

  beforeAll(async () => {
    process.env.MOCK_STORAGE_BYPASS = 'true';
    process.env.MOCK_AUTH_BYPASS = 'true';

    const pdfBuffer = await convertImageToPdf(samplePng, 'image/png');
    samplePdfBase64 = pdfBuffer.toString('base64');
    samplePngBase64 = samplePng.toString('base64');

    // 1. Seed base PDF document (v1)
    const pdfKey = `documents/${documentClass}/${pdfDocId}`;
    await DynamoManager.commitDocumentCreation({
      documentId: pdfDocId,
      documentClass,
      s3Key: pdfKey,
      s3VersionId: 's3-ver-pdf-1',
      annotationEtag: 'etag-pdf-1',
      checksum: 'sha256:abcd1234pdf',
    });
    await S3Manager.putContent(pdfKey, pdfBuffer, 'application/pdf');
    await S3Manager.putAnnotation(documentClass, pdfDocId, 's3-ver-pdf-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: pdfDocId,
      document_class: documentClass,
      content_type: 'application/pdf',
      content_checksum: 'sha256:abcd1234pdf',
      application_version: 1,
      metadata_revision: 1,
      page_count: 1,
    });

    // 2. Seed base Image document (v1)
    const imgKey = `documents/${documentClass}/${imgDocId}`;
    await DynamoManager.commitDocumentCreation({
      documentId: imgDocId,
      documentClass,
      s3Key: imgKey,
      s3VersionId: 's3-ver-img-1',
      annotationEtag: 'etag-img-1',
      checksum: 'sha256:abcd1234img',
    });
    await S3Manager.putContent(imgKey, samplePng, 'image/png');
    await S3Manager.putAnnotation(documentClass, imgDocId, 's3-ver-img-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: imgDocId,
      document_class: documentClass,
      content_type: 'image/png',
      content_checksum: 'sha256:abcd1234img',
      application_version: 1,
      metadata_revision: 1,
    });

    // 3. Seed soft-deleted document
    const delKey = `documents/${documentClass}/${softDeletedDocId}`;
    await DynamoManager.commitDocumentCreation({
      documentId: softDeletedDocId,
      documentClass,
      s3Key: delKey,
      s3VersionId: 's3-ver-del-1',
      annotationEtag: 'etag-del-1',
      checksum: 'sha256:abcd1234del',
    });
    await S3Manager.putContent(delKey, pdfBuffer, 'application/pdf');
    await S3Manager.putAnnotation(documentClass, softDeletedDocId, 's3-ver-del-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: softDeletedDocId,
      document_class: documentClass,
      content_type: 'application/pdf',
      content_checksum: 'sha256:abcd1234del',
      application_version: 1,
      metadata_revision: 1,
    });
    await DynamoManager.setDocumentStatus(softDeletedDocId, 'SOFT_DELETED');
  });

  const createEvent = (docId: string, body: any, headers: Record<string, string> = {}) =>
    ({
      headers: {
        Authorization: 'Bearer mock-token',
        'Content-Type': 'application/json',
        ...headers,
      },
      pathParameters: { document_id: docId },
      body: body ? JSON.stringify(body) : null,
      requestContext: { requestId: 'req-addpages-test-123' },
    } as any);

  it('should successfully append PDF pages to an existing PDF document', async () => {
    const event = createEvent(pdfDocId, {
      pages_base64: samplePdfBase64,
      content_type: 'application/pdf',
      position: 'end',
    });

    const res = await addPagesHandler(event);
    expect(res.statusCode).toBe(201);

    const body = JSON.parse(res.body);
    expect(body.document_id).toBe(pdfDocId);
    expect(body.application_version).toBe(2);
    expect(body.page_count).toBe(2);
    expect(body.pages_added).toBe(1);
    expect(body.metadata_revision).toBe(1);

    // Verify DynamoDB was updated
    const updatedDoc = await DynamoManager.getDocument(pdfDocId);
    expect(updatedDoc.current_application_version).toBe(2);

    // Verify historical version record was created
    const ver2 = await DynamoManager.getVersion(pdfDocId, 2);
    expect(ver2.application_version).toBe(2);

    // Verify S3 annotation updated
    const anno = await S3Manager.getAnnotation(documentClass, pdfDocId, body.s3_version_id);
    expect(anno.metadata.application_version).toBe(2);
    expect(anno.metadata.page_count).toBe(2);
    expect(anno.metadata.content_type).toBe('application/pdf');
  });

  it('should prepend pages when position is "start" incrementing to v3', async () => {
    const event = createEvent(pdfDocId, {
      pages_base64: samplePdfBase64,
      content_type: 'application/pdf',
      position: 'start',
    });

    const res = await addPagesHandler(event);
    expect(res.statusCode).toBe(201);

    const body = JSON.parse(res.body);
    expect(body.application_version).toBe(3);
    expect(body.page_count).toBe(3);
  });

  it('should successfully append an image as a new page to an image-based document', async () => {
    const event = createEvent(imgDocId, {
      pages_base64: samplePngBase64,
      content_type: 'image/png',
    });

    const res = await addPagesHandler(event);
    expect(res.statusCode).toBe(201);

    const body = JSON.parse(res.body);
    expect(body.document_id).toBe(imgDocId);
    expect(body.application_version).toBe(2);
    expect(body.page_count).toBe(2);

    // Check DynamoDB
    const updatedImgDoc = await DynamoManager.getDocument(imgDocId);
    expect(updatedImgDoc.current_application_version).toBe(2);
  });

  it('should return 400 when attempting to add pages to a soft-deleted document', async () => {
    const event = createEvent(softDeletedDocId, {
      pages_base64: samplePdfBase64,
      content_type: 'application/pdf',
    });

    const res = await addPagesHandler(event);
    expect(res.statusCode).toBe(400);

    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Cannot add pages to soft-deleted document');
  });

  it('should return 400 on missing or empty pages_base64', async () => {
    const event = createEvent(pdfDocId, {
      content_type: 'application/pdf',
    });

    const res = await addPagesHandler(event);
    expect(res.statusCode).toBe(400);

    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 on invalid position parameter', async () => {
    const event = createEvent(pdfDocId, {
      pages_base64: samplePdfBase64,
      content_type: 'application/pdf',
      position: 'invalid-position',
    });

    const res = await addPagesHandler(event);
    expect(res.statusCode).toBe(400);
  });

  it('should return 404 when target document does not exist', async () => {
    const event = createEvent('non-existent-doc-id-999', {
      pages_base64: samplePdfBase64,
      content_type: 'application/pdf',
    });

    const res = await addPagesHandler(event);
    expect(res.statusCode).toBe(404);
  });
});
