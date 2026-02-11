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
 * Load OpenAPI spec from URL or from file. URL takes precedence if both are provided.
 */
export async function loadOpenApiSpec(
  specUrl: string | null,
  specFile: string | null,
): Promise<OpenApiSpec> {
  const correlationId = 'loader';
  if (specUrl) {
    logger.debug(correlationId, `Loading OpenAPI spec from URL: ${specUrl}`);
    try {
      const res = await axios.get(specUrl, { timeout: 15000, responseType: 'json' });
      logger.debug(correlationId, 'OpenAPI spec loaded from URL', {
        url: specUrl,
        status: res.status,
        contentType: res.headers['content-type'],
      });
      return res.data as OpenApiSpec;
    } catch (err) {
      logger.error(correlationId, `Failed to load OpenAPI spec from URL: ${specUrl}`, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }
  if (specFile) {
    logger.debug(correlationId, `Loading OpenAPI spec from file: ${specFile}`);
    try {
      const absolutePath = path.isAbsolute(specFile) ? specFile : path.resolve(process.cwd(), specFile);
      logger.debug(correlationId, `Resolved file path: ${absolutePath}`);
      const raw = fs.readFileSync(absolutePath, 'utf-8');
      const data = JSON.parse(raw) as OpenApiSpec;
      logger.debug(correlationId, 'OpenAPI spec loaded from file', {
        file: absolutePath,
        size: raw.length,
      });
      return data;
    } catch (err) {
      logger.error(correlationId, `Failed to load OpenAPI spec from file: ${specFile}`, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }
  const error = new Error('Either MCP_OPENAPI_SPEC_URL or MCP_OPENAPI_SPEC_FILE must be set');
  logger.error(correlationId, error.message);
  throw error;
}
