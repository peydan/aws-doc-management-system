export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface LogContext {
  correlationId?: string;
  documentId?: string;
  version?: number;
  userId?: string;
  route?: string;
  [key: string]: any;
}

export class Logger {
  static info(message: string, context: LogContext = {}): void {
    this.log('INFO', message, context);
  }

  static warn(message: string, context: LogContext = {}): void {
    this.log('WARN', message, context);
  }

  static error(message: string, error?: any, context: LogContext = {}): void {
    const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { error };
    this.log('ERROR', message, { ...context, ...errorDetails });
  }

  private static log(level: LogLevel, message: string, context: LogContext): void {
    const sanitized = this.sanitize(context);
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...sanitized,
    };
    console.log(JSON.stringify(entry));
  }

  private static sanitize(obj: Record<string, any>): Record<string, any> {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (/token|authorization|presigned|secret|password|bytes/i.test(key)) {
        clean[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        clean[key] = this.sanitize(value);
      } else {
        clean[key] = value;
      }
    }
    return clean;
  }
}
