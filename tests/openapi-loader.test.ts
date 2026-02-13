import * as fs from 'node:fs';
import * as path from 'node:path';
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

  it('loads spec from URL when source starts with http://', async () => {
    mock.onGet('http://api.test/openapi.json').reply(200, minimalSpec);
    const spec = await loadOpenApiSpec('http://api.test/openapi.json');
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.paths?.['/messages']?.get?.operationId).toBe('messages_list');
  });

  it('loads spec from URL when source starts with https://', async () => {
    mock.onGet('https://api.test/openapi.json').reply(200, minimalSpec);
    const spec = await loadOpenApiSpec('https://api.test/openapi.json');
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.paths?.['/messages']?.get?.operationId).toBe('messages_list');
  });

  it('loads spec from file when source is a file path', async () => {
    const tmpFile = require('node:os').tmpdir() + '/mcp-openapi-test-' + Date.now() + '.json';
    fs.writeFileSync(tmpFile, JSON.stringify(minimalSpec), 'utf-8');
    try {
      const spec = await loadOpenApiSpec(tmpFile);
      expect(spec.openapi).toBe('3.0.0');
      expect(spec.paths?.['/messages']).toBeDefined();
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    }
  });

  it('loads spec from relative file path', async () => {
    const tmpFile = require('node:os').tmpdir() + '/mcp-openapi-test-' + Date.now() + '.json';
    fs.writeFileSync(tmpFile, JSON.stringify(minimalSpec), 'utf-8');
    try {
      const relativePath = path.relative(process.cwd(), tmpFile);
      const spec = await loadOpenApiSpec(relativePath);
      expect(spec.openapi).toBe('3.0.0');
      expect(spec.paths?.['/messages']).toBeDefined();
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    }
  });

  it('throws when spec source is null', async () => {
    await expect(loadOpenApiSpec(null)).rejects.toThrow(/MCP_OPENAPI_SPEC/);
  });

  it('throws when spec source is empty string', async () => {
    await expect(loadOpenApiSpec('')).rejects.toThrow(/MCP_OPENAPI_SPEC/);
  });

  it('loads description from OpenAPI info', async () => {
    const specWithDescription = {
      ...minimalSpec,
      info: { ...minimalSpec.info, description: 'Test API description for MCP instructions' },
    };
    mock.onGet('http://api.test/openapi.json').reply(200, specWithDescription);
    const spec = await loadOpenApiSpec('http://api.test/openapi.json');
    expect(spec.info?.description).toBe('Test API description for MCP instructions');
  });
});
