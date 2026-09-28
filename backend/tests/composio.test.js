const mockFetch = jest.fn();

global.fetch = mockFetch;

const composio = require('../config/composio');

const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data
});

beforeEach(() => {
  process.env.COMPOSIO_API_KEY = 'test-composio-key';
  mockFetch.mockReset();
  composio.clearCaches();
});

afterAll(() => {
  delete process.env.COMPOSIO_API_KEY;
});

describe('Composio connector configuration', () => {
  test('scopes each member to a stable, unique Composio user identifier', () => {
    expect(composio.stableComposioUserId('uid-1')).toBe('ai-multimodal:uid-1');
    expect(composio.stableComposioUserId('uid-2')).not.toBe(composio.stableComposioUserId('uid-1'));
    expect(composio.stableComposioUserId('default')).toBe('ai-multimodal:default');
  });

  test('lists only explicitly approved, non-destructive connector tools', () => {
    const slugs = Object.values(composio.TOOLKIT_TOOLS).flat();
    expect(slugs).toContain('GMAIL_SEND_EMAIL');
    expect(slugs).toContain('GOOGLESHEETS_VALUES_UPDATE');
    expect(slugs).not.toContain('GOOGLEDRIVE_DELETE_FILE');
    expect(slugs).not.toContain('GOOGLEDRIVE_CREATE_PERMISSION');
    expect(slugs).not.toContain('GMAIL_BATCH_DELETE_MESSAGES');
    expect(slugs).not.toContain('GOOGLESHEETS_CLEAR_VALUES');
  });

  test('creates a managed Google auth config using the least-privilege scope recommendation', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ scopes: { least_privilege: ['scope.read', 'scope.write'] } }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ auth_config: { id: 'ac_test' } }));

    await expect(composio.getManagedAuthConfig('gmail')).resolves.toBe('ac_test');
    const createRequest = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(createRequest.auth_config.type).toBe('use_composio_managed_auth');
    expect(createRequest.auth_config.credentials.scopes).toBe('scope.read,scope.write');
    expect(JSON.stringify(createRequest)).not.toContain('test-composio-key');
  });

  test('starts OAuth linking with a stable private user ID and does not expose the API key', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ scopes: { least_privilege: ['scope.read'] } }))
      .mockResolvedValueOnce(jsonResponse({ items: [{
        id: 'ac_existing',
        name: 'AI Multimodal - gmail',
        is_composio_managed: true,
        status: 'ENABLED',
        credentials: { scopes: 'scope.read' }
      }] }))
      .mockResolvedValueOnce(jsonResponse({ redirect_url: 'https://connect.example.test/link' }));

    const link = await composio.startConnection('uid-1', 'gmail');
    expect(link.redirectUrl).toBe('https://connect.example.test/link');
    expect(mockFetch.mock.calls[2][0]).toContain('/connected_accounts/link');
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
      auth_config_id: 'ac_existing',
      user_id: 'ai-multimodal:uid-1'
    });
    expect(mockFetch.mock.calls[2][1].headers['x-api-key']).toBe('test-composio-key');
  });

  test('returns active connector statuses for only the authenticated Composio user', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ items: [
      { id: 'ca_1', toolkit: { slug: 'gmail' }, status: 'ACTIVE', is_disabled: false, alias: 'personal', user_id: 'ai-multimodal:uid-1' },
      { id: 'ca_2', toolkit: { slug: 'googledrive' }, status: 'REVOKED', is_disabled: false, user_id: 'ai-multimodal:uid-1' },
      { id: 'ca_3', toolkit: { slug: 'gmail' }, status: 'ACTIVE', is_disabled: false, user_id: 'ai-multimodal:uid-2' }
    ] }));

    const status = await composio.getConnectorStatus('uid-1');
    expect(status.find((item) => item.slug === 'gmail')).toMatchObject({ connected: true });
    expect(status.find((item) => item.slug === 'googledrive')).toMatchObject({ connected: false });
    expect(mockFetch.mock.calls[0][0]).toContain(encodeURIComponent('ai-multimodal:uid-1'));
  });
});

describe('Composio tool schema and validation', () => {
  test('fetches schemas only for requested toolkits and enforces the schema', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ items: [
      {
        slug: 'GMAIL_FETCH_EMAILS',
        name: 'Fetch emails',
        description: 'Search Gmail messages',
        input_parameters: {
          type: 'object',
          properties: { query: { type: 'string', maxLength: 300 } },
          additionalProperties: false
        }
      }
    ] }));

    const schemas = await composio.getAllowedTools(['gmail']);
    expect(schemas).toHaveLength(1);
    expect(new URL(mockFetch.mock.calls[0][0]).searchParams.get('tool_slugs'))
      .toBe('GMAIL_FETCH_EMAILS,GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID,GMAIL_SEND_EMAIL');

    await expect(composio.validateToolArguments('GMAIL_FETCH_EMAILS', { query: 'from:a@example.com' }, ['gmail']))
      .resolves.toMatchObject({ toolkit: 'gmail' });
    await expect(composio.validateToolArguments('GMAIL_FETCH_EMAILS', { query: 'ok', extra: true }, ['gmail']))
      .rejects.toThrow(/Unsupported connector argument/);
    await expect(composio.validateToolArguments('GMAIL_FETCH_EMAILS', { query: 2 }, ['gmail']))
      .rejects.toThrow(/Invalid connector arguments/);
  });

  test('does not accept unapproved write and destructive tools', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await expect(composio.validateToolArguments('GOOGLEDRIVE_DELETE_FILE', {}, ['googledrive']))
      .rejects.toThrow(/not allowed/i);
    await expect(composio.validateToolArguments('GOOGLEDRIVE_CREATE_PERMISSION', {}, ['googledrive']))
      .rejects.toThrow(/not allowed/i);
    await expect(composio.validateToolArguments('GMAIL_SEND_EMAIL', {}, ['gmail']))
      .rejects.toThrow(/unavailable/i);
  });

  test('restricts the generic Docs insert tool to explicit nonempty text', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ items: [
      {
        slug: 'GOOGLEDOCS_INSERT_TEXT_ACTION',
        name: 'Insert Text',
        input_parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false
        }
      }
    ] }));

    await expect(composio.validateToolArguments(
      'GOOGLEDOCS_INSERT_TEXT_ACTION', { text: 'Hello' }, ['googledocs']
    )).resolves.toMatchObject({ toolkit: 'googledocs' });
    await expect(composio.validateToolArguments(
      'GOOGLEDOCS_INSERT_TEXT_ACTION', { text: '' }, ['googledocs']
    )).rejects.toThrow(/include text to insert/i);
  });
});
