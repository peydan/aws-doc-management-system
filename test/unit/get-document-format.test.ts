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
  const docxDocId = 'doc-test-docx-004';
  const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  beforeAll(async () => {
    process.env.MOCK_STORAGE_BYPASS = 'true';
    process.env.MOCK_AUTH_BYPASS = 'true';

    const sampleJpg = Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
      'base64'
    );
    const sampleDocx = Buffer.from(
      'UEsDBBQAAAAIAK9SKV31KchK6wAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCEX8XyFcUOHBBCSXrg5wgcygOs7E1i1X/yuqV9ezZt6QFVPdqz38xoutU+eLHDQi7FXt6rVgqMJlkXp15+r9+bJymoQrTgU8ReHpDkaujWh4wkmI3Uy7nW/Kw1mRkDkEoZIytjKgEqP8ukM5gNTKgf2vZRmxQrxtrUxUMO3SuOsPVVvO35+9SDcSleTndLVC8hZ+8MVJb1ouqrXEFPN8BdtP/aNedmisnjDc0u09054ZOHKc6i+IJSPyCwnf5JxWqbzDZwhLpd9EpeGkdn8MIvbrkkg0S8ePDqogRw8a+HPs49/AJQSwMEFAAAAAgAr1IpXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIAK9SKV3eNMft/AAAAKQBAAARAAAAd29yZC9kb2N1bWVudC54bWyFkM1qwzAQhF9l0Tm1lEBLEbFDGigt+FBI+wCKtXEMktaslLh++/qHuhQKvewiNPPtMNvdp3dwQ44NhVysMyUAQ0W2CXUuPt6f7x4FxGSCNY4C5qLHKHbFttOWqqvHkGAAhKi7XFxSarWUsbqgNzGjFsPwdyb2Jg1PrmVHbFumCmMc+N7JjVIP0psmiBF5ItuPu53GG0/rmHqH0Ombcbl4QTMmWwtZbOWimUYqDuQ9ctUYByWZAPuaEceIozRNBp5ty5HJeZKz/4mYqUPWv/QLHvaVRzgQt8QmDXVBmWz2DzsVcxRP15A0vJZH2KzulVoppf6wyu8S5E/BxRdQSwECFAMUAAAACACvUild9SnISusAAACtAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAK9SKV2b/TfqrQAAACkBAAALAAAAAAAAAAAAAACAARwBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAK9SKV3eNMft/AAAAKQBAAARAAAAAAAAAAAAAACAAfIBAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAAAdAwAAAAA=',
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

    // Seed DOCX document
    await DynamoManager.commitDocumentCreation({
      documentId: docxDocId,
      documentClass: documentClass,
      s3Key: `documents/${documentClass}/${docxDocId}`,
      s3VersionId: 's3-ver-docx-1',
      annotationEtag: 'etag-docx-1',
      checksum: 'sha256:abcd1234docx',
    });
    await S3Manager.putContent(`documents/${documentClass}/${docxDocId}`, sampleDocx, docxMime);
    await S3Manager.putAnnotation(documentClass, docxDocId, 's3-ver-docx-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: docxDocId,
      document_class: documentClass,
      content_type: docxMime,
      content_checksum: 'sha256:abcd1234docx',
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
    expect(body.derivative_origin.format).toBe('pdf');
    expect(body.derivative_origin.page_count).toBe(1);
    expect(body.metadata.format).toBe('pdf');
    expect(body.metadata.page_count).toBe(1);
    expect(body.download_url).toContain('derivatives');
  });

  it('GET /documents/{id}?format=pdf converts DOCX to PDF derivative with origin metadata', async () => {
    const res = await getDocumentHandler(createMockEvent(docxDocId, { format: 'pdf' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.document_id).toBe(docxDocId);
    expect(body.delivery_format).toBe('application/pdf');
    expect(body.is_derivative).toBe(true);
    expect(body.derivative_origin).toBeDefined();
    expect(body.derivative_origin.source_content_type).toBe(docxMime);
    expect(body.derivative_origin.source_s3_version_id).toBe('s3-ver-docx-1');
    expect(body.derivative_origin.source_content_checksum).toBe('sha256:abcd1234docx');
    expect(body.derivative_origin.format).toBe('pdf');
    expect(body.derivative_origin.page_count).toBeGreaterThanOrEqual(1);
    expect(body.metadata.format).toBe('pdf');
    expect(body.metadata.page_count).toBeGreaterThanOrEqual(1);
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
    expect(body.metadata.format).toBe('pdf');
  });

  it('GET /documents/{id}?format=pdf on unsupported type throws 400 ValidationError', async () => {
    const res = await getDocumentHandler(createMockEvent(textDocId, { format: 'pdf' }));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Format conversion to PDF is only supported for JPEG and PNG images, and MS Word (DOCX) documents');
  });

  it('GET /documents/{id}/download?format=pdf generates presigned derivative URL for DOCX', async () => {
    const res = await getDownloadUrlHandler(createMockEvent(docxDocId, { format: 'pdf' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.document_id).toBe(docxDocId);
    expect(body.delivery_format).toBe('application/pdf');
    expect(body.is_derivative).toBe(true);
    expect(body.derivative_origin.format).toBe('pdf');
    expect(body.derivative_origin.page_count).toBeGreaterThanOrEqual(1);
    expect(body.download_url).toContain('derivatives');
  });

  it('GET /documents/{id}/versions/{version}?format=pdf handles historical DOCX version conversion', async () => {
    const event = {
      ...createMockEvent(docxDocId, { format: 'pdf' }),
      pathParameters: { document_id: docxDocId, version: '1' },
    };
    const res = await getVersionHandler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.document_id).toBe(docxDocId);
    expect(body.delivery_format).toBe('application/pdf');
    expect(body.is_derivative).toBe(true);
    expect(body.derivative_origin.source_s3_version_id).toBe('s3-ver-docx-1');
    expect(body.derivative_origin.format).toBe('pdf');
    expect(body.derivative_origin.page_count).toBeGreaterThanOrEqual(1);
  });
});
