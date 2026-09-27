/**
 * Test: config/webSearch
 * Exa requests are mocked so the suite never requires credentials or network.
 */

const { searchWeb, isConfigured, normalizeSource, MAX_RESULTS } = require('../config/webSearch');

const originalFetch = global.fetch;
const originalApiKey = process.env.EXA_API_KEY;
const originalTimeout = process.env.WEB_SEARCH_TIMEOUT_MS;

beforeEach(() => {
  global.fetch = jest.fn();
  process.env.EXA_API_KEY = 'exa-test-key';
  delete process.env.WEB_SEARCH_TIMEOUT_MS;
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = originalApiKey;
  if (originalTimeout === undefined) delete process.env.WEB_SEARCH_TIMEOUT_MS;
  else process.env.WEB_SEARCH_TIMEOUT_MS = originalTimeout;
});

describe('searchWeb', () => {
  test('calls Exa server-side and returns bounded citation metadata', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: Array.from({ length: MAX_RESULTS + 2 }, (_, index) => ({
          title: `Source ${index}`,
          url: `https://example.com/${index}`,
          publishedDate: '2026-09-26T00:00:00.000Z',
          highlights: [`Relevant excerpt ${index}`]
        }))
      })
    });

    const result = await searchWeb('latest information');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.exa.ai/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer exa-test-key' }),
        body: JSON.stringify({
          query: 'latest information',
          type: 'auto',
          numResults: MAX_RESULTS,
          contents: { highlights: true }
        }),
        signal: expect.any(AbortSignal)
      })
    );
    expect(result.sources).toHaveLength(MAX_RESULTS);
    expect(result.sources[0]).toEqual({
      title: 'Source 0',
      url: 'https://example.com/0',
      publishedDate: '2026-09-26T00:00:00.000Z',
      highlights: ['Relevant excerpt 0']
    });
  });

  test('requires an API key without making a network request', async () => {
    delete process.env.EXA_API_KEY;

    await expect(searchWeb('query')).rejects.toMatchObject({
      code: 'WEB_SEARCH_NOT_CONFIGURED'
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(isConfigured()).toBe(false);
  });

  test('does not expose upstream error response bodies', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403, text: async () => 'secret details' });

    await expect(searchWeb('query')).rejects.toMatchObject({
      code: 'WEB_SEARCH_UNAVAILABLE',
      message: 'Exa web search returned HTTP 403.'
    });
  });

  test('fails explicitly when Exa returns no usable sources', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });

    await expect(searchWeb('query')).rejects.toMatchObject({
      code: 'WEB_SEARCH_NO_RESULTS'
    });
  });

  test('drops invalid URLs and strips unexpected schemes', () => {
    expect(normalizeSource({ url: 'javascript:alert(1)', highlights: ['x'] })).toBeNull();
    expect(normalizeSource({ url: 'not a URL', highlights: ['x'] })).toBeNull();
    expect(normalizeSource({ url: 'https://example.com', highlights: ['x'] })).toMatchObject({
      url: 'https://example.com/'
    });
  });
});
