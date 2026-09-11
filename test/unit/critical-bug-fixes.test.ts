import { handler as metadataEnricherHandler } from '../../src/background-worker/metadata-enricher';
import { handler as indexerHandler } from '../../src/background-worker/indexer';
import { handler as streamProcessorHandler } from '../../src/background-worker/stream-processor';
import { handler as metadataUpdateHandler } from '../../src/command-api/metadata-update';
import { handler as uploadInlineHandler } from '../../src/command-api/upload-inline';
import { handler as versionCreateHandler } from '../../src/command-api/version-create';
import { handler as getDocumentHandler } from '../../src/query-api/get-document';
import { handler as getDownloadUrlHandler } from '../../src/query-api/get-download-url';
import { handler as getVersionHandler } from '../../src/query-api/get-version';
import { handler as getMetadataHandler } from '../../src/query-api/get-metadata';
import { handler as listVersionsHandler } from '../../src/query-api/list-versions';
import { DynamoManager } from '../../src/shared/dynamo';
import { S3Manager } from '../../src/shared/s3';
import { OpenSearchManager } from '../../src/shared/opensearch';
import { SQSEvent, DynamoDBStreamEvent } from 'aws-lambda';

// Mock Bedrock runtime for enricher
const mockBedrockSend = jest.fn();
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: (...args: any[]) => mockBedrockSend(...args),
  })),
  ConverseCommand: jest.fn().mockImplementation((input: any) => input),
}));

// Mock S3 PutObject for audit bucket
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({}),
    })),
  };
});

// Mock SQS client
const mockSqsSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-sqs', () => {
  const actual = jest.requireActual('@aws-sdk/client-sqs');
  return {
    ...actual,
    SQSClient: jest.fn().mockImplementation(() => ({
      send: (...args: any[]) => mockSqsSend(...args),
    })),
  };
});

// Mock OpenSearchManager
jest.mock('../../src/shared/opensearch', () => ({
  OpenSearchManager: {
    upsertDocumentProjection: jest.fn().mockResolvedValue({}),
    removeDocumentProjection: jest.fn().mockResolvedValue({}),
  },
}));

describe('Critical Bug Fixes Verification Suite', () => {
  const documentClass = 'loan_agreement';
  const activeDocId = 'a1111111-2222-3333-4444-555555555555';
  const softDeletedDocId = 'd2222222-2222-3333-4444-555555555555';
  const testUserId = 'user-test-fix';

  beforeAll(async () => {
    process.env.MOCK_STORAGE_BYPASS = 'true';
    process.env.MOCK_AUTH_BYPASS = 'true';
    process.env.AUDIT_BUCKET_NAME = 'doc-platform-mvp-audit';
    process.env.INDEX_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/index-queue';
    process.env.ENRICHMENT_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/enrichment-queue';

    // 1. Seed active document
    const activeKey = `documents/${documentClass}/${activeDocId}`;
    await DynamoManager.commitDocumentCreation({
      documentId: activeDocId,
      documentClass,
      s3Key: activeKey,
      s3VersionId: 's3-ver-active-1',
      annotationEtag: 'etag-active-1',
      checksum: 'sha256:1111222233334444555566667777888899990000111122223333444455556666',
    });
    await S3Manager.putContent(activeKey, Buffer.from('%PDF-1.4 test'), 'application/pdf');
    await S3Manager.putAnnotation(documentClass, activeDocId, 's3-ver-active-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: activeDocId,
      document_class: documentClass,
      document_type: 'SIGNED_AGREEMENT',
      loan_number: 'LN-FIX-001',
      loan_amount_minor_units: 100000,
      currency: 'USD',
      loan_type: 'PERSONAL',
      branch_code: 'BR-1',
      signed_date: '2026-01-01',
      content_type: 'application/pdf',
      format: 'pdf',
      content_length: 14,
      content_checksum: 'sha256:1111222233334444555566667777888899990000111122223333444455556666',
      filename: 'active.pdf',
      created_at: new Date().toISOString(),
      created_by: testUserId,
      application_version: 1,
      metadata_revision: 1,
      schema_version: 1,
      customer_id: 123456,
      complete_customer_id_code: {
        id_number: '987654321',
        id_type: 1,
      },
      account_id: {
        bank_id: 10,
        branch_id: 800,
        account_number: 998877,
      },
      business_area_code: 10,
      business_sub_area_code: 20,
      confidentiality_tier: 'INTERNAL',
      contains_pii: false,
      pii_categories: ['NONE'],
    });

    // 2. Seed soft-deleted document
    const delKey = `documents/${documentClass}/${softDeletedDocId}`;
    await DynamoManager.commitDocumentCreation({
      documentId: softDeletedDocId,
      documentClass,
      s3Key: delKey,
      s3VersionId: 's3-ver-del-1',
      annotationEtag: 'etag-del-1',
      checksum: 'sha256:aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999',
    });
    await DynamoManager.setDocumentStatus(softDeletedDocId, 'SOFT_DELETED');
    await S3Manager.putContent(delKey, Buffer.from('%PDF-1.4 deleted'), 'application/pdf');
    await S3Manager.putAnnotation(documentClass, softDeletedDocId, 's3-ver-del-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: softDeletedDocId,
      document_class: documentClass,
      document_type: 'SIGNED_AGREEMENT',
      loan_amount_minor_units: 50000,
      currency: 'USD',
      loan_type: 'AUTO',
      branch_code: 'BR-2',
      signed_date: '2026-01-01',
      content_type: 'application/pdf',
      format: 'pdf',
      content_length: 15,
      content_checksum: 'sha256:aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999',
      filename: 'deleted.pdf',
      created_at: new Date().toISOString(),
      created_by: testUserId,
      application_version: 1,
      metadata_revision: 1,
      schema_version: 1,
      customer_id: 123456,
      complete_customer_id_code: {
        id_number: '987654321',
        id_type: 1,
      },
      account_id: {
        bank_id: 10,
        branch_id: 800,
        account_number: 998877,
      },
      business_area_code: 10,
      business_sub_area_code: 20,
      confidentiality_tier: 'INTERNAL',
      contains_pii: false,
      pii_categories: ['NONE'],
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSqsSend.mockResolvedValue({});
  });

  describe('Fix Group 1: SQS Batch Message Loss (BUG-01, BUG-17)', () => {
    it('metadata-enricher continues processing remaining records when an earlier record has an invalid payload or skip', async () => {
      const doc2Id = 'e3333333-2222-3333-4444-555555555555';
      const doc2Key = `documents/${documentClass}/${doc2Id}`;
      const validSha = 'sha256:2222222233334444555566667777888899990000111122223333444455556666';
      await DynamoManager.commitDocumentCreation({
        documentId: doc2Id,
        documentClass,
        s3Key: doc2Key,
        s3VersionId: 's3-ver-doc2',
        annotationEtag: 'etag-doc2',
        checksum: validSha,
      });
      await S3Manager.putContent(doc2Key, Buffer.from('test loan document body'), 'text/plain');
      await S3Manager.putAnnotation(documentClass, doc2Id, 's3-ver-doc2', {
        annotation_schema: 'bank.document-metadata/1',
        document_id: doc2Id,
        document_class: documentClass,
        document_type: 'APPLICATION',
        loan_amount_minor_units: 200000,
        currency: 'USD',
        loan_type: 'PERSONAL',
        branch_code: 'BR-3',
        signed_date: '2026-02-01',
        content_type: 'text/plain',
        format: 'txt',
        content_length: 23,
        content_checksum: validSha,
        filename: 'doc2.txt',
        created_at: new Date().toISOString(),
        created_by: testUserId,
        application_version: 1,
        metadata_revision: 1,
        schema_version: 1,
        customer_id: 123456,
        complete_customer_id_code: {
          id_number: '987654321',
          id_type: 1,
        },
        account_id: {
          bank_id: 10,
          branch_id: 800,
          account_number: 998877,
        },
        business_area_code: 10,
        business_sub_area_code: 20,
        confidentiality_tier: 'INTERNAL',
        contains_pii: false,
        pii_categories: ['NONE'],
      });

      mockBedrockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [{ text: JSON.stringify({ loan_number: 'LN-BATCH-002', contains_pii: false }) }],
          },
        },
        usage: { inputTokens: 50, outputTokens: 20 },
      });

      const event: SQSEvent = {
        Records: [
          {
            messageId: 'msg-invalid-1',
            receiptHandle: 'rh-1',
            body: 'invalid-json-body',
            attributes: {} as any,
            messageAttributes: {},
            md5OfBody: '',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:...',
            awsRegion: 'us-east-1',
          },
          {
            messageId: 'msg-valid-2',
            receiptHandle: 'rh-2',
            body: JSON.stringify({
              document_id: doc2Id,
              document_class: documentClass,
              s3_version_id: 's3-ver-doc2',
              expected_metadata_revision: 1,
            }),
            attributes: {} as any,
            messageAttributes: {},
            md5OfBody: '',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:...',
            awsRegion: 'us-east-1',
          },
        ],
      };

      const result = await metadataEnricherHandler(event);

      // Verify that record 2 was processed successfully and not dropped
      expect(result).toEqual({ batchItemFailures: [] });
      const updatedDoc = await DynamoManager.getDocument(doc2Id);
      expect(updatedDoc.current_metadata_revision).toBe(2);
    });

    it('indexer handles unparseable JSON without crashing and indexes valid messages', async () => {
      const event: SQSEvent = {
        Records: [
          {
            messageId: 'idx-msg-bad-1',
            receiptHandle: 'rh-1',
            body: '{ malformed json :::',
            attributes: {} as any,
            messageAttributes: {},
            md5OfBody: '',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:...',
            awsRegion: 'us-east-1',
          },
          {
            messageId: 'idx-msg-good-2',
            receiptHandle: 'rh-2',
            body: JSON.stringify({
              document_id: activeDocId,
              document_class: documentClass,
              metadata_revision: 1,
              status: 'ACTIVE',
            }),
            attributes: {} as any,
            messageAttributes: {},
            md5OfBody: '',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:...',
            awsRegion: 'us-east-1',
          },
        ],
      };

      const result = await indexerHandler(event);
      expect(result).toEqual({ batchItemFailures: [] });
      expect(OpenSearchManager.upsertDocumentProjection).toHaveBeenCalled();
    });
  });

  describe('Fix Group 2: Stream Processor Error Swallowing & REMOVE Status (BUG-02, BUG-19)', () => {
    it('re-throws error when SQS SendMessage fails so DynamoDB Streams retries the event', async () => {
      mockSqsSend.mockRejectedValueOnce(new Error('SQS service unavailable'));

      const event: DynamoDBStreamEvent = {
        Records: [
          {
            eventID: 'evt-001',
            eventName: 'INSERT',
            eventVersion: '1.1',
            eventSource: 'aws:dynamodb',
            awsRegion: 'us-east-1',
            dynamodb: {
              NewImage: {
                pk: { S: `DOC#${activeDocId}` },
                sk: { S: 'DOC' },
                document_id: { S: activeDocId },
                document_class: { S: documentClass },
                current_s3_version_id: { S: 's3-ver-active-1' },
                current_metadata_revision: { N: '1' },
                status: { S: 'ACTIVE' },
              },
            },
          },
        ],
      };

      await expect(streamProcessorHandler(event)).rejects.toThrow('SQS service unavailable');
    });

    it('sets status to SOFT_DELETED when record eventName is REMOVE', async () => {
      mockSqsSend.mockResolvedValue({});

      const event: DynamoDBStreamEvent = {
        Records: [
          {
            eventID: 'evt-del-002',
            eventName: 'REMOVE',
            eventVersion: '1.1',
            eventSource: 'aws:dynamodb',
            awsRegion: 'us-east-1',
            dynamodb: {
              OldImage: {
                pk: { S: `DOC#${activeDocId}` },
                sk: { S: 'DOC' },
                document_id: { S: activeDocId },
                document_class: { S: documentClass },
                current_s3_version_id: { S: 's3-ver-active-1' },
                current_metadata_revision: { N: '1' },
                status: { S: 'ACTIVE' },
              },
            },
          },
        ],
      };

      await streamProcessorHandler(event);

      // Verify that the index message enqueued has status: 'SOFT_DELETED'
      expect(mockSqsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MessageBody: expect.stringContaining('"status":"SOFT_DELETED"'),
          }),
        })
      );
    });
  });

  describe('Fix Group 3: Metadata Update OCC Gate & Soft-Delete Guard (BUG-03, BUG-13)', () => {
    it('rejects metadata update on a soft-deleted document with 400 ValidationError', async () => {
      const event: any = {
        pathParameters: { document_id: softDeletedDocId },
        headers: {
          'x-mock-role': 'Document.MetadataEditor',
          'x-mock-user': testUserId,
        },
        requestContext: { requestId: 'req-del-patch' },
        body: JSON.stringify({
          expected_metadata_revision: 1,
          changes: { loan_number: 'LN-SHOULD-FAIL' },
        }),
      };

      const res = await metadataUpdateHandler(event);
      expect(res.statusCode).toBe(400);
      const parsed = JSON.parse(res.body);
      expect(parsed.error.message).toContain('Cannot update metadata on soft-deleted document');
    });

    it('rejects metadata update when expected_metadata_revision does not match (OCC gate)', async () => {
      const event: any = {
        pathParameters: { document_id: activeDocId },
        headers: {
          'x-mock-role': 'Document.MetadataEditor',
          'x-mock-user': testUserId,
        },
        requestContext: { requestId: 'req-occ-conflict' },
        body: JSON.stringify({
          expected_metadata_revision: 999, // Stale revision
          changes: { loan_number: 'LN-OCC-999' },
        }),
      };

      const res = await metadataUpdateHandler(event);
      expect(res.statusCode).toBe(409);
      const parsed = JSON.parse(res.body);
      expect(parsed.error.code).toBe('METADATA_CONFLICT');
    });
  });

  describe('Fix Group 4: Broken Idempotency (BUG-05)', () => {
    it('returns cached response when Idempotency-Key is reused with same payload', async () => {
      const idempotencyKey = `idemp-${Date.now()}`;
      const metadataPayload = {
        document_class: 'loan_agreement',
        document_type: 'SIGNED_AGREEMENT',
        loan_number: 'LN-IDEMP-001',
        loan_amount_minor_units: 5000000,
        currency: 'ILS',
        loan_type: 'MORTGAGE',
        branch_code: 'TLV-01',
        signed_date: '2026-09-01',
        customer_id: 123456,
        complete_customer_id_code: { id_number: '123456789', id_type: 1 },
        account_id: { bank_id: 10, branch_id: 800, account_number: 123456 },
        business_area_code: 10,
        business_sub_area_code: 20,
        confidentiality_tier: 'RESTRICTED',
        contains_pii: false,
        pii_categories: ['NONE'],
      };

      const event: any = {
        headers: {
          'x-mock-role': 'Document.Writer',
          'x-mock-user': testUserId,
          'Idempotency-Key': idempotencyKey,
          'X-Document-Metadata': JSON.stringify(metadataPayload),
          'Content-Type': 'application/pdf',
        },
        requestContext: { requestId: 'req-idemp-1' },
        body: Buffer.from('%PDF-1.4 dummy payload').toString('base64'),
        isBase64Encoded: true,
      };

      // Call 1: First upload
      const res1 = await uploadInlineHandler(event);
      expect(res1.statusCode).toBe(201);
      const body1 = JSON.parse(res1.body);

      // Call 2: Retry with same key and payload
      const res2 = await uploadInlineHandler(event);
      expect(res2.statusCode).toBe(201);
      const body2 = JSON.parse(res2.body);

      // The returned document_id and application_version should match the original cached response
      expect(body2.document_id).toBe(body1.document_id);
      expect(body2.application_version).toBe(body1.application_version);
    });
  });

  describe('Fix Group 6: version-create Refactor & Soft-Delete Guard (BUG-10, BUG-11, BUG-13)', () => {
    it('refuses to create version on soft-deleted document', async () => {
      const event: any = {
        pathParameters: { document_id: softDeletedDocId },
        headers: {
          'x-mock-role': 'Document.Writer',
          'x-mock-user': testUserId,
          'Content-Type': 'application/pdf',
        },
        requestContext: { requestId: 'req-ver-del' },
        body: Buffer.from('%PDF-1.4 new version content').toString('base64'),
        isBase64Encoded: true,
      };

      const res = await versionCreateHandler(event);
      expect(res.statusCode).toBe(400);
      const parsed = JSON.parse(res.body);
      expect(parsed.error.message).toContain('Cannot create version for soft-deleted document');
    });

    it('creates version 2 successfully on active document via commitNewVersion', async () => {
      const event: any = {
        pathParameters: { document_id: activeDocId },
        headers: {
          'x-mock-role': 'Document.Writer',
          'x-mock-user': testUserId,
          'Content-Type': 'application/pdf',
        },
        requestContext: { requestId: 'req-ver-create' },
        body: Buffer.from('%PDF-1.4 updated v2 content').toString('base64'),
        isBase64Encoded: true,
      };

      const res = await versionCreateHandler(event);
      expect(res.statusCode).toBe(201);
      const parsed = JSON.parse(res.body);
      expect(parsed.application_version).toBe(2);

      const doc = await DynamoManager.getDocument(activeDocId);
      expect(doc.current_application_version).toBe(2);
    });
  });

  describe('Fix Group 7: Query API Soft-Delete Guards (BUG-12)', () => {
    const defaultHeaders = {
      'x-mock-role': 'Document.Reader',
      'x-mock-user': testUserId,
    };

    it('get-document returns 404 for soft-deleted document', async () => {
      const event: any = {
        pathParameters: { document_id: softDeletedDocId },
        headers: defaultHeaders,
        requestContext: { requestId: 'req-get-doc' },
      };
      const res = await getDocumentHandler(event);
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
    });

    it('get-download-url returns 404 for soft-deleted document', async () => {
      const event: any = {
        pathParameters: { document_id: softDeletedDocId },
        headers: defaultHeaders,
        requestContext: { requestId: 'req-get-url' },
      };
      const res = await getDownloadUrlHandler(event);
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
    });

    it('get-version returns 404 for soft-deleted document', async () => {
      const event: any = {
        pathParameters: { document_id: softDeletedDocId, version: '1' },
        headers: defaultHeaders,
        requestContext: { requestId: 'req-get-ver' },
      };
      const res = await getVersionHandler(event);
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
    });

    it('get-metadata returns 404 for soft-deleted document', async () => {
      const event: any = {
        pathParameters: { document_id: softDeletedDocId },
        headers: defaultHeaders,
        requestContext: { requestId: 'req-get-meta' },
      };
      const res = await getMetadataHandler(event);
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
    });

    it('list-versions returns 404 for soft-deleted document', async () => {
      const event: any = {
        pathParameters: { document_id: softDeletedDocId },
        headers: defaultHeaders,
        requestContext: { requestId: 'req-list-vers' },
      };
      const res = await listVersionsHandler(event);
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
    });
  });
});
