import { createMcpApp } from '../src/server';
import type { McpConfig } from '../src/config';
import type { ToolFromOpenApi } from '../src/openapi-to-tools';
import { InstructionsMode } from '../src/instructions-loader';
import { z } from 'zod';

describe('server', () => {
  const baseConfig: McpConfig = {
    serverName: 'test-server',
    apiBaseUrl: 'http://api.test',
    port: 3100,
    host: '0.0.0.0',
    openApiSpec: null,
    includeEndpoints: [],
    excludeEndpoints: [],
    toolPrefix: '',
    instructionsFile: null,
    instructionsMode: InstructionsMode.NONE,
  };

  const mockTool: ToolFromOpenApi = {
    name: 'test_tool',
    description: 'Test tool description',
    inputSchema: z.object({}),
    handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  };

  it('creates Express app with MCP endpoints', () => {
    const app = createMcpApp(baseConfig, [mockTool]);
    expect(app).toBeDefined();
  });

  it('accepts instructions parameter', () => {
    const instructions = 'This is a test API server';
    const app = createMcpApp(baseConfig, [mockTool], instructions);
    expect(app).toBeDefined();
  });

  it('works without instructions when not provided', () => {
    const app = createMcpApp(baseConfig, [mockTool]);
    expect(app).toBeDefined();
  });
});
