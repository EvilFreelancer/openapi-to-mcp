import { loadConfig } from './config';
import { loadOpenApiSpec } from './openapi-loader';
import { openApiToTools } from './openapi-to-tools';
import { createMcpApp } from './server';

async function main(): Promise<void> {
  const config = loadConfig();
  const spec = await loadOpenApiSpec(config.openApiSpecUrl, config.openApiSpecFile);
  const tools = openApiToTools(spec, {
    includeEndpoints: config.includeEndpoints,
    excludeEndpoints: config.excludeEndpoints,
    toolPrefix: config.toolPrefix,
    apiBaseUrl: config.apiBaseUrl,
  });

  if (tools.length === 0) {
    console.warn('[mcp] No tools registered. Check MCP_INCLUDE_ENDPOINTS / MCP_EXCLUDE_ENDPOINTS and OpenAPI paths.');
  } else {
    console.log(`[mcp] Registered ${tools.length} tool(s): ${tools.map((t) => t.name).join(', ')}`);
  }

  const instructions = spec.info?.description;
  const app = createMcpApp(config, tools, instructions);
  app.listen(config.port, config.host, () => {
    console.log(`[mcp] MCP server listening on http://${config.host}:${config.port} (POST/GET /mcp)`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
