import { handler as uploadInlineHandler } from '../../src/command-api/upload-inline';
import { handler as uploadDirectInitHandler } from '../../src/command-api/upload-direct-init';
import { handler as uploadDirectCompleteHandler } from '../../src/command-api/upload-direct-complete';
import { handler as versionCreateHandler } from '../../src/command-api/version-create';
import { S3Manager } from '../../src/shared/s3';
import { convertImageToPdf } from '../../src/shared/pdf-converter';
import * as crypto from 'crypto';

describe('Upload Format & PDF Page Count Unit Tests', () => {
  const sampleJpg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64'
  );

  let singlePagePdf: Buffer;

  beforeAll(async () => {
    process.env.MOCK_STORAGE_BYPASS = 'true';
    process.env.MOCK_AUTH_BYPASS = 'true';

    singlePagePdf = await convertImageToPdf(sampleJpg, 'image/jpeg');
  });

  it('Inline upload of a PDF sets format=pdf and page_count=1 in S3 annotation and response', async () => {
    const sha256 = crypto.createHash('sha256').update(singlePagePdf).digest('hex');
    const metadata = {
      document_class: 'loan_agreement',
      document_type: 'SIGNED_AGREEMENT',
      filename: 'test_agreement.pdf',
      loan_number: 'LN-TEST-001',
      loan_amount_minor_units: 5000000,
      currency: 'ILS',
      signed_date: '2026-09-01',
    };

    const event = {
      headers: {
        Authorization: 'Bearer mock-token',
        'Content-Type': 'application/pdf',
        'X-Content-SHA256': sha256,
        'X-Document-Metadata': Buffer.from(JSON.stringify(metadata)).toString('base64'),
      },
      body: singlePagePdf.toString('base64'),
      isBase64Encoded: true,
      requestContext: { requestId: 'req-inline-pdf-001' },
    } as any;

    const res = await uploadInlineHandler(event);
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.document_id).toBeDefined();
    expect(body.format).toBe('pdf');
    expect(body.page_count).toBe(1);

    const anno = await S3Manager.getAnnotation('loan_agreement', body.document_id, body.s3_version_id);
    expect(anno.metadata.format).toBe('pdf');
    expect(anno.metadata.page_count).toBe(1);
    expect(anno.metadata.content_type).toBe('application/pdf');
  });

  it('Inline upload of a JPEG sets format=jpeg and omits page_count in S3 annotation and response', async () => {
    const sha256 = crypto.createHash('sha256').update(sampleJpg).digest('hex');
    const metadata = {
      document_class: 'loan_agreement',
      document_type: 'APPLICATION',
      filename: 'photo.jpg',
      loan_number: 'LN-TEST-002',
      loan_amount_minor_units: 3000000,
      currency: 'ILS',
      signed_date: '2026-09-01',
    };

    const event = {
      headers: {
        Authorization: 'Bearer mock-token',
        'Content-Type': 'image/jpeg',
        'X-Content-SHA256': sha256,
        'X-Document-Metadata': Buffer.from(JSON.stringify(metadata)).toString('base64'),
      },
      body: sampleJpg.toString('base64'),
      isBase64Encoded: true,
      requestContext: { requestId: 'req-inline-jpg-002' },
    } as any;

    const res = await uploadInlineHandler(event);
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.document_id).toBeDefined();
    expect(body.format).toBe('jpeg');
    expect(body.page_count).toBeUndefined();

    const anno = await S3Manager.getAnnotation('loan_agreement', body.document_id, body.s3_version_id);
    expect(anno.metadata.format).toBe('jpeg');
    expect(anno.metadata.page_count).toBeUndefined();
    expect(anno.metadata.content_type).toBe('image/jpeg');
  });

  it('New version upload of PDF extracts format=pdf and page_count in S3 annotation', async () => {
    // 1. First upload a doc
    const sha256 = crypto.createHash('sha256').update(singlePagePdf).digest('hex');
    const initEvent = {
      headers: {
        Authorization: 'Bearer mock-token',
        'Content-Type': 'application/pdf',
        'X-Content-SHA256': sha256,
        'X-Document-Metadata': Buffer.from(JSON.stringify({
          document_class: 'loan_agreement',
          filename: 'initial.pdf',
        })).toString('base64'),
      },
      body: singlePagePdf.toString('base64'),
      isBase64Encoded: true,
      requestContext: { requestId: 'req-v1-create' },
    } as any;

    const initRes = await uploadInlineHandler(initEvent);
    const initBody = JSON.parse(initRes.body);
    const docId = initBody.document_id;

    // 2. Upload version 2
    const v2Event = {
      headers: {
        Authorization: 'Bearer mock-token',
        'Content-Type': 'application/pdf',
      },
      pathParameters: { document_id: docId },
      body: singlePagePdf.toString('base64'),
      isBase64Encoded: true,
      requestContext: { requestId: 'req-v2-create' },
    } as any;

    const v2Res = await versionCreateHandler(v2Event);
    expect(v2Res.statusCode).toBe(201);
    const v2Body = JSON.parse(v2Res.body);
    expect(v2Body.application_version).toBe(2);
    expect(v2Body.format).toBe('pdf');
    expect(v2Body.page_count).toBe(1);

    const annoV2 = await S3Manager.getAnnotation('loan_agreement', docId, v2Body.s3_version_id);
    expect(annoV2.metadata.format).toBe('pdf');
    expect(annoV2.metadata.page_count).toBe(1);
  });
});
