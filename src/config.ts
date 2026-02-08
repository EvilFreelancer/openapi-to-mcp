/**
 * MCP server config from environment. All MCP-related vars use MCP_ prefix.
 */

function envInt(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultValue;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return defaultValue;
  return n;
}

function parseList(value: string | undefined): string[] {
  if (value === undefined || value === '') return [];
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export interface McpConfig {
  /** Server name reported to MCP clients. */
  serverName: string;
  /** Base URL for executing API requests (e.g. http://api:3000). */
  apiBaseUrl: string;
  /** Port for MCP Streamable HTTP server. */
  port: number;
  /** Host to bind. */
  host: string;
  /** OpenAPI spec URL (takes precedence over specFile if both set). */
  openApiSpecUrl: string | null;
  /** OpenAPI spec file path (used if openApiSpecUrl is not set). */
  openApiSpecFile: string | null;
  /** Include only these endpoints (method:path, e.g. get:/messages). Priority over exclude. */
  includeEndpoints: string[];
  /** Exclude these endpoints (method:path). Ignored for endpoints in includeEndpoints. */
  excludeEndpoints: string[];
  /** Prefix for tool names (e.g. telegram_ -> telegram_messages). */
  toolPrefix: string;
}

const DEFAULT_SERVER_NAME = 'openapi-to-mcp';
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_MCP_PORT = 3100;
const DEFAULT_MCP_HOST = '0.0.0.0';

export function loadConfig(): McpConfig {
  const serverName = process.env.MCP_SERVER_NAME?.trim() || DEFAULT_SERVER_NAME;
  const apiBaseUrl = (process.env.MCP_API_BASE_URL ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
  const port = envInt('MCP_PORT', DEFAULT_MCP_PORT);
  const host = process.env.MCP_HOST ?? DEFAULT_MCP_HOST;
  const openApiSpecUrl = process.env.MCP_OPENAPI_SPEC_URL?.trim() || null;
  const openApiSpecFile = process.env.MCP_OPENAPI_SPEC_FILE?.trim() || null;
  const includeEndpoints = parseList(process.env.MCP_INCLUDE_ENDPOINTS);
  const excludeEndpoints = parseList(process.env.MCP_EXCLUDE_ENDPOINTS);
  const toolPrefix = process.env.MCP_TOOL_PREFIX ?? '';

  return {
    serverName,
    apiBaseUrl,
    port,
    host,
    openApiSpecUrl,
    openApiSpecFile,
    includeEndpoints,
    excludeEndpoints,
    toolPrefix,
  };
}
