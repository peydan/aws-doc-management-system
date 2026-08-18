import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { authenticateRequest, authorizeRoles } from '../shared/auth';
import { parseJsonBody } from '../shared/validator';
import { OpenSearchManager } from '../shared/opensearch';
import { Logger } from '../shared/logger';
import { PlatformError, SearchUnavailableError } from '../shared/errors';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId = event.requestContext.requestId;
  try {
    const user = await authenticateRequest(event);
    authorizeRoles(user, ['Document.Reader', 'Document.Writer', 'Document.MetadataEditor', 'Document.Admin']);

    const body = parseJsonBody(event);
    const filters = body.filters || {};
    const sort = body.sort;
    const pageSize = body.page_size || 20;
    const cursor = body.cursor || null;

    try {
      const searchResult = await OpenSearchManager.searchDocuments({
        filters,
        sort,
        page_size: pageSize,
        cursor,
      });

      Logger.info('Search query executed', { resultCount: searchResult.items.length, correlationId });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: searchResult.items,
          next_cursor: searchResult.next_cursor,
          total: searchResult.total,
        }),
      };
    } catch (osErr: any) {
      if (osErr instanceof SearchUnavailableError) {
        return {
          statusCode: 503,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: {
              code: 'SEARCH_UNAVAILABLE',
              message: 'Search engine is currently unavailable. Direct ID lookup is still operational.',
              correlation_id: correlationId,
              retryable: true,
            },
          }),
        };
      }
      throw osErr;
    }
  } catch (err: any) {
    if (err instanceof PlatformError) {
      return {
        statusCode: err.statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(err.toResponse(correlationId)),
      };
    }
    Logger.error('Unhandled error in search handler', err, { correlationId });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected internal error occurred',
          correlation_id: correlationId,
          retryable: true,
        },
      }),
    };
  }
}
