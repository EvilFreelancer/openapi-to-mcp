/**
 * Build MCP tools from OpenAPI spec: filter operations, build tool names, Zod schemas, and handlers.
 */

import { z } from 'zod';
import axios, { AxiosInstance } from 'axios';
import { AsyncLocalStorage } from 'node:async_hooks';
import TurndownService from 'turndown';
import type { OpenApiSpec, OpenApiOperation, OpenApiParameter } from './openapi-loader';

// Re-export for use in this module
type OpenApiSpecWithParams = OpenApiSpec & { parameters?: Record<string, OpenApiParameter> };
import { logger } from './logger';

export const correlationIdStorage = new AsyncLocalStorage<string>();

export interface ToolFromOpenApi {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

/**
 * Convert HTML to Markdown using TurndownService.
 * Returns the original string if conversion fails or if input is not HTML-like.
 */
export function htmlToMarkdown(html: string): string {
  try {
    const turndownService = new TurndownService();
    return turndownService.turndown(html);
  } catch (e) {
    // If conversion fails, return original string
    return html;
  }
}

/**
 * Check if a string contains HTML tags.
 */
export function containsHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
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

function openApiTypeToZod(
  schema?: OpenApiParameter['schema'],
  description?: string,
  required?: boolean,
  convertHtmlToMarkdown?: boolean,
): z.ZodTypeAny {
  const t = schema?.type ?? 'string';
  const enumVal = schema?.enum;
  let zodType: z.ZodTypeAny;
  if (enumVal?.length) {
    zodType = z.enum(enumVal as [string, ...string[]]);
  } else {
    switch (t) {
      case 'integer':
      case 'number':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(z.unknown());
        break;
      default:
        zodType = z.string();
    }
  }
  if (!required) {
    zodType = zodType.optional();
  }
  if (description) {
    let finalDescription = description;
    // Convert HTML to Markdown if enabled and description contains HTML
    if (convertHtmlToMarkdown !== false && containsHtml(finalDescription)) {
      finalDescription = htmlToMarkdown(finalDescription);
    }
    return zodType.describe(finalDescription);
  }
  return zodType;
}

/**
 * Resolve $ref parameter reference to actual parameter definition.
 * Supports references like "#/parameters/key" to parameters defined in spec.parameters.
 */
function resolveParameterRef(ref: string, spec: OpenApiSpecWithParams): OpenApiParameter | null {
  if (!ref.startsWith('#/parameters/')) {
    return null;
  }
  const paramName = ref.replace('#/parameters/', '');
  return spec.parameters?.[paramName] ?? null;
}

/**
 * Resolve parameter: if it's a $ref, resolve it and merge with any additional properties;
 * otherwise return as-is.
 */
function resolveParameter(param: OpenApiParameter, spec: OpenApiSpecWithParams): OpenApiParameter | null {
  if (param.$ref) {
    const resolved = resolveParameterRef(param.$ref, spec);
    if (!resolved) return null;
    // Merge additional properties from the reference with the resolved parameter
    // (e.g., if the reference specifies required: true, it overrides the resolved parameter)
    return {
      ...resolved,
      ...Object.fromEntries(
        Object.entries(param).filter(([key]) => key !== '$ref'),
      ),
    };
  }
  return param;
}

function buildZodShapeFromOperation(
  op: OpenApiOperation,
  spec: OpenApiSpecWithParams,
  convertHtmlToMarkdown?: boolean,
): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  for (const p of op.parameters ?? []) {
    const resolved = resolveParameter(p, spec);
    if (!resolved) continue;
    if (resolved.in === 'query' || resolved.in === 'path') {
      const isRequired = resolved.required === true || p.required === true;
      shape[resolved.name] = openApiTypeToZod(resolved.schema, resolved.description, isRequired, convertHtmlToMarkdown);
    }
  }
  const bodySchema = op.requestBody?.content?.['application/json']?.schema;
  const requiredFields = bodySchema?.required ?? [];
  if (bodySchema?.properties) {
    for (const [propName, propSchema] of Object.entries(bodySchema.properties)) {
      if (shape[propName] === undefined) {
        const propSchemaWithDesc = propSchema as { type?: string; description?: string; enum?: string[] };
        const isRequired = requiredFields.includes(propName);
        shape[propName] = openApiTypeToZod(propSchemaWithDesc, propSchemaWithDesc.description, isRequired, convertHtmlToMarkdown);
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
    convertHtmlToMarkdown?: boolean;
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
    
    // Resolve all parameters (including $ref) to get actual parameter definitions
    const resolvedParams = (op.parameters ?? [])
      .map((p) => resolveParameter(p, spec))
      .filter((p): p is OpenApiParameter => p !== null);
    
    const queryParamNames = resolvedParams.filter((p) => p.in === 'query').map((p) => p.name);
    const pathParamNames = resolvedParams.filter((p) => p.in === 'path').map((p) => p.name);
    const bodySchema = op.requestBody?.content?.['application/json']?.schema;
    const bodyParamNames = bodySchema?.properties ? Object.keys(bodySchema.properties) : [];

    const shape = buildZodShapeFromOperation(op, spec, config.convertHtmlToMarkdown);
    const inputSchema = z.object(shape);

    let description = [op.summary, op.description].filter(Boolean).join('. ') || `API ${method.toUpperCase()} ${path}`;
    
    // Convert HTML to Markdown if enabled (default: true) and description contains HTML
    const shouldConvert = config.convertHtmlToMarkdown !== false;
    if (shouldConvert && containsHtml(description)) {
      const originalDescription = description;
      description = htmlToMarkdown(description);
      logger.debug('tool-build', `Converted HTML to Markdown for tool ${uniqueName}`, {
        originalLength: originalDescription.length,
        convertedLength: description.length,
        hadHtml: true,
      });
    }

    const handler = async (args: Record<string, unknown>) => {
      const correlationId = correlationIdStorage.getStore() || 'unknown';
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

        logger.debug(correlationId, `Calling API: ${method.toUpperCase()} ${url}`, {
          toolName: uniqueName,
          params,
          data,
        });

        const res = await client.request({ method, url, params, data });

        logger.debug(correlationId, `API call successful: ${method.toUpperCase()} ${url}`, {
          toolName: uniqueName,
          status: res.status,
          responseSize: safeStringify(res.data).length,
        });

        return { content: [textContent(safeStringify(res.data))] };
      } catch (e) {
        const message = axios.isAxiosError(e) && e.response?.data && typeof e.response.data === 'object' && 'error' in e.response.data
          ? String((e.response.data as { error?: unknown }).error)
          : (e instanceof Error ? e.message : String(e));

        const statusCode = axios.isAxiosError(e) && e.response ? e.response.status : undefined;
        const errorMessage = axios.isAxiosError(e) ? e.message : String(e);

        logger.warn(correlationId, `API call failed: ${method.toUpperCase()} ${path}`, {
          toolName: uniqueName,
          statusCode,
          errorMessage,
          message,
        });

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
