import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { parseJsonBody } from '../shared/validator';
import { suggestMetadataWithBedrock, extractTextFromPdfBuffer } from '../shared/enricher';
import { Logger } from '../shared/logger';
import { PlatformError, ValidationError, isPlatformError } from '../shared/errors';
import { CORS_HEADERS } from '../shared/headers';

const ALLOWED_CLASSES = new Set(['loan_agreement', 'compliance_retention', 'security_classification']);

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Reader', 'Document.Writer', 'Document.MetadataEditor', 'Document.Admin']);

    const payload = parseJsonBody(event);
    const documentClass = payload.document_class;

    if (!documentClass || typeof documentClass !== 'string') {
      throw new ValidationError('document_class is required and must be a string');
    }

    if (!ALLOWED_CLASSES.has(documentClass)) {
      throw new ValidationError(
        `Invalid document_class '${documentClass}'. Must be one of: ${Array.from(ALLOWED_CLASSES).join(', ')}`
      );
    }

    let textSnippet = '';
    if (typeof payload.text_snippet === 'string' && payload.text_snippet.trim().length > 0) {
      textSnippet = payload.text_snippet.trim();
    } else if (typeof payload.file_base64 === 'string' && payload.file_base64.trim().length > 0) {
      try {
        const rawBase64 = payload.file_base64.includes(',')
          ? payload.file_base64.split(',')[1]
          : payload.file_base64;
        const buf = Buffer.from(rawBase64, 'base64');
        if (buf.subarray(0, 5).toString('latin1') === '%PDF-') {
          const pdfExtracted = extractTextFromPdfBuffer(buf);
          textSnippet = pdfExtracted || buf.toString('latin1').substring(0, 4000);
        } else {
          textSnippet = buf.toString('utf-8');
        }
      } catch (decodeErr: any) {
        throw new ValidationError(`Failed to decode file_base64: ${decodeErr.message}`);
      }
    }

    if (!textSnippet || textSnippet.length === 0) {
      throw new ValidationError('Either text_snippet or file_base64 containing text is required');
    }

    const existingMetadata = typeof payload.existing_metadata === 'object' && payload.existing_metadata !== null
      ? payload.existing_metadata
      : {};

    Logger.info('Invoking Bedrock for metadata suggestion', {
      correlationId,
      documentClass,
      snippetLength: textSnippet.length,
      userId: user.userId,
    });

    const result = await suggestMetadataWithBedrock(textSnippet, documentClass, existingMetadata);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: 'SUCCESS',
        document_class: result.document_class || documentClass,
        shared_metadata: result.shared_metadata,
        class_metadata: result.class_metadata,
        pii_detected: result.pii_detected,
        audit: result.audit,
      }),
    };
  } catch (err: any) {
    Logger.error('Metadata suggest error', err, { correlationId });
    if (err instanceof PlatformError || isPlatformError(err)) {
      return {
        statusCode: err.statusCode,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: err.code,
            message: err.message,
            retryable: err.retryable,
            details: err.details,
          },
        }),
      };
    }
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: err.message || 'An unexpected error occurred while analyzing metadata',
          retryable: false,
        },
      }),
    };
  }
}
