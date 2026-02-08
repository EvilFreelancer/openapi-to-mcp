import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import { openApiToTools } from '../src/openapi-to-tools';

const spec = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/health': {
      get: { operationId: 'health', summary: 'Health check' },
    },
    '/messages': {
      get: {
        operationId: 'messages_list',
        summary: 'Search messages',
        parameters: [
          { name: 'query', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
      },
    },
    '/channels': {
      get: {
        operationId: 'channels_list',
        parameters: [{ name: 'query', in: 'query', schema: { type: 'string' } }],
      },
      post: {
        operationId: 'channels_create',
        requestBody: {
          content: {
            'application/json': {
              schema: { required: ['url'], properties: { url: { type: 'string' } } },
            },
          },
        },
      },
    },
  },
};

describe('openapi-to-tools', () => {
  const baseUrl = 'http://api.test';
  let axiosInstance: ReturnType<typeof axios.create>;
  let mock: MockAdapter;

  beforeAll(() => {
    axiosInstance = axios.create({ baseURL: baseUrl });
    mock = new MockAdapter(axiosInstance);
  });

  afterEach(() => {
    mock.reset();
  });

  it('builds tools for all operations when no include/exclude', () => {
    const tools = openApiToTools(spec as never, {
      includeEndpoints: [],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('health');
    expect(names).toContain('messages');
    expect(names).toContain('channels');
    expect(tools.some((t) => t.name === 'channels' && t.description)).toBe(true);
  });

  it('applies tool prefix', () => {
    const tools = openApiToTools(spec as never, {
      includeEndpoints: [],
      excludeEndpoints: [],
      toolPrefix: 'telegram_',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    expect(tools.map((t) => t.name)).toContain('telegram_messages');
    expect(tools.map((t) => t.name)).toContain('telegram_channels');
    expect(tools.map((t) => t.name)).toContain('telegram_health');
  });

  it('include_endpoints: only listed operations become tools (include has priority)', () => {
    const tools = openApiToTools(spec as never, {
      includeEndpoints: ['get:/messages', 'get:/channels'],
      excludeEndpoints: [],
      toolPrefix: 'tg_',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['tg_channels', 'tg_messages']);
  });

  it('exclude_endpoints: listed operations are excluded', () => {
    const tools = openApiToTools(spec as never, {
      includeEndpoints: [],
      excludeEndpoints: ['post:/channels', 'get:/health'],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    const names = tools.map((t) => t.name).sort();
    expect(names).not.toContain('health');
    expect(names).toContain('messages');
    expect(names).toContain('channels');
    expect(tools.length).toBeGreaterThanOrEqual(2);
  });

  it('include overrides exclude: endpoint in both include and exclude is included', () => {
    const tools = openApiToTools(spec as never, {
      includeEndpoints: ['get:/health'],
      excludeEndpoints: ['get:/health'],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('health');
  });

  it('tool handler calls API and returns response as JSON text', async () => {
    mock.onGet('/messages').reply(200, { messages: [{ id: 1 }], metadata: { total_found: 1 } });
    const tools = openApiToTools(spec as never, {
      includeEndpoints: ['get:/messages'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    const result = await tools[0].handler({ query: 'test' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.messages).toHaveLength(1);
    expect(data.metadata.total_found).toBe(1);
  });

  it('tool handler returns error content when API fails', async () => {
    mock.onGet('/messages').reply(400, { error: 'At least one parameter is required' });
    const tools = openApiToTools(spec as never, {
      includeEndpoints: ['get:/messages'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    const result = await tools[0].handler({});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/error|parameter/i);
  });
});
