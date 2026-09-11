import { executeSearchDocuments, handler as searchToolHandler } from '../../src/agent/tools/search-tool';
import { executeFetchDocument, handler as fetchToolHandler } from '../../src/agent/tools/fetch-tool';
import { handler as chatHandler, getOrCreateSession, runAgentConversation } from '../../src/agent/chat-handler';
import { OpenSearchManager } from '../../src/shared/opensearch';
import { DynamoManager } from '../../src/shared/dynamo';
import { S3Manager } from '../../src/shared/s3';
import { authenticateRequest, authorizeRoles } from '../../src/shared/auth';

// Mock Bedrock client
const mockBedrockSend = jest.fn();
jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  return {
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
      send: (...args: any[]) => mockBedrockSend(...args),
    })),
    ConverseCommand: jest.fn().mockImplementation((input: any) => input),
    ConverseStreamCommand: jest.fn().mockImplementation((input: any) => input),
  };
});

// Mock shared managers
jest.mock('../../src/shared/opensearch');
jest.mock('../../src/shared/dynamo');
jest.mock('../../src/shared/s3');
jest.mock('../../src/shared/auth');

describe('AI Conversational Document Assistant Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authenticateRequest as jest.Mock).mockResolvedValue({
      sub: 'usr-123',
      username: 'agent-user',
      roles: ['Document.Reader'],
    });
  });

  describe('Search Documents Tool', () => {
    it('should format search filters and return mapped document summaries', async () => {
      (OpenSearchManager.searchDocuments as jest.Mock).mockResolvedValue({
        total: 1,
        next_cursor: null,
        items: [
          {
            document_id: 'doc-1234-uuid',
            filename: 'loan_contract.pdf',
            document_class: 'loan_agreement',
            document_type: 'SIGNED_AGREEMENT',
            status: 'ACTIVE',
            application_version: 2,
            metadata_revision: 3,
            customer_id: 998877,
            loan_number: 'LN-2026-999',
            loan_amount_minor_units: 75000000,
            currency: 'ILS',
            created_at: '2026-09-01T10:00:00Z',
          },
        ],
      });

      const result = await executeSearchDocuments({
        customer_id: 998877,
        loan_number: 'LN-2026-999',
        document_class: 'loan_agreement',
      });

      expect(result.total_found).toBe(1);
      expect(result.count_returned).toBe(1);
      expect(result.documents[0].document_id).toBe('doc-1234-uuid');
      expect(result.documents[0].loan_amount_minor_units).toBe(75000000);
      expect(result.documents[0].currency).toBe('ILS');
    });

    it('should handle MCP handler wrapper format correctly', async () => {
      (OpenSearchManager.searchDocuments as jest.Mock).mockResolvedValue({
        total: 0,
        items: [],
      });

      const mcpResponse = await searchToolHandler({
        arguments: { query: 'nonexistent' },
      });

      expect(mcpResponse.content).toBeDefined();
      expect(mcpResponse.content[0].type).toBe('text');
      const parsed = JSON.parse(mcpResponse.content[0].text);
      expect(parsed.total_found).toBe(0);
      expect(parsed.documents).toEqual([]);
    });
  });

  describe('Fetch Document Tool', () => {
    it('should resolve active document, fetch authoritative annotation, and return presigned URL', async () => {
      (DynamoManager.getDocument as jest.Mock).mockResolvedValue({
        document_id: 'doc-active-1',
        document_class: 'loan_agreement',
        current_s3_key: 'loan_agreement/doc-active-1/content.pdf',
        current_s3_version_id: 'v-s3-1',
        current_application_version: 1,
        current_metadata_revision: 2,
        status: 'ACTIVE',
        created_at: '2026-09-01T12:00:00Z',
      });

      (S3Manager.getAnnotation as jest.Mock).mockResolvedValue({
        annotation_schema: 'bank.document-metadata/1',
        metadata: {
          document_id: 'doc-active-1',
          document_class: 'loan_agreement',
          filename: 'signed_loan.pdf',
          content_type: 'application/pdf',
          loan_number: 'LN-2026-101',
          loan_amount_minor_units: 12000000,
          currency: 'USD',
          format: 'pdf',
          page_count: 5,
        },
      });

      (S3Manager.generatePresignedDownloadUrl as jest.Mock).mockResolvedValue(
        'https://s3.amazonaws.com/doc-bucket/content.pdf?signature=xyz'
      );

      const result = await executeFetchDocument({ document_id: 'doc-active-1' });

      expect(result.document_id).toBe('doc-active-1');
      expect(result.status).toBe('ACTIVE');
      expect(result.filename).toBe('signed_loan.pdf');
      expect(result.presigned_download_url).toBe(
        'https://s3.amazonaws.com/doc-bucket/content.pdf?signature=xyz'
      );
      expect(result.authoritative_metadata.loan_amount_minor_units).toBe(12000000);
    });

    it('should reject soft-deleted document binary access and warn the agent', async () => {
      (DynamoManager.getDocument as jest.Mock).mockResolvedValue({
        document_id: 'doc-soft-deleted',
        document_class: 'loan_agreement',
        current_application_version: 1,
        current_metadata_revision: 1,
        status: 'SOFT_DELETED',
        created_at: '2026-08-01T12:00:00Z',
      });

      const result = await executeFetchDocument({ document_id: 'doc-soft-deleted' });

      expect(result.status).toBe('SOFT_DELETED');
      expect(result.notice).toContain('SOFT_DELETED');
      expect(result.presigned_download_url).toBeUndefined();
      expect(S3Manager.getAnnotation).not.toHaveBeenCalled();
    });

    it('should format MCP response in fetchToolHandler', async () => {
      (DynamoManager.getDocument as jest.Mock).mockResolvedValue({
        document_id: 'doc-test-mcp',
        document_class: 'compliance_retention',
        current_s3_key: 'comp/content.pdf',
        current_s3_version_id: 'ver-1',
        current_application_version: 1,
        current_metadata_revision: 1,
        status: 'ACTIVE',
        created_at: '2026-09-01T00:00:00Z',
      });

      (S3Manager.getAnnotation as jest.Mock).mockResolvedValue({
        metadata: { filename: 'audit.pdf', content_type: 'application/pdf' },
      });

      const mcpResponse = await fetchToolHandler({
        arguments: { document_id: 'doc-test-mcp' },
      });

      expect(mcpResponse.content).toBeDefined();
      expect(mcpResponse.content[0].type).toBe('text');
      const parsed = JSON.parse(mcpResponse.content[0].text);
      expect(parsed.document_id).toBe('doc-test-mcp');
    });

    it('should enforce OBO clearance policy and deny access when user role is below minimum_clearance_role', async () => {
      (DynamoManager.getDocument as jest.Mock).mockResolvedValue({
        document_id: 'doc-restricted-secret',
        document_class: 'security_classification',
        current_s3_key: 'sec/secret.pdf',
        current_s3_version_id: 'ver-s3-sec',
        current_application_version: 1,
        current_metadata_revision: 1,
        status: 'ACTIVE',
        created_at: '2026-09-01T00:00:00Z',
      });

      (S3Manager.getAnnotation as jest.Mock).mockResolvedValue({
        metadata: {
          document_id: 'doc-restricted-secret',
          document_class: 'security_classification',
          filename: 'board_resolutions.pdf',
          minimum_clearance_role: 'Document.Admin',
          confidentiality_tier: 'HIGHLY_CONFIDENTIAL',
        },
      });

      // Caller only holds Document.Reader
      const readerContext = {
        userId: 'regular-reader',
        roles: ['Document.Reader' as const],
      };

      const result = await executeFetchDocument(
        { document_id: 'doc-restricted-secret' },
        readerContext
      );

      expect(result.status).toBe('FORBIDDEN');
      expect(result.notice).toContain('ACCESS DENIED (OBO Clearance Policy)');
      expect(result.notice).toContain('Document.Admin');
      expect(result.presigned_download_url).toBeUndefined();
    });

    it('should grant access to restricted document when caller holds Document.Admin', async () => {
      (DynamoManager.getDocument as jest.Mock).mockResolvedValue({
        document_id: 'doc-restricted-secret',
        document_class: 'security_classification',
        current_s3_key: 'sec/secret.pdf',
        current_s3_version_id: 'ver-s3-sec',
        current_application_version: 1,
        current_metadata_revision: 1,
        status: 'ACTIVE',
        created_at: '2026-09-01T00:00:00Z',
      });

      (S3Manager.getAnnotation as jest.Mock).mockResolvedValue({
        metadata: {
          document_id: 'doc-restricted-secret',
          document_class: 'security_classification',
          filename: 'board_resolutions.pdf',
          minimum_clearance_role: 'Document.Admin',
          confidentiality_tier: 'HIGHLY_CONFIDENTIAL',
        },
      });

      (S3Manager.generatePresignedDownloadUrl as jest.Mock).mockResolvedValue(
        'https://s3.amazonaws.com/doc-bucket/sec/secret.pdf?sig=admin'
      );

      // Caller holds Document.Admin
      const adminContext = {
        userId: 'admin-user',
        roles: ['Document.Admin' as const],
      };

      const result = await executeFetchDocument(
        { document_id: 'doc-restricted-secret' },
        adminContext
      );

      expect(result.status).toBe('ACTIVE');
      expect(result.notice).toBeUndefined();
      expect(result.presigned_download_url).toBe('https://s3.amazonaws.com/doc-bucket/sec/secret.pdf?sig=admin');
    });

    it('should filter out documents exceeding caller clearance during search_documents', async () => {
      (OpenSearchManager.searchDocuments as jest.Mock).mockResolvedValue({
        total: 2,
        items: [
          {
            document_id: 'doc-public-loan',
            filename: 'loan.pdf',
            document_class: 'loan_agreement',
            minimum_clearance_role: 'Document.Reader',
            confidentiality_tier: 'INTERNAL',
          },
          {
            document_id: 'doc-secret-board',
            filename: 'board.pdf',
            document_class: 'security_classification',
            minimum_clearance_role: 'Document.Admin',
            confidentiality_tier: 'HIGHLY_CONFIDENTIAL',
          },
        ],
      });

      const readerContext = {
        userId: 'loan-officer',
        roles: ['Document.Reader' as const],
      };

      const searchResult = await executeSearchDocuments({}, readerContext);

      // Only the public/internal loan should be returned
      expect(searchResult.total_found).toBe(1);
      expect(searchResult.documents.length).toBe(1);
      expect(searchResult.documents[0].document_id).toBe('doc-public-loan');
    });
  });

  describe('Agent Chat Handler & Session Memory', () => {
    it('should manage ephemeral session memory across turns', () => {
      const session1 = getOrCreateSession('custom-session-1');
      expect(session1.id).toBe('custom-session-1');
      expect(session1.messages).toEqual([]);

      session1.messages.push({ role: 'user', content: [{ text: 'Hello' }] });

      const sessionReused = getOrCreateSession('custom-session-1');
      expect(sessionReused.messages.length).toBe(1);
    });

    it('should execute end-to-end agent loop with tool calls and citations', async () => {
      // Step 1: Model requests tool use: search_documents
      mockBedrockSend
        .mockResolvedValueOnce({
          stopReason: 'tool_use',
          output: {
            message: {
              role: 'assistant',
              content: [
                {
                  toolUse: {
                    toolUseId: 'call_search_1',
                    name: 'search_documents',
                    input: { loan_number: 'LN-2026-888' },
                  },
                },
              ],
            },
          },
        })
        // Step 2: Model receives tool result, then calls fetch_document
        .mockResolvedValueOnce({
          stopReason: 'tool_use',
          output: {
            message: {
              role: 'assistant',
              content: [
                {
                  toolUse: {
                    toolUseId: 'call_fetch_2',
                    name: 'fetch_document',
                    input: { document_id: 'doc-found-888' },
                  },
                },
              ],
            },
          },
        })
        // Step 3: Model receives document, generates final grounded answer
        .mockResolvedValueOnce({
          stopReason: 'end_turn',
          output: {
            message: {
              role: 'assistant',
              content: [
                {
                  text: 'Loan LN-2026-888 (Document DOC#doc-found-888, Version 1) has an amount of 50,000.00 USD with an interest rate of 4.5%.',
                },
              ],
            },
          },
        });

      (OpenSearchManager.searchDocuments as jest.Mock).mockResolvedValue({
        total: 1,
        items: [
          {
            document_id: 'doc-found-888',
            filename: 'loan_agreement_888.pdf',
            document_class: 'loan_agreement',
            status: 'ACTIVE',
            application_version: 1,
            loan_number: 'LN-2026-888',
          },
        ],
      });

      (DynamoManager.getDocument as jest.Mock).mockResolvedValue({
        document_id: 'doc-found-888',
        document_class: 'loan_agreement',
        current_s3_key: 'loan_agreement/doc-found-888/loan.pdf',
        current_s3_version_id: 'v1',
        current_application_version: 1,
        current_metadata_revision: 1,
        status: 'ACTIVE',
        created_at: '2026-09-01T00:00:00Z',
      });

      (S3Manager.getAnnotation as jest.Mock).mockResolvedValue({
        metadata: {
          document_id: 'doc-found-888',
          document_class: 'loan_agreement',
          filename: 'loan_agreement_888.pdf',
          loan_amount_minor_units: 5000000,
          currency: 'USD',
        },
      });

      const events: any[] = [];
      const result = await runAgentConversation(
        'test-chat-session',
        'What is the amount for loan LN-2026-888?',
        (evt) => events.push(evt)
      );

      expect(result.message).toContain('50,000.00 USD');
      expect(result.tools_used).toContain('search_documents');
      expect(result.tools_used).toContain('fetch_document');
      expect(result.citations.length).toBe(1);
      expect(result.citations[0].document_id).toBe('doc-found-888');

      // Verify event notifications occurred
      expect(events.some((e) => e.type === 'tool_call')).toBe(true);
      expect(events.some((e) => e.type === 'progress')).toBe(true);
      expect(events.some((e) => e.type === 'done')).toBe(true);
    });

    it('should return 200 with JSON response on REST API POST /agent/chat', async () => {
      mockBedrockSend.mockResolvedValueOnce({
        stopReason: 'end_turn',
        output: {
          message: {
            role: 'assistant',
            content: [{ text: 'Hello, how can I assist you with your banking documents today?' }],
          },
        },
      });

      const event: any = {
        requestContext: { requestId: 'req-test-123' },
        headers: { Authorization: 'Bearer test-jwt' },
        body: JSON.stringify({ message: 'Hello' }),
      };

      const res = await chatHandler(event);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.message).toContain('Hello');
      expect(parsed.session_id).toBeDefined();
    });

    it('should validate message presence and return 400 on empty prompt', async () => {
      const event: any = {
        requestContext: { requestId: 'req-bad-prompt' },
        headers: { Authorization: 'Bearer test-jwt' },
        body: JSON.stringify({}),
      };

      const res = await chatHandler(event);
      expect(res.statusCode).toBe(400);
      const parsed = JSON.parse(res.body);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
