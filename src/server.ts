import path from 'path';
import express, { type Express, type Request, type Response } from 'express';
import type { McpConfig } from './config';
import type { ToolFromOpenApi } from './openapi-to-tools';
import { logger, getCorrelationId } from './logger';
import { correlationIdStorage } from './openapi-to-tools';

// Load SDK via explicit .js paths to avoid Node resolution bug with package exports wildcard.
// Use path relative to this file so it works in Docker and when running from dist/.
const sdkRoot = path.join(__dirname, '..', 'node_modules', '@modelcontextprotocol', 'sdk');
const { McpServer } = require(path.join(sdkRoot, 'dist/cjs/server/mcp.js'));
const { StreamableHTTPServerTransport } = require(path.join(sdkRoot, 'dist/cjs/server/streamableHttp.js'));

/**
 * Creates an Express app that serves MCP over Streamable HTTP at POST /mcp and GET /mcp.
 * Tools are built from OpenAPI spec (loaded at startup). Stateless: each request gets a new McpServer and transport.
 * @param instructions Optional instructions for MCP clients (typically from OpenAPI info.description).
 */
export function createMcpApp(config: McpConfig, tools: ToolFromOpenApi[], instructions?: string): Express {
  const app = express();
  app.use(express.json());

  logger.info('system', `Creating MCP app with ${tools.length} tool(s)`, {
    serverName: config.serverName,
    toolNames: tools.map((t) => t.name),
  });

  type ToolCb = (args: unknown, extra: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;

  async function handleMcpRequest(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    logger.debug(correlationId, `Received ${req.method} request to ${req.path}`, {
      headers: req.headers,
      body: req.body,
    });

    const serverInfo: { name: string; version: string; instructions?: string } = {
      name: config.serverName,
      version: '1.0.0',
    };
    if (instructions) {
      serverInfo.instructions = instructions;
    }
    const server = new McpServer(serverInfo, { capabilities: { tools: {} } });

    logger.debug(correlationId, `Registering ${tools.length} tool(s)`, {
      toolNames: tools.map((t) => t.name),
    });

    for (const tool of tools) {
      (server as { registerTool(name: string, config: { description: string; inputSchema: unknown }, cb: ToolCb): void }).registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (args, _extra) => {
          logger.debug(correlationId, `Tool ${tool.name} called`, { args });
          try {
            const result = await correlationIdStorage.run(correlationId, async () => {
              return await tool.handler(args as Record<string, unknown>);
            });
            logger.debug(correlationId, `Tool ${tool.name} completed`, {
              isError: result.isError,
              contentLength: result.content.length,
            });
            return result;
          } catch (err) {
            logger.error(correlationId, `Tool ${tool.name} handler error`, err instanceof Error ? err : new Error(String(err)));
            throw err;
          }
        },
      );
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);

    res.on('close', () => {
      logger.debug(correlationId, 'Request connection closed');
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      logger.debug(correlationId, 'Handling MCP request');
      await transport.handleRequest(req as never, res as never, req.body);
      logger.debug(correlationId, 'MCP request handled successfully');
    } catch (err) {
      logger.error(correlationId, 'MCP handleRequest error', err instanceof Error ? err : new Error(String(err)));
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: (err as Error).message },
          id: null,
        });
      }
    }
  }

  app.post('/mcp', (req: Request, res: Response) => void handleMcpRequest(req, res));
  app.get('/mcp', (req: Request, res: Response) => void handleMcpRequest(req, res));

  return app;
}
