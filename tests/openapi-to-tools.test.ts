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
    expect(names).toContain('channels_get');
    expect(names).toContain('channels_post');
    expect(tools.some((t) => (t.name === 'channels_get' || t.name === 'channels_post') && t.description)).toBe(true);
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
    expect(tools.map((t) => t.name)).toContain('telegram_channels_get');
    expect(tools.map((t) => t.name)).toContain('telegram_channels_post');
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

  it('suffixes tool name with method when same path segment has multiple methods (duplicate names)', () => {
    const specWithSamePath = {
      openapi: '3.0.0',
      info: { title: 'Pet API', version: '1.0.0' },
      paths: {
        '/pet/{id}': {
          get: { operationId: 'getPet', summary: 'Find a pet' },
          put: { operationId: 'updatePet', summary: 'Update a pet' },
        },
      },
    };
    const tools = openApiToTools(specWithSamePath as never, {
      includeEndpoints: [],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['pet_get', 'pet_put']);
  });

  it('handles response with circular references without crashing', async () => {
    const circularData: { self?: unknown } = { self: null };
    circularData.self = circularData;
    // Mock axios to return circular data directly (simulating a real scenario where
    // data might have circular references after processing)
    const originalRequest = axiosInstance.request.bind(axiosInstance);
    jest.spyOn(axiosInstance, 'request').mockImplementation(async (config) => {
      return {
        data: circularData,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: config as never,
      };
    });
    const tools = openApiToTools(spec as never, {
      includeEndpoints: ['get:/messages'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    const result = await tools[0].handler({ query: 'test' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toBeTruthy();
    expect(text).toContain('[Circular]');
    expect(result.isError).toBeUndefined();
    jest.restoreAllMocks();
  });

  it('handles response with BigInt values without crashing', async () => {
    const bigIntData = { id: BigInt(9007199254740991), value: 123 };
    const originalRequest = axiosInstance.request.bind(axiosInstance);
    jest.spyOn(axiosInstance, 'request').mockImplementation(async (config) => {
      return {
        data: bigIntData,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: config as never,
      };
    });
    const tools = openApiToTools(spec as never, {
      includeEndpoints: ['get:/messages'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    const result = await tools[0].handler({ query: 'test' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toBeTruthy();
    const parsed = JSON.parse(text);
    expect(parsed.id).toBe('9007199254740991');
    expect(parsed.value).toBe(123);
    expect(result.isError).toBeUndefined();
    jest.restoreAllMocks();
  });

  it('handles response with undefined values without crashing', async () => {
    const dataWithUndefined = { field1: 'value', field2: undefined, field3: null };
    mock.onGet('/messages').reply(200, dataWithUndefined);
    const tools = openApiToTools(spec as never, {
      includeEndpoints: ['get:/messages'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    const result = await tools[0].handler({ query: 'test' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.field1).toBe('value');
    expect(parsed.field3).toBeNull();
    expect(result.isError).toBeUndefined();
  });

  it('handles string response without double-stringifying', async () => {
    mock.onGet('/messages').reply(200, 'simple string response');
    const tools = openApiToTools(spec as never, {
      includeEndpoints: ['get:/messages'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    const result = await tools[0].handler({ query: 'test' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toBe('"simple string response"');
    expect(result.isError).toBeUndefined();
  });

  it('handles null response without crashing', async () => {
    mock.onGet('/messages').reply(200, null);
    const tools = openApiToTools(spec as never, {
      includeEndpoints: ['get:/messages'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    const result = await tools[0].handler({ query: 'test' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect((result.content[0] as { text: string }).text).toBe('null');
    expect(result.isError).toBeUndefined();
  });

  it('includes parameter descriptions in input schema', () => {
    const specWithDescriptions = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/channels': {
          get: {
            operationId: 'channels_list',
            parameters: [
              { name: 'query', in: 'query', description: 'Search query (URL substring)', schema: { type: 'string' } },
              { name: 'id', in: 'query', description: 'Channel ID', schema: { type: 'integer' } },
              { name: 'url', in: 'query', description: 'Channel URL', schema: { type: 'string' } },
              { name: 'limit', in: 'query', description: 'Maximum number of results', schema: { type: 'integer' } },
              { name: 'offset', in: 'query', description: 'Number of results to skip', schema: { type: 'integer' } },
            ],
          },
        },
      },
    };
    const tools = openApiToTools(specWithDescriptions as never, {
      includeEndpoints: ['get:/channels'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    const tool = tools[0];
    const shape = tool.inputSchema._def.shape();
    expect(shape).toBeDefined();
    // For ZodOptional, description is in _def.innerType._def.description
    const getDescription = (field: unknown): string | undefined => {
      const def = (field as { _def?: { innerType?: { _def?: { description?: string } }; description?: string } })?._def;
      return def?.innerType?._def?.description ?? def?.description;
    };
    expect(getDescription(shape.query)).toBe('Search query (URL substring)');
    expect(getDescription(shape.id)).toBe('Channel ID');
    expect(getDescription(shape.url)).toBe('Channel URL');
    expect(getDescription(shape.limit)).toBe('Maximum number of results');
    expect(getDescription(shape.offset)).toBe('Number of results to skip');
  });

  it('converts HTML in parameter descriptions to Markdown when convertHtmlToMarkdown is true', () => {
    const specWithHtmlInParams = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              { name: 'query', in: 'query', description: 'Search keyword (<b>required</b> if no other filter)', schema: { type: 'string' } },
              { name: 'status', in: 'query', description: 'Filter by status: <b>active</b>, <b>inactive</b>, or <b>pending</b>', schema: { type: 'string' } },
            ],
          },
        },
      },
    };
    const tools = openApiToTools(specWithHtmlInParams as never, {
      includeEndpoints: ['get:/search'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      convertHtmlToMarkdown: true,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    const tool = tools[0];
    const shape = tool.inputSchema._def.shape();
    const getDescription = (field: unknown): string | undefined => {
      const def = (field as { _def?: { innerType?: { _def?: { description?: string } }; description?: string } })?._def;
      return def?.innerType?._def?.description ?? def?.description;
    };
    const queryDesc = getDescription(shape.query);
    const statusDesc = getDescription(shape.status);
    // HTML should be converted to Markdown
    expect(queryDesc).not.toContain('<b>');
    expect(queryDesc).not.toContain('</b>');
    expect(statusDesc).not.toContain('<b>');
    expect(statusDesc).not.toContain('</b>');
    // Should contain markdown equivalents
    expect(queryDesc).toContain('**required**');
    expect(statusDesc).toContain('**active**');
    expect(statusDesc).toContain('**inactive**');
    expect(statusDesc).toContain('**pending**');
  });

  it('does not convert HTML in parameter descriptions when convertHtmlToMarkdown is false', () => {
    const specWithHtmlInParams = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              { name: 'query', in: 'query', description: 'Search keyword (<b>required</b>)', schema: { type: 'string' } },
            ],
          },
        },
      },
    };
    const tools = openApiToTools(specWithHtmlInParams as never, {
      includeEndpoints: ['get:/search'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      convertHtmlToMarkdown: false,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    const tool = tools[0];
    const shape = tool.inputSchema._def.shape();
    const getDescription = (field: unknown): string | undefined => {
      const def = (field as { _def?: { innerType?: { _def?: { description?: string } }; description?: string } })?._def;
      return def?.innerType?._def?.description ?? def?.description;
    };
    const queryDesc = getDescription(shape.query);
    // HTML should remain unchanged
    expect(queryDesc).toContain('<b>required</b>');
  });

  it('converts HTML in requestBody property descriptions to Markdown when convertHtmlToMarkdown is true', () => {
    const specWithHtmlInBody = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    required: ['email'],
                    properties: {
                      email: { type: 'string', description: 'User email address (<b>required</b>)' },
                      name: { type: 'string', description: 'Full name (<i>optional</i>)' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const tools = openApiToTools(specWithHtmlInBody as never, {
      includeEndpoints: ['post:/users'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      convertHtmlToMarkdown: true,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    const tool = tools[0];
    const shape = tool.inputSchema._def.shape();
    const getDescription = (field: unknown): string | undefined => {
      const def = (field as { _def?: { innerType?: { _def?: { description?: string } }; description?: string } })?._def;
      return def?.innerType?._def?.description ?? def?.description;
    };
    const emailDesc = getDescription(shape.email);
    const nameDesc = getDescription(shape.name);
    // HTML should be converted to Markdown
    expect(emailDesc).not.toContain('<b>');
    expect(emailDesc).not.toContain('</b>');
    expect(nameDesc).not.toContain('<i>');
    expect(nameDesc).not.toContain('</i>');
    // Should contain markdown equivalents
    expect(emailDesc).toContain('**required**');
    expect(nameDesc).toContain('_optional_');
  });

  it('resolves $ref parameter references to actual parameter definitions', () => {
    const specWithRefs = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      parameters: {
        key: {
          name: 'key',
          in: 'query',
          required: true,
          description: 'API key',
          schema: { type: 'string' },
        },
        query: {
          name: 'query',
          in: 'query',
          description: 'Search query',
          schema: { type: 'string' },
        },
        limit: {
          name: 'limit',
          in: 'query',
          description: 'Maximum number of results',
          schema: { type: 'integer' },
        },
      },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            summary: 'Search endpoint',
            parameters: [
              { $ref: '#/parameters/key' },
              { $ref: '#/parameters/query' },
              { $ref: '#/parameters/limit' },
            ],
          },
        },
      },
    };
    const tools = openApiToTools(specWithRefs as never, {
      includeEndpoints: ['get:/search'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    const tool = tools[0];
    const shape = tool.inputSchema._def.shape();
    expect(shape).toBeDefined();
    expect(shape.key).toBeDefined();
    expect(shape.query).toBeDefined();
    expect(shape.limit).toBeDefined();
    
    // Check that required parameter is not optional
    const keyDef = shape.key._def;
    expect(keyDef.typeName).toBe('ZodString');
    // Required fields should not be wrapped in ZodOptional
    expect(keyDef.typeName).not.toBe('ZodOptional');
    
    // Check that optional parameters are optional
    const queryDef = shape.query._def;
    expect(queryDef.typeName).toBe('ZodOptional');
  });

  it('converts HTML in operation description to Markdown when convertHtmlToMarkdown is true (default)', () => {
    const specWithHtml = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            summary: 'List users',
            description: 'Retrieve a list of users from the system.<br/><br/>You can filter results by providing a user identifier (<b>user_id</b>), email address (<b>email</b>), or status (<b>status</b>). At least one filter parameter is required.',
          },
        },
      },
    };
    const tools = openApiToTools(specWithHtml as never, {
      includeEndpoints: ['get:/users'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      convertHtmlToMarkdown: true,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    const description = tools[0].description;
    // HTML should be converted to Markdown
    expect(description).not.toContain('<br/>');
    expect(description).not.toContain('<b>');
    expect(description).not.toContain('</b>');
    // Should contain markdown equivalents (turndown escapes underscores in middle of words)
    expect(description).toContain('**user\\_id**');
    expect(description).toContain('**email**');
    expect(description).toContain('**status**');
  });

  it('converts HTML in operation description to Markdown by default (convertHtmlToMarkdown not specified)', () => {
    const specWithHtml = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            description: 'Search with <b>bold</b> and <i>italic</i> text.',
          },
        },
      },
    };
    const tools = openApiToTools(specWithHtml as never, {
      includeEndpoints: ['get:/search'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    const description = tools[0].description;
    // HTML should be converted to Markdown (default behavior)
    expect(description).not.toContain('<b>');
    expect(description).not.toContain('</b>');
    expect(description).not.toContain('<i>');
    expect(description).not.toContain('</i>');
  });

  it('does not convert HTML when convertHtmlToMarkdown is false', () => {
    const specWithHtml = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            description: 'Search with <b>bold</b> text.',
          },
        },
      },
    };
    const tools = openApiToTools(specWithHtml as never, {
      includeEndpoints: ['get:/search'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      convertHtmlToMarkdown: false,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    const description = tools[0].description;
    // HTML should remain unchanged
    expect(description).toContain('<b>bold</b>');
  });

  it('does not modify plain text descriptions without HTML', () => {
    const specWithPlainText = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            description: 'Plain text description without any HTML tags.',
          },
        },
      },
    };
    const tools = openApiToTools(specWithPlainText as never, {
      includeEndpoints: ['get:/search'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      convertHtmlToMarkdown: true,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    const description = tools[0].description;
    expect(description).toBe('Plain text description without any HTML tags.');
  });

  it('converts HTML in summary when combined with description', () => {
    const specWithHtml = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            summary: 'Search with <b>bold</b>',
            description: 'Description with <i>italic</i> text.',
          },
        },
      },
    };
    const tools = openApiToTools(specWithHtml as never, {
      includeEndpoints: ['get:/search'],
      excludeEndpoints: [],
      toolPrefix: '',
      apiBaseUrl: baseUrl,
      convertHtmlToMarkdown: true,
      axiosInstance,
    });
    expect(tools).toHaveLength(1);
    const description = tools[0].description;
    // Both summary and description should have HTML converted
    expect(description).not.toContain('<b>');
    expect(description).not.toContain('</b>');
    expect(description).not.toContain('<i>');
    expect(description).not.toContain('</i>');
    expect(description).toContain('**bold**');
    // turndown converts <i> to _italic_ (underscore), not *italic* (asterisk)
    expect(description).toContain('_italic_');
  });
});
