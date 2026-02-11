import { randomBytes } from 'node:crypto';
import type { Request } from 'express';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

const LOG_LEVELS: LogLevel[] = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];

function parseLogLevel(level: string | undefined): LogLevel {
  if (!level) return LogLevel.INFO;
  const upper = level.toUpperCase();
  return LOG_LEVELS.includes(upper as LogLevel) ? (upper as LogLevel) : LogLevel.INFO;
}

function getLogLevelFromEnv(): LogLevel {
  return parseLogLevel(process.env.MCP_LOG_LEVEL);
}

/**
 * Generates a unique correlation ID.
 */
export function generateCorrelationId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Extracts correlation ID from request headers or generates a new one.
 * Checks for 'x-correlation-id' header (case-insensitive).
 */
export function getCorrelationId(req: Request): string {
  const headerValue = req.headers['x-correlation-id'] || req.headers['X-Correlation-ID'];
  if (headerValue && typeof headerValue === 'string' && headerValue.trim()) {
    return headerValue.trim();
  }
  return generateCorrelationId();
}

/**
 * Logger with correlation ID support and configurable log levels.
 */
export class Logger {
  private level: LogLevel;

  constructor(level?: LogLevel) {
    this.level = level ?? getLogLevelFromEnv();
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(messageLevel: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentIndex = levels.indexOf(this.level);
    const messageIndex = levels.indexOf(messageLevel);
    return messageIndex >= currentIndex;
  }

  private formatMessage(correlationId: string, level: LogLevel, message: string, error?: Error): string {
    let formatted = `[${correlationId}] ${level} ${message}`;
    if (error) {
      formatted += `\n${error.stack || error.message}`;
    }
    return formatted;
  }

  debug(correlationId: string, message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const formatted = this.formatMessage(correlationId, LogLevel.DEBUG, message);
      console.debug(formatted, ...args);
    }
  }

  info(correlationId: string, message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const formatted = this.formatMessage(correlationId, LogLevel.INFO, message);
      console.log(formatted, ...args);
    }
  }

  warn(correlationId: string, message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const formatted = this.formatMessage(correlationId, LogLevel.WARN, message);
      console.warn(formatted, ...args);
    }
  }

  error(correlationId: string, message: string, error?: Error, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const formatted = this.formatMessage(correlationId, LogLevel.ERROR, message, error);
      console.error(formatted, ...args);
    }
  }
}

export const logger = new Logger();
