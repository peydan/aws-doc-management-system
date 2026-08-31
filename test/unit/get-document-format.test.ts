import { handler as getDocumentHandler } from '../../src/query-api/get-document';
import { handler as getDownloadUrlHandler } from '../../src/query-api/get-download-url';
import { handler as getVersionHandler } from '../../src/query-api/get-version';
import { DynamoManager } from '../../src/shared/dynamo';
import { S3Manager } from '../../src/shared/s3';

describe('Document Format Conversion Retrieval Tests', () => {
  const documentClass = 'loan_agreement';
  const jpegDocId = 'doc-test-jpeg-001';
  const pdfDocId = 'doc-test-pdf-002';
  const textDocId = 'doc-test-txt-003';

  beforeAll(async () => {
    process.env.MOCK_STORAGE_BYPASS = 'true';
    process.env.MOCK_AUTH_BYPASS = 'true';

    const sampleJpg = Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
      'base64'
    );
    const samplePng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    // Seed JPEG document
    await DynamoManager.commitDocumentCreation({
      documentId: jpegDocId,
      documentClass: documentClass,
      s3Key: `documents/${documentClass}/${jpegDocId}`,
      s3VersionId: 's3-ver-jpeg-1',
      annotationEtag: 'etag-jpeg-1',
      checksum: 'sha256:abcd1234jpeg',
    });
    await S3Manager.putContent(`documents/${documentClass}/${jpegDocId}`, sampleJpg, 'image/jpeg');
    await S3Manager.putAnnotation(documentClass, jpegDocId, 's3-ver-jpeg-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: jpegDocId,
      document_class: documentClass,
      content_type: 'image/jpeg',
      content_checksum: 'sha256:abcd1234jpeg',
      application_version: 1,
      metadata_revision: 1,
    });

    // Seed PDF document
    await DynamoManager.commitDocumentCreation({
      documentId: pdfDocId,
      documentClass: documentClass,
      s3Key: `documents/${documentClass}/${pdfDocId}`,
      s3VersionId: 's3-ver-pdf-1',
      annotationEtag: 'etag-pdf-1',
      checksum: 'sha256:abcd1234pdf',
    });
    await S3Manager.putAnnotation(documentClass, pdfDocId, 's3-ver-pdf-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: pdfDocId,
      document_class: documentClass,
      content_type: 'application/pdf',
      content_checksum: 'sha256:abcd1234pdf',
      application_version: 1,
      metadata_revision: 1,
    });

    // Seed text document
    await DynamoManager.commitDocumentCreation({
      documentId: textDocId,
      documentClass: documentClass,
      s3Key: `documents/${documentClass}/${textDocId}`,
      s3VersionId: 's3-ver-txt-1',
      annotationEtag: 'etag-txt-1',
      checksum: 'sha256:abcd1234txt',
    });
    await S3Manager.putAnnotation(documentClass, textDocId, 's3-ver-txt-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: textDocId,
      document_class: documentClass,
      content_type: 'text/plain',
      content_checksum: 'sha256:abcd1234txt',
      application_version: 1,
      metadata_revision: 1,
    });
  });

  const createMockEvent = (docId: string, queryParams: Record<string, string> = {}) =>
    ({
      headers: { Authorization: 'Bearer mock-token' },
      pathParameters: { document_id: docId },
      queryStringParameters: queryParams,
      requestContext: { requestId: 'req-mock-123' },
    } as any);

  it('GET /documents/{id} without format returns canonical MIME type and download URL', async () => {
    const res = await getDocumentHandler(createMockEvent(jpegDocId));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.document_id).toBe(jpegDocId);
    expect(body.delivery_format).toBe('image/jpeg');
    expect(body.is_derivative).toBe(false);
    expect(body.download_url).toBeDefined();
  });

  it('GET /documents/{id}?format=pdf converts JPEG to PDF derivative with origin metadata', async () => {
    const res = await getDocumentHandler(createMockEvent(jpegDocId, { format: 'pdf' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.document_id).toBe(jpegDocId);
    expect(body.delivery_format).toBe('application/pdf');
    expect(body.is_derivative).toBe(true);
    expect(body.derivative_origin).toBeDefined();
    expect(body.derivative_origin.source_content_type).toBe('image/jpeg');
    expect(body.derivative_origin.source_s3_version_id).toBe('s3-ver-jpeg-1');
    expect(body.derivative_origin.source_content_checksum).toBe('sha256:abcd1234jpeg');
    expect(body.download_url).toContain('derivatives');
  });

  it('GET /documents/{id}?format=pdf on already-PDF document returns original without derivative wrap', async () => {
    const res = await getDocumentHandler(createMockEvent(pdfDocId, { format: 'pdf' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.document_id).toBe(pdfDocId);
    expect(body.delivery_format).toBe('application/pdf');
    expect(body.is_derivative).toBe(false);
    expect(body.derivative_origin).toBeUndefined();
  });

  it('GET /documents/{id}?format=pdf on unsupported type throws 400 ValidationError', async () => {
    const res = await getDocumentHandler(createMockEvent(textDocId, { format: 'pdf' }));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Format conversion to PDF is only supported for JPEG and PNG');
  });

  it('GET /documents/{id}/download?format=pdf generates presigned derivative URL', async () => {
    const res = await getDownloadUrlHandler(createMockEvent(jpegDocId, { format: 'pdf' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.document_id).toBe(jpegDocId);
    expect(body.delivery_format).toBe('application/pdf');
    expect(body.is_derivative).toBe(true);
    expect(body.download_url).toContain('derivatives');
  });

  it('GET /documents/{id}/versions/{version}?format=pdf handles historical version conversion', async () => {
    const event = {
      ...createMockEvent(jpegDocId, { format: 'pdf' }),
      pathParameters: { document_id: jpegDocId, version: '1' },
    };
    const res = await getVersionHandler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.document_id).toBe(jpegDocId);
    expect(body.delivery_format).toBe('application/pdf');
    expect(body.is_derivative).toBe(true);
    expect(body.derivative_origin.source_s3_version_id).toBe('s3-ver-jpeg-1');
  });
});
