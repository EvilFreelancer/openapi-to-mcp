import { loadConfig } from './config';
import { loadOpenApiSpec } from './openapi-loader';
import { openApiToTools } from './openapi-to-tools';
import { createMcpApp } from './server';
import { logger } from './logger';

async function main(): Promise<void> {
  const correlationId = 'startup';
  logger.info(correlationId, 'Starting MCP server', {
    serverName: process.env.MCP_SERVER_NAME || 'openapi-to-mcp',
    logLevel: process.env.MCP_LOG_LEVEL || 'INFO',
  });

  const config = loadConfig();
  logger.debug(correlationId, 'Configuration loaded', {
    apiBaseUrl: config.apiBaseUrl,
    port: config.port,
    host: config.host,
    includeEndpoints: config.includeEndpoints,
    excludeEndpoints: config.excludeEndpoints,
    toolPrefix: config.toolPrefix,
  });

  logger.info(correlationId, 'Loading OpenAPI spec', {
    specUrl: config.openApiSpecUrl,
    specFile: config.openApiSpecFile,
  });

  const spec = await loadOpenApiSpec(config.openApiSpecUrl, config.openApiSpecFile);

  logger.info(correlationId, 'OpenAPI spec loaded', {
    title: spec.info?.title,
    version: spec.info?.version,
    pathsCount: Object.keys(spec.paths || {}).length,
  });

  logger.debug(correlationId, 'Building tools from OpenAPI spec');
  const tools = openApiToTools(spec, {
    includeEndpoints: config.includeEndpoints,
    excludeEndpoints: config.excludeEndpoints,
    toolPrefix: config.toolPrefix,
    apiBaseUrl: config.apiBaseUrl,
  });

  if (tools.length === 0) {
    logger.warn(correlationId, 'No tools registered. Check MCP_INCLUDE_ENDPOINTS / MCP_EXCLUDE_ENDPOINTS and OpenAPI paths.');
  } else {
    logger.info(correlationId, `Registered ${tools.length} tool(s)`, {
      toolNames: tools.map((t) => t.name),
    });
  }

  const instructions = spec.info?.description;
  if (instructions) {
    logger.debug(correlationId, 'Using instructions from OpenAPI spec', {
      instructionsLength: instructions.length,
    });
  }

  const app = createMcpApp(config, tools, instructions);
  app.listen(config.port, config.host, () => {
    logger.info(correlationId, `MCP server listening on http://${config.host}:${config.port} (POST/GET /mcp)`);
  });
}

main().catch((e) => {
  logger.error('startup', 'Failed to start MCP server', e instanceof Error ? e : new Error(String(e)));
  process.exit(1);
});
