import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  Message,
  Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { v4 as uuidv4 } from 'uuid';
import { authenticateRequest, authorizeRoles, UserContext } from '../shared/auth';
import { parseJsonBody } from '../shared/validator';
import { Logger } from '../shared/logger';
import { CORS_HEADERS } from '../shared/headers';
import { AGENT_SYSTEM_PROMPT, AGENT_MODEL_ID } from './prompts';
import { executeSearchDocuments, SearchDocumentsArgs } from './tools/search-tool';
import { executeFetchDocument, FetchDocumentArgs } from './tools/fetch-tool';

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Ephemeral in-memory session cache with 1-hour TTL
interface SessionData {
  messages: Message[];
  lastAccessed: number;
}
const ephemeralSessions = new Map<string, SessionData>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of ephemeralSessions.entries()) {
    if (now - session.lastAccessed > SESSION_TTL_MS) {
      ephemeralSessions.delete(id);
    }
  }
}

export function getOrCreateSession(sessionId?: string): { id: string; messages: Message[] } {
  cleanExpiredSessions();
  const id = sessionId || uuidv4();
  let session = ephemeralSessions.get(id);
  if (!session) {
    session = { messages: [], lastAccessed: Date.now() };
    ephemeralSessions.set(id, session);
  } else {
    session.lastAccessed = Date.now();
  }
  return { id, messages: session.messages };
}

export const AGENT_TOOLS: Tool[] = [
  {
    toolSpec: {
      name: 'search_documents',
      description:
        'Search for documents in the platform by customer ID, loan number, document class, type, or date range.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Free-text search query or keyword' },
            customer_id: { type: 'number', description: 'Banking customer ID' },
            loan_number: { type: 'string', description: 'Loan agreement reference number (e.g. LN-2026-88821)' },
            document_class: {
              type: 'string',
              enum: ['loan_agreement', 'compliance_retention', 'security_classification'],
              description: 'Top-level document class',
            },
            document_type: { type: 'string', description: 'Specific document sub-type' },
            loan_type: { type: 'string', enum: ['MORTGAGE', 'PERSONAL', 'COMMERCIAL', 'AUTO'] },
            branch_code: { type: 'string', description: 'Branch code (e.g. TLV-01)' },
            created_from: { type: 'string', description: 'Creation date filter start (YYYY-MM-DD)' },
            created_to: { type: 'string', description: 'Creation date filter end (YYYY-MM-DD)' },
            limit: { type: 'number', description: 'Maximum results to return (default: 5, max: 20)' },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'fetch_document',
      description:
        'Fetch authoritative document metadata, status, application version, and presigned download URL.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            document_id: { type: 'string', description: 'Unique UUIDv4 of the document' },
            version: { type: 'number', description: 'Optional specific application version' },
          },
          required: ['document_id'],
        },
      },
    },
  },
];

export interface Citation {
  document_id: string;
  application_version: number;
  filename: string;
  document_class: string;
}

export interface AgentProgressEvent {
  type: 'progress' | 'tool_call' | 'tool_result' | 'text_delta' | 'done' | 'error';
  data: Record<string, any>;
}

export interface AgentRunResult {
  sessionId: string;
  message: string;
  citations: Citation[];
  tools_used: string[];
}

/**
 * Executes the agent loop: calls Amazon Nova 2 Lite, dispatches tools, and updates ephemeral session memory.
 */
export async function runAgentConversation(
  sessionId: string,
  userMessage: string,
  onEvent?: (event: AgentProgressEvent) => void,
  userContext?: UserContext
): Promise<AgentRunResult> {
  const { messages } = getOrCreateSession(sessionId);

  // Append incoming user turn
  messages.push({
    role: 'user',
    content: [{ text: userMessage }],
  });

  const citations: Citation[] = [];
  const toolsUsed: string[] = [];
  let finalAnswer = '';
  let maxTurns = 5; // Guard against infinite tool loops

  while (maxTurns > 0) {
    maxTurns--;

    Logger.info('Calling Bedrock Converse with Amazon Nova 2 Lite', {
      modelId: AGENT_MODEL_ID,
      sessionId,
      messageCount: messages.length,
      callerUser: userContext?.userId,
    });

    const response = await bedrockClient.send(
      new ConverseCommand({
        modelId: AGENT_MODEL_ID,
        system: [{ text: AGENT_SYSTEM_PROMPT }],
        messages,
        toolConfig: {
          tools: AGENT_TOOLS,
        },
        inferenceConfig: {
          temperature: 0.2,
          maxTokens: 4096,
        },
      })
    );

    const outputMessage = response.output?.message;
    if (!outputMessage) {
      throw new Error('Empty response from Bedrock model');
    }

    messages.push(outputMessage);

    // Check if model requested tool use
    const toolUseBlocks = (outputMessage.content || []).filter((block) => block.toolUse);

    if (toolUseBlocks.length === 0) {
      // Model concluded turn
      const textBlocks = (outputMessage.content || [])
        .filter((b) => b.text)
        .map((b) => (b.text || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim())
        .filter((t) => t.length > 0);
      finalAnswer = textBlocks.join('\n');
      if (onEvent) {
        onEvent({ type: 'text_delta', data: { delta: finalAnswer } });
      }
      break;
    }

    // Execute tool blocks
    const toolResultContents: any[] = [];

    for (const block of toolUseBlocks) {
      const toolUse = block.toolUse!;
      const toolName = toolUse.name;
      const toolInput = toolUse.input as any;
      toolsUsed.push(toolName || 'unknown');

      Logger.info(`Executing agent tool: ${toolName}`, { toolInput, callerUser: userContext?.userId });

      if (onEvent) {
        onEvent({
          type: 'tool_call',
          data: { tool: toolName, input: toolInput },
        });
      }

      let toolOutput: any;
      try {
        if (toolName === 'search_documents') {
          if (onEvent) {
            onEvent({
              type: 'progress',
              data: { status: `Searching documents for criteria...` },
            });
          }
          toolOutput = await executeSearchDocuments(toolInput as SearchDocumentsArgs, userContext);
        } else if (toolName === 'fetch_document') {
          if (onEvent) {
            onEvent({
              type: 'progress',
              data: { status: `Fetching document DOC#${toolInput.document_id}...` },
            });
          }
          const fetchRes = await executeFetchDocument(toolInput as FetchDocumentArgs, userContext);
          toolOutput = fetchRes;

          // Track citation if active and not forbidden
          if (fetchRes.status !== 'SOFT_DELETED' && fetchRes.status !== 'FORBIDDEN') {
            citations.push({
              document_id: fetchRes.document_id,
              application_version: fetchRes.application_version,
              filename: fetchRes.filename,
              document_class: fetchRes.authoritative_metadata?.document_class || 'unknown',
            });
          }
        } else {
          toolOutput = { error: `Unsupported tool: ${toolName}` };
        }
      } catch (err: any) {
        toolOutput = { error: err.message };
      }

      if (onEvent) {
        onEvent({
          type: 'tool_result',
          data: { tool: toolName, output: toolOutput },
        });
      }

      toolResultContents.push({
        toolResult: {
          toolUseId: toolUse.toolUseId,
          content: [{ json: toolOutput }],
          status: toolOutput.error ? 'error' : 'success',
        },
      });
    }

    // Append tool results to conversation history as a user turn
    messages.push({
      role: 'user',
      content: toolResultContents,
    });
  }

  if (onEvent) {
    onEvent({
      type: 'done',
      data: { sessionId, citations, tools_used: toolsUsed },
    });
  }

  return {
    sessionId,
    message: finalAnswer,
    citations,
    tools_used: toolsUsed,
  };
}

/**
 * Synchronous REST API Gateway Handler (POST /agent/chat)
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Reader', 'Document.Writer', 'Document.MetadataEditor', 'Document.Admin']);

    const body = parseJsonBody(event);
    const userPrompt = body.message || body.prompt;
    if (!userPrompt || typeof userPrompt !== 'string') {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A valid string "message" is required.',
            correlation_id: correlationId,
          },
        }),
      };
    }

    const sessionId = body.sessionId || body.session_id || uuidv4();
    const result = await runAgentConversation(sessionId, userPrompt, undefined, user);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        session_id: result.sessionId,
        message: result.message,
        citations: result.citations,
        tools_used: result.tools_used,
        correlation_id: correlationId,
      }),
    };
  } catch (err: any) {
    Logger.error('Error in agent chat handler', err, { correlationId });
    const statusCode = err.statusCode || 500;
    return {
      statusCode,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message,
          correlation_id: correlationId,
        },
      }),
    };
  }
}

/**
 * Lambda Function URL Streaming Handler (SSE / RESPONSE_STREAM)
 * Compatible with awslambda.streamifyResponse
 */
declare const awslambda: any;

export const streamingHandler =
  typeof awslambda !== 'undefined' && awslambda.streamifyResponse
    ? awslambda.streamifyResponse(
        async (event: any, responseStream: any, _context: any) => {
          const httpResponseMetadata = {
            statusCode: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            },
          };

          responseStream = awslambda.HttpResponseStream.from(
            responseStream,
            httpResponseMetadata
          );

          try {
            // Validate user identity from Bearer token
            let userContext: UserContext | undefined;
            try {
              userContext = await authenticateRequest(event);
              authorizeRoles(userContext, ['Document.Reader', 'Document.Writer', 'Document.MetadataEditor', 'Document.Admin']);
            } catch (authErr: any) {
              responseStream.write(
                `event: error\ndata: ${JSON.stringify({ code: 'UNAUTHORIZED', message: authErr.message })}\n\n`
              );
              responseStream.end();
              return;
            }

            const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
            const userPrompt = body.message || body.prompt || '';
            const sessionId = body.sessionId || body.session_id || uuidv4();

            if (!userPrompt) {
              responseStream.write(
                `event: error\ndata: ${JSON.stringify({ message: 'Missing message parameter' })}\n\n`
              );
              responseStream.end();
              return;
            }

            await runAgentConversation(
              sessionId,
              userPrompt,
              (event) => {
                responseStream.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
              },
              userContext
            );

            responseStream.end();
          } catch (err: any) {
            responseStream.write(
              `event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`
            );
            responseStream.end();
          }
        }
      )
    : handler;
