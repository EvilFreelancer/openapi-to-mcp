import * as fs from 'node:fs';
import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import { loadOpenApiSpec } from '../src/openapi-loader';

const minimalSpec = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/messages': {
      get: { operationId: 'messages_list', parameters: [{ name: 'query', in: 'query', schema: { type: 'string' } }] },
    },
  },
};

describe('openapi-loader', () => {
  let mock: MockAdapter;

  beforeAll(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.reset();
  });

  it('loads spec from URL when openApiSpecUrl is set', async () => {
    mock.onGet('http://api.test/openapi.json').reply(200, minimalSpec);
    const spec = await loadOpenApiSpec('http://api.test/openapi.json', null);
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.paths?.['/messages']?.get?.operationId).toBe('messages_list');
  });

  it('loads spec from file when openApiSpecFile is set and URL is null', async () => {
    const tmpFile = require('node:os').tmpdir() + '/mcp-openapi-test-' + Date.now() + '.json';
    fs.writeFileSync(tmpFile, JSON.stringify(minimalSpec), 'utf-8');
    try {
      const spec = await loadOpenApiSpec(null, tmpFile);
      expect(spec.openapi).toBe('3.0.0');
      expect(spec.paths?.['/messages']).toBeDefined();
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    }
  });

  it('URL takes precedence over file when both set', async () => {
    mock.onGet('http://api.test/spec.json').reply(200, { ...minimalSpec, info: { title: 'From URL' } });
    const tmpFile = require('node:os').tmpdir() + '/mcp-openapi-file-' + Date.now() + '.json';
    fs.writeFileSync(tmpFile, JSON.stringify({ ...minimalSpec, info: { title: 'From File' } }), 'utf-8');
    try {
      const spec = await loadOpenApiSpec('http://api.test/spec.json', tmpFile);
      expect(spec.info?.title).toBe('From URL');
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    }
  });

  it('throws when both URL and file are null', async () => {
    await expect(loadOpenApiSpec(null, null)).rejects.toThrow(/MCP_OPENAPI_SPEC_URL|MCP_OPENAPI_SPEC_FILE/);
  });
});
