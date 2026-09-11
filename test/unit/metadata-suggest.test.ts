import { handler as metadataSuggestHandler } from '../../src/command-api/metadata-suggest';
import {
  partitionExtractedMetadata,
  suggestMetadataWithBedrock,
  buildEnrichmentPrompt,
} from '../../src/shared/enricher';

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

describe('AI-Assisted Metadata Pre-Fill Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MOCK_AUTH_BYPASS = 'true';
  });

  describe('partitionExtractedMetadata', () => {
    it('should cleanly divide attributes into shared and class-specific metadata, omitting system fields', () => {
      const rawExtracted = {
        document_id: 'should-be-omitted',
        document_class: 'loan_agreement',
        annotation_schema: 'bank.document-metadata/1',
        schema_version: 1,
        application_version: 1,
        metadata_revision: 1,
        created_at: '2026-09-01T00:00:00Z',
        created_by: 'uploader',
        // Shared banking fields:
        customer_id: 1094827,
        complete_customer_id_code: { id_number: '123456789', id_type: 1 },
        account_id: { bank_id: 10, branch_id: 802, account_number: 123456 },
        transaction_id: 'TX-2026-999',
        business_area_code: 100,
        // Class specific fields:
        document_type: 'SIGNED_AGREEMENT',
        loan_number: 'LN-2026-88821',
        loan_amount_minor_units: 5000000,
        currency: 'ILS',
        loan_type: 'MORTGAGE',
        branch_code: 'TLV-01',
        signed_date: '2026-03-12',
        contains_pii: true,
        pii_categories: ['NATIONAL_ID', 'FINANCIAL_ACCOUNT'],
      };

      const partitioned = partitionExtractedMetadata(rawExtracted, 'loan_agreement');

      // Verify shared
      expect(partitioned.shared_metadata).toEqual({
        customer_id: 1094827,
        complete_customer_id_code: { id_number: '123456789', id_type: 1 },
        account_id: { bank_id: 10, branch_id: 802, account_number: 123456 },
        transaction_id: 'TX-2026-999',
        business_area_code: 100,
      });

      // Verify class-specific
      expect(partitioned.class_metadata).toEqual({
        document_type: 'SIGNED_AGREEMENT',
        loan_number: 'LN-2026-88821',
        loan_amount_minor_units: 5000000,
        currency: 'ILS',
        loan_type: 'MORTGAGE',
        branch_code: 'TLV-01',
        signed_date: '2026-03-12',
        contains_pii: true,
        pii_categories: ['NATIONAL_ID', 'FINANCIAL_ACCOUNT'],
      });

      // Verify system fields were excluded
      expect(partitioned.shared_metadata.document_id).toBeUndefined();
      expect(partitioned.shared_metadata.created_at).toBeUndefined();
      expect(partitioned.class_metadata.schema_version).toBeUndefined();
    });
  });

  describe('suggestMetadataWithBedrock', () => {
    it('should round floating-point currency to integer minor units and enforce PII categories', async () => {
      mockBedrockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  loan_number: 'LN-2026-99123',
                  loan_amount_minor_units: 450000.75, // float from LLM
                  currency: 'USD',
                  contains_pii: true,
                  pii_categories: ['NATIONAL_ID', 'INVALID_CAT'],
                  customer_id: 554433,
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 250, outputTokens: 90 },
      });

      const res = await suggestMetadataWithBedrock('Loan Agreement snippet', 'loan_agreement');

      expect(res.class_metadata.loan_amount_minor_units).toBe(450001); // rounded to integer
      expect(res.class_metadata.loan_number).toBe('LN-2026-99123');
      expect(res.shared_metadata.customer_id).toBe(554433);
      expect(res.pii_detected.contains_pii).toBe(true);
      expect(res.pii_detected.pii_categories).toEqual(['NATIONAL_ID']);
      expect(res.audit.total_tokens).toBe(340);
    });
  });

  describe('metadataSuggestHandler Lambda', () => {
    it('should successfully extract and return partitioned metadata for loan_agreement', async () => {
      mockBedrockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  document_type: 'SIGNED_AGREEMENT',
                  loan_number: 'LN-2026-11223',
                  loan_amount_minor_units: 8000000,
                  currency: 'ILS',
                  loan_type: 'MORTGAGE',
                  branch_code: 'TLV-01',
                  signed_date: '2026-03-10',
                  customer_id: 998877,
                  transaction_id: 'TX-2026-001',
                  contains_pii: true,
                  pii_categories: ['FINANCIAL_ACCOUNT'],
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 180, outputTokens: 60 },
      });

      const event = {
        headers: {
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          document_class: 'loan_agreement',
          text_snippet: 'MORTGAGE AGREEMENT LN-2026-11223 for Customer 998877...',
        }),
        requestContext: { requestId: 'req-suggest-001' },
      } as any;

      const res = await metadataSuggestHandler(event);
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.status).toBe('SUCCESS');
      expect(body.document_class).toBe('loan_agreement');
      expect(body.shared_metadata.customer_id).toBe(998877);
      expect(body.shared_metadata.transaction_id).toBe('TX-2026-001');
      expect(body.class_metadata.loan_number).toBe('LN-2026-11223');
      expect(body.class_metadata.loan_amount_minor_units).toBe(8000000);
      expect(body.pii_detected.contains_pii).toBe(true);
    });

    it('should decode base64 file content and extract metadata', async () => {
      mockBedrockSend.mockResolvedValueOnce({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  document_type: 'FINANCIAL_LEDGER',
                  retention_schedule_code: 'RET-FIN-001',
                  retention_period_years: 7,
                  regulatory_framework: 'SOX',
                  retention_start_date: '2026-01-01',
                  customer_id: 112233,
                  contains_pii: false,
                  pii_categories: ['NONE'],
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 210, outputTokens: 75 },
      });

      const rawText = 'FINANCIAL LEDGER SOX RET-FIN-001 Retention 7 Years';
      const fileBase64 = Buffer.from(rawText).toString('base64');

      const event = {
        headers: {
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          document_class: 'compliance_retention',
          file_base64: fileBase64,
        }),
        requestContext: { requestId: 'req-suggest-002' },
      } as any;

      const res = await metadataSuggestHandler(event);
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.status).toBe('SUCCESS');
      expect(body.document_class).toBe('compliance_retention');
      expect(body.class_metadata.retention_schedule_code).toBe('RET-FIN-001');
      expect(body.class_metadata.retention_period_years).toBe(7);
      expect(body.shared_metadata.customer_id).toBe(112233);
      expect(body.pii_detected.contains_pii).toBe(false);
    });

    it('should reject requests with missing document_class', async () => {
      const event = {
        headers: { Authorization: 'Bearer mock-token' },
        body: JSON.stringify({ text_snippet: 'Some text...' }),
        requestContext: { requestId: 'req-suggest-err-1' },
      } as any;

      const res = await metadataSuggestHandler(event);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('document_class is required');
    });

    it('should reject requests with invalid document_class', async () => {
      const event = {
        headers: { Authorization: 'Bearer mock-token' },
        body: JSON.stringify({
          document_class: 'invalid_class',
          text_snippet: 'Some text...',
        }),
        requestContext: { requestId: 'req-suggest-err-2' },
      } as any;

      const res = await metadataSuggestHandler(event);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.message).toContain('Invalid document_class');
    });

    it('should reject requests without text_snippet or file_base64', async () => {
      const event = {
        headers: { Authorization: 'Bearer mock-token' },
        body: JSON.stringify({
          document_class: 'loan_agreement',
        }),
        requestContext: { requestId: 'req-suggest-err-3' },
      } as any;

      const res = await metadataSuggestHandler(event);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.message).toContain('Either text_snippet or file_base64 containing text is required');
    });

    it('should reject unauthenticated requests when mock bypass is disabled', async () => {
      delete process.env.MOCK_AUTH_BYPASS;

      const event = {
        headers: {},
        body: JSON.stringify({
          document_class: 'loan_agreement',
          text_snippet: 'Some text...',
        }),
        requestContext: { requestId: 'req-suggest-err-4' },
      } as any;

      const res = await metadataSuggestHandler(event);
      expect(res.statusCode).toBe(401);
    });
  });
});
