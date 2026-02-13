import { loadConfig } from './config';
import { loadOpenApiSpec } from './openapi-loader';
import { openApiToTools } from './openapi-to-tools';
import { createMcpApp } from './server';
import { logger } from './logger';
import { loadInstructions, combineInstructions, InstructionsMode } from './instructions-loader';

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
    specSource: config.openApiSpec,
  });

  const spec = await loadOpenApiSpec(config.openApiSpec);

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

  const openApiInstructions = spec.info?.description || null;

  let finalInstructions: string | null = null;
  if (config.instructionsMode !== InstructionsMode.NONE && config.instructionsFile) {
    try {
      const fileInstructions = await loadInstructions(config.instructionsFile);
      finalInstructions = combineInstructions(openApiInstructions, fileInstructions, config.instructionsMode);
      logger.info(correlationId, 'Loaded custom instructions from file', {
        file: config.instructionsFile,
        mode: config.instructionsMode,
        instructionsLength: finalInstructions?.length || 0,
      });
    } catch (error) {
      logger.warn(correlationId, 'Failed to load instructions file, continuing without custom instructions', {
        file: config.instructionsFile,
        error: error instanceof Error ? error.message : String(error),
      });
      finalInstructions = openApiInstructions;
    }
  } else if (config.instructionsMode === InstructionsMode.REPLACE && !config.instructionsFile) {
    logger.warn(correlationId, 'MCP_INSTRUCTIONS_MODE is set to replace but MCP_INSTRUCTIONS_FILE is not set, ignoring custom instructions');
    finalInstructions = openApiInstructions;
  } else {
    finalInstructions = combineInstructions(openApiInstructions, null, config.instructionsMode);
  }

  if (finalInstructions) {
    logger.debug(correlationId, 'Using instructions', {
      instructionsLength: finalInstructions.length,
      source: openApiInstructions ? 'OpenAPI spec' : 'file only',
    });
  }

  const app = createMcpApp(config, tools, finalInstructions || undefined);
  app.listen(config.port, config.host, () => {
    logger.info(correlationId, `MCP server listening on http://${config.host}:${config.port} (POST/GET /mcp)`);
  });
}

main().catch((e) => {
  logger.error('startup', 'Failed to start MCP server', e instanceof Error ? e : new Error(String(e)));
  process.exit(1);
});
