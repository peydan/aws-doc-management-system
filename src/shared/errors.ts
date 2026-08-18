export interface ErrorDetail {
  field?: string;
  error: string;
}

export interface StandardErrorResponse {
  error: {
    code: string;
    message: string;
    correlation_id: string;
    retryable: boolean;
    details?: ErrorDetail[];
    [key: string]: any;
  };
}

export class PlatformError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly details?: ErrorDetail[];
  public readonly extraProps?: Record<string, any>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    retryable = false,
    details?: ErrorDetail[],
    extraProps?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    this.extraProps = extraProps;
  }

  toResponse(correlationId: string): StandardErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        correlation_id: correlationId,
        retryable: this.retryable,
        ...(this.details && this.details.length > 0 ? { details: this.details } : {}),
        ...(this.extraProps || {}),
      },
    };
  }
}

export class ValidationError extends PlatformError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(400, 'VALIDATION_ERROR', message, false, details);
  }
}

export class AuthenticationError extends PlatformError {
  constructor(message = 'Invalid or expired token') {
    super(401, 'AUTHENTICATION_ERROR', message, false);
  }
}

export class AuthorizationError extends PlatformError {
  constructor(message = 'Insufficient permissions for operation') {
    super(403, 'AUTHORIZATION_ERROR', message, false);
  }
}

export class NotFoundError extends PlatformError {
  constructor(message = 'Requested resource not found') {
    super(404, 'NOT_FOUND', message, false);
  }
}

export class IdempotencyConflictError extends PlatformError {
  constructor(message = 'Idempotency key reused with different request payload') {
    super(409, 'IDEMPOTENCY_CONFLICT', message, false);
  }
}

export class MetadataConflictError extends PlatformError {
  constructor(expectedRevision: number, currentRevision: number) {
    super(
      409,
      'METADATA_CONFLICT',
      'Metadata changed after the supplied revision.',
      false,
      undefined,
      { expected_revision: expectedRevision, current_revision: currentRevision }
    );
  }
}

export class VersionConflictError extends PlatformError {
  constructor(message = 'Version conflict on current application version') {
    super(409, 'VERSION_CONFLICT', message, false);
  }
}

export class ChecksumMismatchError extends PlatformError {
  constructor(message = 'Provided checksum does not match computed checksum') {
    super(400, 'CHECKSUM_MISMATCH', message, false);
  }
}

export class InlineUploadLimitExceededError extends PlatformError {
  constructor(maxBytes: number) {
    super(
      413,
      'INLINE_UPLOAD_LIMIT_EXCEEDED',
      `Inline payload exceeds maximum allowed inline size of ${maxBytes} bytes. Use direct upload initiation endpoint /v1/documents/uploads instead.`,
      false,
      undefined,
      { max_bytes: maxBytes }
    );
  }
}

export class SearchUnavailableError extends PlatformError {
  constructor(message = 'Search index service is currently unavailable') {
    super(533, 'SEARCH_UNAVAILABLE', message, true);
  }
}
