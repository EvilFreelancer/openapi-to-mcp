/**
 * MCP server config from environment. All MCP-related vars use MCP_ prefix.
 */

import { parseInstructionsMode, InstructionsMode } from './instructions-loader';

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
  /** OpenAPI spec source: URL (http:// or https://) or file path. */
  openApiSpec: string | null;
  /** Include only these endpoints (method:path, e.g. get:/messages). Priority over exclude. */
  includeEndpoints: string[];
  /** Exclude these endpoints (method:path). Ignored for endpoints in includeEndpoints. */
  excludeEndpoints: string[];
  /** Prefix for tool names (e.g. telegram_ -> telegram_messages). */
  toolPrefix: string;
  /** Path to custom instructions file. */
  instructionsFile: string | null;
  /** Instructions combination mode: default, replace, append, prepend. */
  instructionsMode: InstructionsMode;
  /** Convert HTML tags in descriptions to Markdown. */
  convertHtmlToMarkdown: boolean;
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
  // Support both old (MCP_OPENAPI_SPEC_URL/MCP_OPENAPI_SPEC_FILE) and new (MCP_OPENAPI_SPEC) formats for backward compatibility
  const openApiSpec =
    process.env.MCP_OPENAPI_SPEC?.trim() ||
    process.env.MCP_OPENAPI_SPEC_URL?.trim() ||
    process.env.MCP_OPENAPI_SPEC_FILE?.trim() ||
    null;
  const includeEndpoints = parseList(process.env.MCP_INCLUDE_ENDPOINTS);
  const excludeEndpoints = parseList(process.env.MCP_EXCLUDE_ENDPOINTS);
  const toolPrefix = process.env.MCP_TOOL_PREFIX ?? '';
  const instructionsFile = process.env.MCP_INSTRUCTIONS_FILE?.trim() || null;
  const instructionsMode = parseInstructionsMode(process.env.MCP_INSTRUCTIONS_MODE);
  const convertHtmlToMarkdown = process.env.MCP_CONVERT_HTML_TO_MARKDOWN !== 'false';

  return {
    serverName,
    apiBaseUrl,
    port,
    host,
    openApiSpec,
    includeEndpoints,
    excludeEndpoints,
    toolPrefix,
    instructionsFile,
    instructionsMode,
    convertHtmlToMarkdown,
  };
}
