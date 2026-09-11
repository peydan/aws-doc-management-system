import { handler as metadataUpdateHandler } from '../../src/command-api/metadata-update';
import { handler as metadataEnricherHandler } from '../../src/background-worker/metadata-enricher';
import { handler as streamProcessorHandler } from '../../src/background-worker/stream-processor';
import { handler as indexerHandler } from '../../src/background-worker/indexer';
import { DynamoManager } from '../../src/shared/dynamo';
import { S3Manager } from '../../src/shared/s3';
import { OpenSearchManager } from '../../src/shared/opensearch';
import { SearchUnavailableError } from '../../src/shared/errors';
import { APIGatewayProxyEvent, SQSEvent, DynamoDBStreamEvent } from 'aws-lambda';

// Mock S3 PutObject for audit bucket
const mockS3Send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: (...args: any[]) => mockS3Send(...args),
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

// Mock Bedrock runtime for enricher
const mockBedrockSend = jest.fn();
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: (...args: any[]) => mockBedrockSend(...args),
  })),
  ConverseCommand: jest.fn().mockImplementation((input: any) => input),
}));

// Mock OpenSearchManager
jest.mock('../../src/shared/opensearch', () => ({
  OpenSearchManager: {
    upsertDocumentProjection: jest.fn().mockResolvedValue({}),
    removeDocumentProjection: jest.fn().mockResolvedValue({}),
  },
}));

describe('Sprint 1 Critical Data Integrity Fixes Suite', () => {
  const documentClass = 'loan_agreement';
  const testDocId = 'a1111111-2222-4333-8444-555555555555';
  const testUserId = 'user-sp1-test';

  beforeAll(async () => {
    process.env.MOCK_STORAGE_BYPASS = 'true';
    process.env.MOCK_AUTH_BYPASS = 'true';
    process.env.AUDIT_BUCKET_NAME = 'doc-platform-mvp-audit';
    process.env.INDEX_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/index-queue';
    process.env.ENRICHMENT_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/enrichment-queue';

    const s3Key = `documents/${documentClass}/${testDocId}`;
    await DynamoManager.commitDocumentCreation({
      documentId: testDocId,
      documentClass,
      s3Key,
      s3VersionId: 's3-ver-sp1-1',
      annotationEtag: 'etag-sp1-1',
      checksum: 'sha256:sp1111222233334444555566667777888899990000111122223333444455556666',
    });
    await S3Manager.putContent(s3Key, Buffer.from('%PDF-1.4 test'), 'application/pdf');
    await S3Manager.putAnnotation(documentClass, testDocId, 's3-ver-sp1-1', {
      annotation_schema: 'bank.document-metadata/1',
      document_id: testDocId,
      document_class: documentClass,
      document_type: 'SIGNED_AGREEMENT',
      loan_number: 'LN-SP1-001',
      loan_amount_minor_units: 500000,
      currency: 'USD',
      loan_type: 'MORTGAGE',
      branch_code: 'BR-10',
      signed_date: '2026-03-01',
      content_type: 'application/pdf',
      format: 'pdf',
      content_length: 14,
      content_checksum: 'sha256:sp1111222233334444555566667777888899990000111122223333444455556666',
      filename: 'sp1_test.pdf',
      created_at: new Date().toISOString(),
      created_by: testUserId,
      application_version: 1,
      metadata_revision: 1,
      schema_version: 1,
      customer_id: 123456,
      complete_customer_id_code: { id_number: '987654321', id_type: 1 },
      account_id: { bank_id: 10, branch_id: 800, account_number: 998877 },
      business_area_code: 10,
      business_sub_area_code: 20,
      confidentiality_tier: 'INTERNAL',
      contains_pii: false,
      pii_categories: ['NONE'],
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Fix 1.1: Metadata Write Order (S3 Annotation before DynamoDB OCC)', () => {
    it('metadata-update writes S3 annotation first and commits real annotation eTag directly', async () => {
      const callOrder: string[] = [];

      const origPutAnnotation = S3Manager.putAnnotation;
      const origUpdateMetadataRevision = DynamoManager.updateMetadataRevision;

      jest.spyOn(S3Manager, 'putAnnotation').mockImplementation(async (...args) => {
        callOrder.push('s3.putAnnotation');
        return origPutAnnotation.call(S3Manager, ...args);
      });

      jest.spyOn(DynamoManager, 'updateMetadataRevision').mockImplementation(async (...args) => {
        callOrder.push('dynamo.updateMetadataRevision');
        return origUpdateMetadataRevision.call(DynamoManager, ...args);
      });

      const event: any = {
        headers: {
          'content-type': 'application/json',
          'x-mock-role': 'Document.MetadataEditor',
          'x-mock-user': testUserId,
        },
        pathParameters: { document_id: testDocId },
        body: JSON.stringify({
          expected_metadata_revision: 1,
          changes: { branch_code: 'BR-99' },
        }),
        requestContext: { requestId: 'req-sp1-write-order' },
      };

      const res = await metadataUpdateHandler(event as APIGatewayProxyEvent);
      expect(res.statusCode).toBe(200);

      // Verify S3 write happened BEFORE DynamoDB OCC
      expect(callOrder).toEqual(['s3.putAnnotation', 'dynamo.updateMetadataRevision']);

      // Verify DynamoDB record has updated revision and real annotation eTag (never pending)
      const doc = await DynamoManager.getDocument(testDocId);
      expect(doc.current_metadata_revision).toBe(2);
      expect(doc.current_annotation_etag).not.toBe('pending');
      expect(doc.current_annotation_etag).toBeTruthy();
    });

    it('metadata-enricher writes S3 annotation first and passes real eTag directly', async () => {
      const enrichDocId = 'b2222222-3333-4444-8555-666666666666';
      const s3Key = `documents/${documentClass}/${enrichDocId}`;
      await DynamoManager.commitDocumentCreation({
        documentId: enrichDocId,
        documentClass,
        s3Key,
        s3VersionId: 's3-ver-enrich-1',
        annotationEtag: 'etag-enrich-1',
        checksum: 'sha256:sp1enrich111122223333444455556666777788889999000011112222333344445555',
      });
      await S3Manager.putContent(s3Key, Buffer.from('%PDF-1.4 test'), 'application/pdf');
      await S3Manager.putAnnotation(documentClass, enrichDocId, 's3-ver-enrich-1', {
        annotation_schema: 'bank.document-metadata/1',
        document_id: enrichDocId,
        document_class: documentClass,
        document_type: 'APPLICATION',
        loan_amount_minor_units: 300000,
        currency: 'USD',
        loan_type: 'PERSONAL',
        branch_code: 'BR-20',
        signed_date: '2026-03-01',
        content_type: 'application/pdf',
        format: 'pdf',
        content_length: 14,
        content_checksum: 'sha256:sp1enrich111122223333444455556666777788889999000011112222333344445555',
        filename: 'sp1_enrich.pdf',
        created_at: new Date().toISOString(),
        created_by: testUserId,
        application_version: 1,
        metadata_revision: 1,
        schema_version: 1,
        customer_id: 123456,
        complete_customer_id_code: { id_number: '987654321', id_type: 1 },
        account_id: { bank_id: 10, branch_id: 800, account_number: 998877 },
        business_area_code: 10,
        business_sub_area_code: 20,
        confidentiality_tier: 'INTERNAL',
        contains_pii: false,
        pii_categories: ['NONE'],
      });

      mockBedrockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [{ text: JSON.stringify({ loan_number: 'LN-SP1-ENRICHED', contains_pii: true, pii_categories: ['CONTACT_INFO'] }) }],
          },
        },
        usage: { inputTokens: 50, outputTokens: 25 },
      });

      const callOrder: string[] = [];
      const origPutAnnotation = S3Manager.putAnnotation;
      const origUpdateMetadataRevision = DynamoManager.updateMetadataRevision;

      jest.spyOn(S3Manager, 'putAnnotation').mockImplementation(async (...args) => {
        callOrder.push('s3.putAnnotation');
        return origPutAnnotation.call(S3Manager, ...args);
      });

      jest.spyOn(DynamoManager, 'updateMetadataRevision').mockImplementation(async (...args) => {
        callOrder.push('dynamo.updateMetadataRevision');
        return origUpdateMetadataRevision.call(DynamoManager, ...args);
      });

      const sqsEvent: SQSEvent = {
        Records: [
          {
            messageId: 'msg-sp1-enrich',
            receiptHandle: 'rh-sp1-enrich',
            body: JSON.stringify({
              document_id: enrichDocId,
              document_class: documentClass,
              s3_version_id: 's3-ver-enrich-1',
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

      const res = await metadataEnricherHandler(sqsEvent);
      expect(res.batchItemFailures).toEqual([]);

      // Verify S3 write happened before DynamoDB OCC
      expect(callOrder).toEqual(['s3.putAnnotation', 'dynamo.updateMetadataRevision']);

      const updated = await DynamoManager.getDocument(enrichDocId);
      expect(updated.current_metadata_revision).toBe(2);
      expect(updated.current_annotation_etag).not.toBe('pending');
    });
  });

  describe('Fix 1.2 & 1.3: Stream Processor oldImage Fallback & Indexer SOFT_DELETED Handling', () => {
    it('stream processor extracts s3_version_id and metadata_revision from oldImage on REMOVE event', async () => {
      const streamEvent: DynamoDBStreamEvent = {
        Records: [
          {
            eventID: 'evt-remove-1',
            eventName: 'REMOVE',
            eventVersion: '1.1',
            eventSource: 'aws:dynamodb',
            awsRegion: 'us-east-1',
            dynamodb: {
              OldImage: {
                pk: { S: `DOC#${testDocId}` },
                sk: { S: 'DOC' },
                document_id: { S: testDocId },
                document_class: { S: documentClass },
                current_s3_version_id: { S: 's3-ver-sp1-old' },
                current_metadata_revision: { N: '3' },
                status: { S: 'ACTIVE' },
              },
            },
          },
        ],
      };

      await streamProcessorHandler(streamEvent);

      // Verify SQS index message includes attributes recovered from oldImage
      expect(mockSqsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/index-queue',
            MessageBody: expect.stringContaining('"s3_version_id":"s3-ver-sp1-old"'),
          }),
        })
      );
      expect(mockSqsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MessageBody: expect.stringContaining('"metadata_revision":3'),
          }),
        })
      );
      expect(mockSqsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MessageBody: expect.stringContaining('"status":"SOFT_DELETED"'),
          }),
        })
      );
    });

    it('indexer removes document projection immediately when status is SOFT_DELETED without fetching from DynamoDB', async () => {
      const getDocSpy = jest.spyOn(DynamoManager, 'getDocument');

      const sqsEvent: SQSEvent = {
        Records: [
          {
            messageId: 'msg-remove-os',
            receiptHandle: 'rh-remove-os',
            body: JSON.stringify({
              document_id: 'deleted-doc-id-xyz',
              document_class: 'loan_agreement',
              status: 'SOFT_DELETED',
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

      const res = await indexerHandler(sqsEvent);
      expect(res.batchItemFailures).toEqual([]);
      expect(OpenSearchManager.removeDocumentProjection).toHaveBeenCalledWith('deleted-doc-id-xyz');
      // Verify getDocument was NOT called for SOFT_DELETED status
      expect(getDocSpy).not.toHaveBeenCalledWith('deleted-doc-id-xyz');
    });

    it('indexer handles document missing from DynamoDB cleanly by removing projection without batch failure', async () => {
      const missingDocId = 'nonexistent-doc-id-abc';

      const sqsEvent: SQSEvent = {
        Records: [
          {
            messageId: 'msg-missing-doc',
            receiptHandle: 'rh-missing-doc',
            body: JSON.stringify({
              document_id: missingDocId,
              document_class: 'loan_agreement',
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

      const res = await indexerHandler(sqsEvent);
      expect(res.batchItemFailures).toEqual([]);
      expect(OpenSearchManager.removeDocumentProjection).toHaveBeenCalledWith(missingDocId);
    });
  });

  describe('Fix 1.6: commitNewVersion Updates current_s3_key', () => {
    it('commitNewVersion correctly updates current_s3_key', async () => {
      const newKey = `documents/${documentClass}/${testDocId}-mutated.pdf`;
      const updatedDoc = await DynamoManager.commitNewVersion({
        documentId: testDocId,
        nextAppVersion: 2,
        expectedAppVersion: 1,
        s3Key: newKey,
        s3VersionId: 's3-ver-sp1-app-2',
        annotationEtag: 'etag-sp1-v2',
        checksum: 'sha256:sp1v2checksum',
      });

      expect(updatedDoc.current_application_version).toBe(2);
      expect(updatedDoc.current_s3_key).toBe(newKey);
      expect(updatedDoc.current_s3_version_id).toBe('s3-ver-sp1-app-2');

      const fetched = await DynamoManager.getDocument(testDocId);
      expect(fetched.current_s3_key).toBe(newKey);
    });
  });

  describe('Fix 1.7: HTTP 503 for SearchUnavailableError', () => {
    it('SearchUnavailableError has standard HTTP statusCode 503 instead of 533', () => {
      const error = new SearchUnavailableError('OpenSearch down');
      expect(error.statusCode).toBe(503);
      expect(error.code).toBe('SEARCH_UNAVAILABLE');
      expect(error.retryable).toBe(true);
    });
  });
});
