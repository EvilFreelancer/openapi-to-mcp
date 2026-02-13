/**
 * Load OpenAPI spec from URL or file.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import axios from 'axios';
import { logger } from './logger';

export interface OpenApiSpec {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: {
      'application/json'?: {
        schema?: {
          type?: string;
          required?: string[];
          properties?: Record<string, { type?: string; description?: string; enum?: string[] }>;
        };
      };
    };
  };
  responses?: Record<string, unknown>;
}

export interface OpenApiParameter {
  name: string;
  in: 'query' | 'path' | 'header';
  description?: string;
  required?: boolean;
  schema?: {
    type?: string;
    enum?: string[];
    [key: string]: unknown;
  };
}

/**
 * Determines if the spec source is a URL or a file path.
 * @param specSource The spec source string (URL or file path).
 * @returns true if it's a URL, false if it's a file path.
 */
function isUrl(specSource: string): boolean {
  const trimmed = specSource.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

/**
 * Load OpenAPI spec from URL or from file.
 * Automatically detects if the source is a URL (starts with http:// or https://) or a file path.
 */
export async function loadOpenApiSpec(specSource: string | null): Promise<OpenApiSpec> {
  const correlationId = 'loader';
  if (!specSource || specSource.trim() === '') {
    const error = new Error('MCP_OPENAPI_SPEC must be set');
    logger.error(correlationId, error.message);
    throw error;
  }

  const trimmed = specSource.trim();
  if (isUrl(trimmed)) {
    logger.debug(correlationId, `Loading OpenAPI spec from URL: ${trimmed}`);
    try {
      const res = await axios.get(trimmed, { timeout: 15000, responseType: 'json' });
      logger.debug(correlationId, 'OpenAPI spec loaded from URL', {
        url: trimmed,
        status: res.status,
        contentType: res.headers['content-type'],
      });
      return res.data as OpenApiSpec;
    } catch (err) {
      logger.error(correlationId, `Failed to load OpenAPI spec from URL: ${trimmed}`, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  logger.debug(correlationId, `Loading OpenAPI spec from file: ${trimmed}`);
  try {
    const absolutePath = path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
    logger.debug(correlationId, `Resolved file path: ${absolutePath}`);
    const raw = fs.readFileSync(absolutePath, 'utf-8');
    const data = JSON.parse(raw) as OpenApiSpec;
    logger.debug(correlationId, 'OpenAPI spec loaded from file', {
      file: absolutePath,
      size: raw.length,
    });
    return data;
  } catch (err) {
    logger.error(correlationId, `Failed to load OpenAPI spec from file: ${trimmed}`, err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
