import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { authenticateRequest, authorizeRoles, ApplicationRole, UserContext } from './auth';
import { PlatformError, isPlatformError } from './errors';
import { CORS_HEADERS } from './headers';
import { Logger } from './logger';

export interface ApiHandlerContext {
  correlationId: string;
  user: UserContext;
}

export interface ApiHandlerConfig {
  requireAuth?: boolean;
  allowedRoles?: ApplicationRole[];
  handlerName?: string;
}

export type ApiHandlerFunction = (
  event: APIGatewayProxyEvent,
  context: ApiHandlerContext
) => Promise<APIGatewayProxyResult>;

/**
 * Case-insensitively retrieves a header value from an APIGatewayProxyEvent.
 */
export function getHeader(event: APIGatewayProxyEvent, name: string): string | undefined {
  if (!event.headers) return undefined;
  const lowerName = name.toLowerCase();
  for (const [key, val] of Object.entries(event.headers)) {
    if (key.toLowerCase() === lowerName) {
      return val;
    }
  }
  return undefined;
}

/**
 * Higher-order function wrapping API Gateway Lambda handlers.
 * Standardizes:
 * - Correlation ID resolution
 * - Authentication & Role Authorization
 * - Consistent PlatformError catch and CORS headers
 * - Uniform 500 error envelope and structured logging
 */
export function createApiHandler(
  fn: ApiHandlerFunction,
  config: ApiHandlerConfig = {}
): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  const { requireAuth = true, allowedRoles, handlerName = 'api-handler' } = config;

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const correlationId =
      getHeader(event, 'x-correlation-id') ||
      event.requestContext?.requestId ||
      `req-${Date.now()}`;

    try {
      let user: UserContext = { userId: 'anonymous', roles: [] };

      if (requireAuth) {
        user = await authenticateRequest(event);
        if (allowedRoles && allowedRoles.length > 0) {
          authorizeRoles(user, allowedRoles);
        }
      }

      return await fn(event, { correlationId, user });
    } catch (err: any) {
      if (err instanceof PlatformError || isPlatformError(err)) {
        return {
          statusCode: err.statusCode,
          headers: CORS_HEADERS,
          body: JSON.stringify(err.toResponse(correlationId)),
        };
      }

      Logger.error(`Unhandled error in ${handlerName}`, err, { correlationId, path: event.path });
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
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
  };
}
