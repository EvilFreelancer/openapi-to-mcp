import { loadConfig } from '../src/config';

describe('config', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterAll(() => {
    process.env = origEnv;
  });

  it('uses MCP_ prefixed vars and parses include/exclude lists', () => {
    process.env.MCP_API_BASE_URL = 'http://api:3000';
    process.env.MCP_PORT = '3200';
    process.env.MCP_HOST = '127.0.0.1';
    process.env.MCP_OPENAPI_SPEC_URL = 'http://api:3000/openapi.json';
    process.env.MCP_INCLUDE_ENDPOINTS = 'get:/messages, get:/channels';
    process.env.MCP_EXCLUDE_ENDPOINTS = 'post:/channels';
    process.env.MCP_TOOL_PREFIX = 'tg_';

    const config = loadConfig();

    expect(config.apiBaseUrl).toBe('http://api:3000');
    expect(config.port).toBe(3200);
    expect(config.host).toBe('127.0.0.1');
    expect(config.openApiSpecUrl).toBe('http://api:3000/openapi.json');
    expect(config.includeEndpoints).toEqual(['get:/messages', 'get:/channels']);
    expect(config.excludeEndpoints).toEqual(['post:/channels']);
    expect(config.toolPrefix).toBe('tg_');
    expect(config.serverName).toBe('openapi-to-mcp'); // default when MCP_SERVER_NAME not set
  });

  it('include has priority: when set, only those endpoints are considered by openapi-to-tools', () => {
    process.env.MCP_INCLUDE_ENDPOINTS = 'get:/health';
    process.env.MCP_EXCLUDE_ENDPOINTS = 'get:/health';
    const config = loadConfig();
    expect(config.includeEndpoints).toContain('get:/health');
    expect(config.excludeEndpoints).toContain('get:/health');
    // Priority is applied in openapi-to-tools, not in config
  });

  it('defaults when MCP_ vars not set', () => {
    delete process.env.MCP_API_BASE_URL;
    delete process.env.API_BASE_URL;
    delete process.env.MCP_OPENAPI_SPEC_URL;
    delete process.env.MCP_OPENAPI_SPEC_FILE;
    delete process.env.MCP_INCLUDE_ENDPOINTS;
    delete process.env.MCP_EXCLUDE_ENDPOINTS;
    delete process.env.MCP_TOOL_PREFIX;
    const config = loadConfig();
    expect(config.serverName).toBe('openapi-to-mcp');
    expect(config.apiBaseUrl).toBe('http://127.0.0.1:3000');
    expect(config.port).toBe(3100);
    expect(config.host).toBe('0.0.0.0');
    expect(config.openApiSpecUrl).toBeNull();
    expect(config.openApiSpecFile).toBeNull();
    expect(config.includeEndpoints).toEqual([]);
    expect(config.excludeEndpoints).toEqual([]);
    expect(config.toolPrefix).toBe('');
  });
});
