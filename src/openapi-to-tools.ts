/**
 * Build MCP tools from OpenAPI spec: filter operations, build tool names, Zod schemas, and handlers.
 */

import { z } from 'zod';
import axios, { AxiosInstance } from 'axios';
import type { OpenApiSpec, OpenApiOperation, OpenApiParameter } from './openapi-loader';

export interface ToolFromOpenApi {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

/** Normalize path for matching: ensure leading slash, lowercase. */
function normPath(p: string): string {
  return '/' + p.replace(/^\//, '').toLowerCase();
}

/** Operation key for include/exclude: method:path (e.g. get:/messages). */
function opKey(method: string, path: string): string {
  return `${method.toLowerCase()}:${normPath(path)}`;
}

/** Tool name from path: /messages -> messages, /channels -> channels. */
function pathToToolSegment(path: string): string {
  return normPath(path)
    .replace(/^\//, '')
    .replace(/\/+/g, '_')
    .replace(/\{[^}]+\}/g, '') // remove path params for segment
    .replace(/_$/, '') || 'index';
}

function isIncluded(
  key: string,
  includeEndpoints: string[],
  excludeEndpoints: string[],
): boolean {
  const keyNorm = key.toLowerCase();
  if (includeEndpoints.length > 0) {
    return includeEndpoints.some((inc) => keyNorm === inc.toLowerCase());
  }
  return !excludeEndpoints.some((ex) => keyNorm === ex.toLowerCase());
}

function openApiTypeToZod(schema?: OpenApiParameter['schema']): z.ZodTypeAny {
  const t = schema?.type ?? 'string';
  const enumVal = schema?.enum;
  if (enumVal?.length) {
    return z.enum(enumVal as [string, ...string[]]).optional();
  }
  switch (t) {
    case 'integer':
    case 'number':
      return z.number().optional();
    case 'boolean':
      return z.boolean().optional();
    case 'array':
      return z.array(z.unknown()).optional();
    default:
      return z.string().optional();
  }
}

function buildZodShapeFromOperation(op: OpenApiOperation): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  for (const p of op.parameters ?? []) {
    if (p.in === 'query' || p.in === 'path') {
      shape[p.name] = openApiTypeToZod(p.schema);
    }
  }
  const bodySchema = op.requestBody?.content?.['application/json']?.schema;
  if (bodySchema?.properties) {
    for (const [propName, propSchema] of Object.entries(bodySchema.properties)) {
      if (shape[propName] === undefined) {
        shape[propName] = openApiTypeToZod(propSchema as { type?: string; enum?: string[] });
      }
    }
  }
  return shape;
}

/**
 * Safely stringify data to JSON, handling circular references, BigInt, and other non-serializable values.
 */
function safeStringify(data: unknown): string {
  const seen = new WeakSet();
  const replacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'function') {
      return '[Function]';
    }
    if (typeof value === 'symbol') {
      return value.toString();
    }
    if (value === undefined) {
      return null;
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  };
  try {
    return JSON.stringify(data, replacer);
  } catch (e) {
    return JSON.stringify({ error: 'Failed to serialize response', message: e instanceof Error ? e.message : String(e) });
  }
}

function resolveOperations(
  spec: OpenApiSpec,
  includeEndpoints: string[],
  excludeEndpoints: string[],
  toolPrefix: string,
): Array<{ key: string; method: string; path: string; op: OpenApiOperation; name: string }> {
  const result: Array<{ key: string; method: string; path: string; op: OpenApiOperation; name: string }> = [];
  const paths = spec.paths ?? {};
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    const pathNorm = normPath(pathKey);
    for (const method of HTTP_METHODS) {
      const op = pathItem[method] as OpenApiOperation | undefined;
      if (!op) continue;
      const key = opKey(method, pathNorm);
      if (!isIncluded(key, includeEndpoints, excludeEndpoints)) continue;
      const segment = pathToToolSegment(pathNorm);
      const name = toolPrefix ? `${toolPrefix.replace(/_$/, '')}_${segment}` : segment;
      result.push({ key, method, path: pathNorm, op, name });
    }
  }
  return result;
}

/**
 * Build MCP tools from OpenAPI spec. Filter by include/exclude (include has priority).
 * Tool name = toolPrefix + path segment (e.g. telegram_ + messages = telegram_messages).
 */
export function openApiToTools(
  spec: OpenApiSpec,
  config: {
    includeEndpoints: string[];
    excludeEndpoints: string[];
    toolPrefix: string;
    apiBaseUrl: string;
    axiosInstance?: AxiosInstance;
  },
): ToolFromOpenApi[] {
  const client = config.axiosInstance ?? axios.create({ baseURL: config.apiBaseUrl.replace(/\/$/, ''), timeout: 30000 });
  const ops = resolveOperations(
    spec,
    config.includeEndpoints,
    config.excludeEndpoints,
    config.toolPrefix,
  );
  const nameCount = new Map<string, number>();
  for (const { name } of ops) {
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  }
  const tools: ToolFromOpenApi[] = [];

  for (const { method, path, op, name } of ops) {
    const uniqueName = (nameCount.get(name) ?? 0) > 1 ? `${name}_${method}` : name;
    const queryParamNames = (op.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name);
    const pathParamNames = (op.parameters ?? []).filter((p) => p.in === 'path').map((p) => p.name);
    const bodySchema = op.requestBody?.content?.['application/json']?.schema;
    const bodyParamNames = bodySchema?.properties ? Object.keys(bodySchema.properties) : [];

    const shape = buildZodShapeFromOperation(op);
    const inputSchema = z.object(shape);

    const description = [op.summary, op.description].filter(Boolean).join('. ') || `API ${method.toUpperCase()} ${path}`;

    const handler = async (args: Record<string, unknown>) => {
      const textContent = (text: string): { type: 'text'; text: string } => ({ type: 'text', text });
      try {
        let url = path;
        for (const p of pathParamNames) {
          const val = args[p];
          if (val !== undefined && val !== null) {
            url = url.replace(new RegExp(`\\{${p}\\}`, 'gi'), String(val));
          }
        }
        const params: Record<string, unknown> = {};
        for (const p of queryParamNames) {
          if (args[p] !== undefined && args[p] !== null) params[p] = args[p];
        }
        const data =
          bodyParamNames.length > 0
            ? Object.fromEntries(bodyParamNames.filter((p) => args[p] !== undefined).map((p) => [p, args[p]]))
            : undefined;
        const res = await client.request({ method, url, params, data });
        return { content: [textContent(safeStringify(res.data))] };
      } catch (e) {
        const message = axios.isAxiosError(e) && e.response?.data && typeof e.response.data === 'object' && 'error' in e.response.data
          ? String((e.response.data as { error?: unknown }).error)
          : (e instanceof Error ? e.message : String(e));
        return { content: [textContent(`Error: ${message}`)], isError: true };
      }
    };

    tools.push({
      name: uniqueName,
      description,
      inputSchema,
      handler,
    });
  }

  return tools;
}
