import { loadConfig } from '../src/config';
import { InstructionsMode } from '../src/instructions-loader';

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
    process.env.MCP_OPENAPI_SPEC = 'http://api:3000/openapi.json';
    process.env.MCP_INCLUDE_ENDPOINTS = 'get:/messages, get:/channels';
    process.env.MCP_EXCLUDE_ENDPOINTS = 'post:/channels';
    process.env.MCP_TOOL_PREFIX = 'tg_';

    const config = loadConfig();

    expect(config.apiBaseUrl).toBe('http://api:3000');
    expect(config.port).toBe(3200);
    expect(config.host).toBe('127.0.0.1');
    expect(config.openApiSpec).toBe('http://api:3000/openapi.json');
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
    delete process.env.MCP_OPENAPI_SPEC;
    delete process.env.MCP_OPENAPI_SPEC_URL;
    delete process.env.MCP_OPENAPI_SPEC_FILE;
    delete process.env.MCP_INCLUDE_ENDPOINTS;
    delete process.env.MCP_EXCLUDE_ENDPOINTS;
    delete process.env.MCP_TOOL_PREFIX;
    delete process.env.MCP_INSTRUCTIONS_FILE;
    delete process.env.MCP_INSTRUCTIONS_MODE;
    const config = loadConfig();
    expect(config.serverName).toBe('openapi-to-mcp');
    expect(config.apiBaseUrl).toBe('http://127.0.0.1:3000');
    expect(config.port).toBe(3100);
    expect(config.host).toBe('0.0.0.0');
    expect(config.openApiSpec).toBeNull();
    expect(config.includeEndpoints).toEqual([]);
    expect(config.excludeEndpoints).toEqual([]);
    expect(config.toolPrefix).toBe('');
    expect(config.instructionsFile).toBeNull();
    expect(config.instructionsMode).toBe(InstructionsMode.NONE);
  });

  it('supports backward compatibility with MCP_OPENAPI_SPEC_URL', () => {
    process.env.MCP_OPENAPI_SPEC_URL = 'http://api:3000/openapi.json';
    delete process.env.MCP_OPENAPI_SPEC;
    const config = loadConfig();
    expect(config.openApiSpec).toBe('http://api:3000/openapi.json');
  });

  it('supports backward compatibility with MCP_OPENAPI_SPEC_FILE', () => {
    process.env.MCP_OPENAPI_SPEC_FILE = './openapi.json';
    delete process.env.MCP_OPENAPI_SPEC;
    delete process.env.MCP_OPENAPI_SPEC_URL;
    const config = loadConfig();
    expect(config.openApiSpec).toBe('./openapi.json');
  });

  it('MCP_OPENAPI_SPEC takes precedence over old vars', () => {
    process.env.MCP_OPENAPI_SPEC = 'http://new.api/openapi.json';
    process.env.MCP_OPENAPI_SPEC_URL = 'http://old.api/openapi.json';
    process.env.MCP_OPENAPI_SPEC_FILE = './old.json';
    const config = loadConfig();
    expect(config.openApiSpec).toBe('http://new.api/openapi.json');
  });

  it('parses instructions file and mode', () => {
    process.env.MCP_INSTRUCTIONS_FILE = '/path/to/instructions.txt';
    process.env.MCP_INSTRUCTIONS_MODE = 'append';
    const config = loadConfig();
    expect(config.instructionsFile).toBe('/path/to/instructions.txt');
    expect(config.instructionsMode).toBe(InstructionsMode.APPEND);
  });

  it('defaults instructions mode to none when not set', () => {
    delete process.env.MCP_INSTRUCTIONS_MODE;
    const config = loadConfig();
    expect(config.instructionsMode).toBe(InstructionsMode.NONE);
  });

  it('parses instructions mode case-insensitively', () => {
    process.env.MCP_INSTRUCTIONS_MODE = 'REPLACE';
    expect(loadConfig().instructionsMode).toBe(InstructionsMode.REPLACE);

    process.env.MCP_INSTRUCTIONS_MODE = 'Prepend';
    expect(loadConfig().instructionsMode).toBe(InstructionsMode.PREPEND);

    process.env.MCP_INSTRUCTIONS_MODE = 'APPEND';
    expect(loadConfig().instructionsMode).toBe(InstructionsMode.APPEND);

    process.env.MCP_INSTRUCTIONS_MODE = 'NONE';
    expect(loadConfig().instructionsMode).toBe(InstructionsMode.NONE);
  });

  it('defaults to none for invalid instructions mode', () => {
    process.env.MCP_INSTRUCTIONS_MODE = 'invalid';
    const config = loadConfig();
    expect(config.instructionsMode).toBe(InstructionsMode.NONE);
  });

  it('trims instructions file path', () => {
    process.env.MCP_INSTRUCTIONS_FILE = '  /path/to/file.txt  ';
    const config = loadConfig();
    expect(config.instructionsFile).toBe('/path/to/file.txt');
  });

  it('handles empty instructions file as null', () => {
    process.env.MCP_INSTRUCTIONS_FILE = '';
    const config = loadConfig();
    expect(config.instructionsFile).toBeNull();
  });
});
