import path from 'path';
import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
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
 * Session storage for Streamable HTTP transport.
 * Streamable HTTP requires maintaining server and transport instances per session.
 */
interface SessionData {
  server: InstanceType<typeof McpServer>;
  transport: InstanceType<typeof StreamableHTTPServerTransport>;
  lastAccess: number;
}

const sessions = new Map<string, SessionData>();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Cleanup expired sessions periodically.
 */
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastAccess > SESSION_TIMEOUT) {
      logger.debug('cleanup', `Cleaning up expired session: ${sessionId}`);
      session.transport.close().catch(() => {});
      session.server.close().catch(() => {});
      sessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes
// Allow process to exit even if interval is running
cleanupInterval.unref();

/**
 * Creates an Express app that serves MCP over Streamable HTTP at POST /mcp and GET /mcp.
 * Tools are built from OpenAPI spec (loaded at startup). Maintains sessions for Streamable HTTP.
 * @param instructions Optional instructions for MCP clients (typically from OpenAPI info.description).
 */
export function createMcpApp(config: McpConfig, tools: ToolFromOpenApi[], instructions?: string): Express {
  const app = express();
  
  // Enable CORS for browser-based MCP clients (e.g., MCP Inspector)
  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Mcp-Session-Id', 'X-Correlation-ID'],
      exposedHeaders: ['Mcp-Session-Id'],
    }),
  );
  
  app.use(express.json());

  logger.info('system', `Creating MCP app with ${tools.length} tool(s)`, {
    serverName: config.serverName,
    toolNames: tools.map((t) => t.name),
  });

  type ToolCb = (args: unknown, extra: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;

  function createServerAndTransport(): { server: InstanceType<typeof McpServer>; transport: InstanceType<typeof StreamableHTTPServerTransport> } {
    const serverInfo: { name: string; version: string; instructions?: string } = {
      name: config.serverName,
      version: '1.0.0',
    };
    if (instructions) {
      serverInfo.instructions = instructions;
    }
    const server = new McpServer(serverInfo, { capabilities: { tools: {} } });

    logger.debug('new', `Registering ${tools.length} tool(s)`, {
      toolNames: tools.map((t) => t.name),
    });

    for (const tool of tools) {
      (server as { registerTool(name: string, config: { description: string; inputSchema: unknown }, cb: ToolCb): void }).registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (args, _extra) => {
          const correlationId = correlationIdStorage.getStore() || 'unknown';
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

    // SDK will automatically handle session IDs via Mcp-Session-Id header
    const transport = new StreamableHTTPServerTransport({});
    
    return { server, transport };
  }

  async function handleMcpRequest(req: Request, res: Response): Promise<void> {
    const correlationId = getCorrelationId(req);
    // SDK extracts session ID from Mcp-Session-Id header automatically
    const sessionIdHeader = (req.headers['mcp-session-id'] as string) || null;
    
    logger.debug(correlationId, `Received ${req.method} request to ${req.path}`, {
      sessionId: sessionIdHeader,
      headers: req.headers,
      body: req.body,
    });

    // SDK handles sessions internally, but we need to maintain server/transport instances per session
    let sessionData: SessionData | null = null;
    let actualSessionId: string | null = sessionIdHeader;
    
    if (sessionIdHeader && sessions.has(sessionIdHeader)) {
      sessionData = sessions.get(sessionIdHeader)!;
      sessionData.lastAccess = Date.now();
      logger.debug(correlationId, `Reusing existing session: ${sessionIdHeader}`);
    } else {
      const { server, transport } = createServerAndTransport();
      await server.connect(transport);
      
      // Create temporary session entry - SDK will set actual session ID in response header
      const tempSessionId = sessionIdHeader || `temp-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      sessionData = {
        server,
        transport,
        lastAccess: Date.now(),
      };
      sessions.set(tempSessionId, sessionData);
      logger.debug(correlationId, `Created new session placeholder: ${tempSessionId}`);
    }

    const { server, transport } = sessionData;

    // Intercept response to extract actual session ID from SDK
    const originalSetHeader = res.setHeader.bind(res);
    res.setHeader = function (name: string, value: string | number | string[]): typeof res {
      if (name.toLowerCase() === 'mcp-session-id' && typeof value === 'string') {
        const newSessionId = value;
        if (actualSessionId !== newSessionId && sessions.has(actualSessionId || '')) {
          // Move session data to actual session ID
          const data = sessions.get(actualSessionId || '')!;
          sessions.delete(actualSessionId || '');
          sessions.set(newSessionId, data);
          actualSessionId = newSessionId;
          logger.debug(correlationId, `Session ID updated: ${newSessionId}`);
        }
      }
      return originalSetHeader(name, value);
    };

    res.on('close', () => {
      logger.debug(correlationId, 'Request connection closed');
      // Don't close transport/server on connection close - keep session alive
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
