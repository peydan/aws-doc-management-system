import { SQSEvent, SQSRecord } from 'aws-lambda';
import { handler } from '../../src/background-worker/metadata-enricher';
import { S3Manager } from '../../src/shared/s3';
import { DynamoManager } from '../../src/shared/dynamo';
import {
  enrichMetadataWithBedrock,
  extractJsonFromLlmResponse,
} from '../../src/shared/enricher';

// Mock S3Client send
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

// Mock Bedrock client
const mockBedrockSend = jest.fn();
jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  return {
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
      send: (...args: any[]) => mockBedrockSend(...args),
    })),
    ConverseCommand: jest.fn().mockImplementation((input: any) => input),
  };
});

// Spy on S3Manager & DynamoManager
jest.mock('../../src/shared/s3');
jest.mock('../../src/shared/dynamo');

describe('LLM Metadata Enricher Unit Tests', () => {
  const mockBaseMetadata = {
    annotation_schema: 'bank.document-metadata/1',
    document_id: '11111111-2222-3333-4444-555555555555',
    document_class: 'loan_agreement',
    application_version: 1,
    metadata_revision: 1,
    schema_version: 1,
    document_type: 'SIGNED_AGREEMENT',
    loan_amount_minor_units: 50000000,
    currency: 'ILS',
    loan_type: 'MORTGAGE',
    branch_code: 'TLV-01',
    signed_date: '2026-09-01',
    content_type: 'application/pdf',
    content_length: 1024,
    content_checksum: 'sha256:abcdef1234567890',
    filename: 'sample_loan.pdf',
    created_at: '2026-09-10T12:00:00Z',
    created_by: 'test-uploader',
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
    confidentiality_tier: 'RESTRICTED',
    contains_pii: false,
    pii_categories: ['NONE'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUDIT_BUCKET_NAME = 'doc-platform-mvp-audit';
  });

  describe('extractJsonFromLlmResponse', () => {
    it('should parse raw JSON properly', () => {
      const parsed = extractJsonFromLlmResponse('{"loan_number": "LN-100"}');
      expect(parsed).toEqual({ loan_number: 'LN-100' });
    });

    it('should parse markdown fenced JSON codeblocks', () => {
      const text = '```json\n{"loan_number": "LN-200", "contains_pii": true}\n```';
      const parsed = extractJsonFromLlmResponse(text);
      expect(parsed).toEqual({ loan_number: 'LN-200', contains_pii: true });
    });

    it('should extract JSON embedded in conversational text', () => {
      const text = 'Here is the extracted metadata:\n{"loan_number": "LN-300"}\nThank you!';
      const parsed = extractJsonFromLlmResponse(text);
      expect(parsed).toEqual({ loan_number: 'LN-300' });
    });
  });

  describe('enrichMetadataWithBedrock Helper', () => {
    it('should enrich domain traits, discover PII, and preserve uploader confidentiality', async () => {
      mockBedrockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  loan_number: 'LN-2026-99999',
                  loan_amount_minor_units: 75000000,
                  currency: 'ILS',
                  signed_date: '2026-09-01',
                  branch_code: 'TLV-02',
                  contains_pii: true,
                  pii_categories: ['NATIONAL_ID', 'FINANCIAL_ACCOUNT'],
                  confidentiality_tier: 'PUBLIC', // LLM tries to downgrade!
                }),
              },
            ],
          },
        },
        usage: {
          inputTokens: 350,
          outputTokens: 85,
        },
      });

      const inputMeta = {
        ...mockBaseMetadata,
        loan_amount_minor_units: undefined,
        branch_code: undefined,
        signed_date: undefined,
        currency: 'ILS', // Existing currency
      };

      const { enrichedMetadata, auditDetails } = await enrichMetadataWithBedrock(
        'Loan agreement text snippet...',
        inputMeta,
        'loan_agreement'
      );

      // Domain traits enriched
      expect(enrichedMetadata.loan_number).toBe('LN-2026-99999');
      expect(enrichedMetadata.loan_amount_minor_units).toBe(75000000);
      expect(enrichedMetadata.signed_date).toBe('2026-09-01');
      expect(enrichedMetadata.branch_code).toBe('TLV-02');
      expect(enrichedMetadata.currency).toBe('ILS'); // Uploader currency preserved

      // PII discovery enriched
      expect(enrichedMetadata.contains_pii).toBe(true);
      expect(enrichedMetadata.pii_categories).toContain('NATIONAL_ID');
      expect(enrichedMetadata.pii_categories).toContain('FINANCIAL_ACCOUNT');

      // Governance: confidentiality_tier preserved as RESTRICTED (not downgraded to PUBLIC)
      expect(enrichedMetadata.confidentiality_tier).toBe('RESTRICTED');
      expect(auditDetails.applied_diff.fields_ignored_due_to_uploader_precedence).toContain('confidentiality_tier');
      expect(auditDetails.total_tokens).toBe(435);
    });

    it('should enforce the safety ratchet and union PII categories', async () => {
      const metadataWithExistingPii = {
        ...mockBaseMetadata,
        contains_pii: true,
        pii_categories: ['NATIONAL_ID'],
      };

      mockBedrockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  contains_pii: false, // LLM fails to detect, attempts downgrade
                  pii_categories: ['FINANCIAL_ACCOUNT'],
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 100, outputTokens: 20 },
      });

      const { enrichedMetadata } = await enrichMetadataWithBedrock(
        'Some snippet',
        metadataWithExistingPii,
        'loan_agreement'
      );

      // Non-downgrade guarantee: remains true
      expect(enrichedMetadata.contains_pii).toBe(true);
      // Union of categories: has both NATIONAL_ID and FINANCIAL_ACCOUNT
      expect(enrichedMetadata.pii_categories).toEqual(
        expect.arrayContaining(['NATIONAL_ID', 'FINANCIAL_ACCOUNT'])
      );
    });
  });

  describe('Lambda Handler Execution', () => {
    const createSqsEvent = (body: any): SQSEvent => ({
      Records: [
        {
          messageId: 'msg-001',
          receiptHandle: 'receipt-001',
          body: JSON.stringify(body),
          attributes: {} as any,
          messageAttributes: {},
          md5OfBody: 'md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:enrichment-queue',
          awsRegion: 'us-east-1',
        },
      ],
    });

    it('should process SQS message, enrich metadata, update S3 and DynamoDB, and write audit log', async () => {
      (S3Manager.getAnnotation as jest.Mock).mockResolvedValueOnce({
        metadata: { ...mockBaseMetadata },
        eTag: 'anno-etag-1',
      });

      (S3Manager.getDocumentKey as jest.Mock).mockReturnValue('documents/loan_agreement/11111111-2222-3333-4444-555555555555');
      (S3Manager.getObjectBuffer as jest.Mock).mockResolvedValueOnce({
        body: Buffer.from('Loan Document Content for Account 998877 with ID 987654321'),
        contentType: 'application/pdf',
      });

      mockBedrockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  loan_number: 'LN-2026-77777',
                  loan_amount_minor_units: 50000000,
                  branch_code: 'TLV-01',
                  signed_date: '2026-08-20',
                  contains_pii: true,
                  pii_categories: ['FINANCIAL_ACCOUNT'],
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 200, outputTokens: 50 },
      });

      (S3Manager.putAnnotation as jest.Mock).mockResolvedValueOnce({
        eTag: 'anno-etag-2',
      });

      (DynamoManager.updateMetadataRevision as jest.Mock).mockResolvedValueOnce({
        current_metadata_revision: 2,
      });

      const event = createSqsEvent({
        document_id: '11111111-2222-3333-4444-555555555555',
        document_class: 'loan_agreement',
        s3_version_id: 'v1-s3-id',
        expected_metadata_revision: 1,
      });

      await handler(event);

      // Verify S3 putAnnotation called with bumped revision 2
      expect(S3Manager.putAnnotation).toHaveBeenCalledWith(
        'loan_agreement',
        '11111111-2222-3333-4444-555555555555',
        'v1-s3-id',
        expect.objectContaining({
          metadata_revision: 2,
          metadata_updated_by: 'system:llm-enricher',
          loan_number: 'LN-2026-77777',
          contains_pii: true,
        })
      );

      // Verify DynamoDB OCC update (DynamoDB claimed first, then annotation eTag updated post-S3 write)
      expect(DynamoManager.updateMetadataRevision).toHaveBeenCalledWith(
        '11111111-2222-3333-4444-555555555555',
        1,
        2,
        'pending'
      );
      expect(DynamoManager.updateAnnotationEtag).toHaveBeenCalledWith(
        '11111111-2222-3333-4444-555555555555',
        2,
        'anno-etag-2'
      );

      // Verify audit trail logged to S3
      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: 'doc-platform-mvp-audit',
            Key: expect.stringContaining('audit/llm-enrichment/'),
          }),
        })
      );
    });

    it('should skip enrichment if skip_enrichment is true', async () => {
      (S3Manager.getAnnotation as jest.Mock).mockResolvedValueOnce({
        metadata: {
          ...mockBaseMetadata,
          skip_enrichment: true,
        },
        eTag: 'anno-etag-1',
      });

      const event = createSqsEvent({
        document_id: '11111111-2222-3333-4444-555555555555',
        document_class: 'loan_agreement',
        s3_version_id: 'v1-s3-id',
        expected_metadata_revision: 1,
      });

      await handler(event);

      expect(mockBedrockSend).not.toHaveBeenCalled();
      expect(S3Manager.putAnnotation).not.toHaveBeenCalled();
      expect(DynamoManager.updateMetadataRevision).not.toHaveBeenCalled();
    });

    it('should skip enrichment if loan_number is already provided for loan_agreement', async () => {
      (S3Manager.getAnnotation as jest.Mock).mockResolvedValueOnce({
        metadata: {
          ...mockBaseMetadata,
          loan_number: 'LN-ALREADY-EXISTS',
        },
        eTag: 'anno-etag-1',
      });

      const event = createSqsEvent({
        document_id: '11111111-2222-3333-4444-555555555555',
        document_class: 'loan_agreement',
        s3_version_id: 'v1-s3-id',
        expected_metadata_revision: 1,
      });

      await handler(event);

      expect(mockBedrockSend).not.toHaveBeenCalled();
      expect(S3Manager.putAnnotation).not.toHaveBeenCalled();
    });

    it('should handle concurrent human edit (ConditionalCheckFailedException) gracefully without throwing', async () => {
      (S3Manager.getAnnotation as jest.Mock).mockResolvedValueOnce({
        metadata: { ...mockBaseMetadata },
        eTag: 'anno-etag-1',
      });

      (S3Manager.getDocumentKey as jest.Mock).mockReturnValue('documents/loan_agreement/11111111-2222-3333-4444-555555555555');
      (S3Manager.getObjectBuffer as jest.Mock).mockResolvedValueOnce({
        body: Buffer.from('Document body'),
        contentType: 'application/pdf',
      });

      mockBedrockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [{ text: JSON.stringify({ loan_number: 'LN-888' }) }],
          },
        },
        usage: { inputTokens: 50, outputTokens: 20 },
      });

      (S3Manager.putAnnotation as jest.Mock).mockResolvedValueOnce({
        eTag: 'anno-etag-2',
      });

      const conflictError: any = new Error('ConditionalCheckFailedException');
      conflictError.name = 'ConditionalCheckFailedException';
      (DynamoManager.updateMetadataRevision as jest.Mock).mockRejectedValueOnce(conflictError);

      const event = createSqsEvent({
        document_id: '11111111-2222-3333-4444-555555555555',
        document_class: 'loan_agreement',
        s3_version_id: 'v1-s3-id',
        expected_metadata_revision: 1,
      });

      // Should complete without throwing so message is acknowledged and not retried
      await expect(handler(event)).resolves.not.toThrow();
    });
  });
});
