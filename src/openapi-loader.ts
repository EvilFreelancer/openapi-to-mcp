/**
 * Load OpenAPI spec from URL or file.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import axios from 'axios';

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
  if (specUrl) {
    const res = await axios.get(specUrl, { timeout: 15000, responseType: 'json' });
    return res.data as OpenApiSpec;
  }
  if (specFile) {
    const absolutePath = path.isAbsolute(specFile) ? specFile : path.resolve(process.cwd(), specFile);
    const raw = fs.readFileSync(absolutePath, 'utf-8');
    const data = JSON.parse(raw) as OpenApiSpec;
    return data;
  }
  throw new Error('Either MCP_OPENAPI_SPEC_URL or MCP_OPENAPI_SPEC_FILE must be set');
}
