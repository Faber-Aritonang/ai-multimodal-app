/**
 * Server-only Composio client for the Google connectors used by chat.
 *
 * The API key never leaves the backend. Sessions are scoped to our stable app
 * user ID, and only the tool slugs below are available to the chat model.
 */

const { logger } = require('./logger');

const API_ROOT = 'https://backend.composio.dev/api/v3.1';
const CACHE_TTL_MS = 5 * 60 * 1000;
const TOOLKITS = Object.freeze({
  gmail: { name: 'Gmail' },
  googledrive: { name: 'Google Drive' },
  googlesheets: { name: 'Google Sheets' },
  googledocs: { name: 'Google Docs' },
  googleslides: { name: 'Google Slides' }
});

// Keep this list intentionally small. Do not add delete, permission, sharing,
// generic batch-update, or arbitrary HTTP/proxy tools here.
const TOOLKIT_TOOLS = Object.freeze({
  gmail: ['GMAIL_FETCH_EMAILS', 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', 'GMAIL_SEND_EMAIL'],
  googledrive: ['GOOGLEDRIVE_FIND_FILE'],
  googlesheets: [
    'GOOGLESHEETS_SEARCH_SPREADSHEETS',
    'GOOGLESHEETS_BATCH_GET',
    'GOOGLESHEETS_CREATE_GOOGLE_SHEET1',
    'GOOGLESHEETS_VALUES_UPDATE'
  ],
  googledocs: [
    'GOOGLEDOCS_SEARCH_DOCUMENTS',
    'GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT',
    'GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN',
    'GOOGLEDOCS_INSERT_TEXT_ACTION'
  ],
  googleslides: [
    'GOOGLESLIDES_PRESENTATIONS_GET',
    'GOOGLESLIDES_CREATE_SLIDES_MARKDOWN',
    'GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE'
  ]
});

const READ_ONLY_TOOLS = new Set([
  'GMAIL_FETCH_EMAILS',
  'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
  'GOOGLEDRIVE_FIND_FILE',
  'GOOGLESHEETS_SEARCH_SPREADSHEETS',
  'GOOGLESHEETS_BATCH_GET',
  'GOOGLEDOCS_SEARCH_DOCUMENTS',
  'GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT',
  'GOOGLESLIDES_PRESENTATIONS_GET'
]);

const WRITE_TOOLS = new Set([
  'GMAIL_SEND_EMAIL',
  'GOOGLESHEETS_CREATE_GOOGLE_SHEET1',
  'GOOGLESHEETS_VALUES_UPDATE',
  'GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN',
  'GOOGLEDOCS_INSERT_TEXT_ACTION',
  'GOOGLESLIDES_CREATE_SLIDES_MARKDOWN',
  'GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE'
]);

const titleForToolkit = (slug) => TOOLKITS[slug]?.name || slug;

const getApiKey = () => String(process.env.COMPOSIO_API_KEY || '').trim();
const isConfigured = () => Boolean(getApiKey());

// OAuth app Google sendiri (opsional).
//
// Secara default tombol Connect memakai OAuth app milik Composio
// (`use_composio_managed_auth`), dan Google memblokir app yang belum diverifikasi
// untuk scope sensitif/restricted (gmail.send, directory.readonly) dengan layar
// merah "Aplikasi ini diblokir". Solusi resminya (dokumentasi Composio: custom
// auth configs): pakai OAuth client milik sendiri — kontrol consent screen,
// test users, dan verifikasi ada di tangan kita.
const OAUTH_CALLBACK_URI = 'https://backend.composio.dev/api/v3/toolkits/auth/callback';
const getGoogleClientId = () => String(process.env.COMPOSIO_GOOGLE_CLIENT_ID || '').trim();
const getGoogleClientSecret = () => String(process.env.COMPOSIO_GOOGLE_CLIENT_SECRET || '').trim();
const usesCustomGoogleClient = () => Boolean(getGoogleClientId() && getGoogleClientSecret());
const assertGoogleClientConfig = () => {
  if ((getGoogleClientId() || getGoogleClientSecret()) && !usesCustomGoogleClient()) {
    throw createComposioError(
      'COMPOSIO_GOOGLE_CLIENT_ID and COMPOSIO_GOOGLE_CLIENT_SECRET must be set together.',
      503
    );
  }
};

const createComposioError = (message, status) => {
  const error = new Error(message);
  error.status = status;
  error.code = 'COMPOSIO_ERROR';
  return error;
};

const request = async (endpoint, { method = 'GET', body, timeout = 20000 } = {}) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    const error = createComposioError('Composio is not configured on the server.', 503);
    error.code = 'COMPOSIO_NOT_CONFIGURED';
    throw error;
  }

  let response;
  try {
    response = await fetch(`${API_ROOT}${endpoint}`, {
      method,
      headers: {
        'x-api-key': apiKey,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeout)
    });
  } catch {
    throw createComposioError('Could not reach Composio. Please try again.', 502);
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Do not include raw upstream bodies in errors or logs; they may contain
    // user data and should never be returned to the browser.
  }

  if (!response.ok) {
    const upstreamMessage = String(payload?.error?.message || payload?.message || '').slice(0, 300) || null;
    const upstreamSlug = String(payload?.error?.slug || payload?.slug || '').slice(0, 120) || null;
    const unauthorized = response.status === 401 || response.status === 403;

    // Jejak ini yang menjawab "kenapa 503?" tanpa membuka dashboard provider:
    // kunci dicabut (401 APIKey_InvalidAPIKey), izin kurang (403), dan API yang
    // tumbang terlihat berbeda di kolom status/slug.
    logger.warn('Composio request failed', {
      endpoint,
      upstreamStatus: response.status,
      upstreamSlug,
      upstreamMessage
    });

    const error = createComposioError(
      unauthorized
        ? response.status === 401
          ? 'Composio rejected the server API key (HTTP 401). Set COMPOSIO_API_KEY to a current project API key.' + apiKeyKindHint(apiKey)
          : 'Composio rejected the request (HTTP 403). The project API key lacks permission for this endpoint.' +
            (upstreamSlug === 'APIKey_InsufficientPermissions'
              ? ' The key is read-only for this resource; the Connect button needs write access to "auth_configs" and "connected_accounts" (dashboard.composio.dev -> Settings -> API Keys), or run npm run check:composio in backend/ to verify.'
              : '')
        : 'The Google connector request failed. Please try again.',
      unauthorized ? 503 : 502
    );
    error.upstreamStatus = response.status;
    error.upstreamSlug = upstreamSlug;
    error.upstreamMessage = upstreamMessage;
    throw error;
  }

  return payload;
};

// Petunjuk yang menyebut JENIS kunci, bukan hanya "kunci salah".
//
// Composio punya dua jenis kunci yang sama-sama terlihat seperti "API key" di
// dashboard, dan yang satu ditolak mentah-mentah oleh REST API ini: kunci dari
// bagian "FOR YOU" berawalan `ck_` (consumer key, untuk Composio Connect/MCP),
// sedangkan project API key dari mode "PLATFORM" berawalan `ak_`. Tanpa
// petunjuk ini, kegagalannya terlihat seperti kunci yang sudah dicabut — dan
// pemiliknya akan membuat kunci baru dari tempat yang sama, lalu gagal lagi.
const apiKeyKindHint = (apiKey) => {
  if (apiKey.startsWith('ck_')) {
    return ' This key starts with "ck_", which is a "FOR YOU" consumer key (Composio Connect), not a project key. Switch the dashboard to PLATFORM mode (dashboard.composio.dev) and copy the key from Settings -> API Keys; it starts with "ak_".';
  }
  if (apiKey.startsWith('uak_')) {
    return ' This key starts with "uak_", which is a user API key; project REST calls need a project key starting with "ak_".';
  }
  return '';
};

const authConfigCache = new Map();
const toolSchemaCache = new Map();
const SCOPE_TOOLSETS = Object.freeze({
  gmail: ['GMAIL_FETCH_EMAILS', 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', 'GMAIL_SEND_EMAIL'],
  googledrive: ['GOOGLEDRIVE_FIND_FILE'],
  googlesheets: ['GOOGLESHEETS_SEARCH_SPREADSHEETS', 'GOOGLESHEETS_BATCH_GET', 'GOOGLESHEETS_CREATE_GOOGLE_SHEET1', 'GOOGLESHEETS_VALUES_UPDATE'],
  googledocs: ['GOOGLEDOCS_SEARCH_DOCUMENTS', 'GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT', 'GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN', 'GOOGLEDOCS_INSERT_TEXT_ACTION'],
  googleslides: ['GOOGLESLIDES_PRESENTATIONS_GET', 'GOOGLESLIDES_CREATE_SLIDES_MARKDOWN', 'GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE']
});

const getManagedAuthConfig = async (toolkit) => {
  if (!TOOLKITS[toolkit]) throw createComposioError('Unsupported Google connector.', 400);
  const cached = authConfigCache.get(toolkit);
  if (cached && cached.expiresAt > Date.now()) return cached.id;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    assertGoogleClientConfig();
    const customClient = usesCustomGoogleClient();
    const recommended = await request(`/toolkits/${encodeURIComponent(toolkit)}/scopes/recommended`, {
      method: 'POST',
      body: { tools: SCOPE_TOOLSETS[toolkit], auth_scheme: 'OAUTH2', toolkit_version: 'latest' }
    });
    const scopes = recommended?.scopes?.least_privilege;
    if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
      throw createComposioError('Composio could not determine the minimum Google permissions.', 502);
    }
    const scopeString = scopes.join(',');
    const configName = `AI Multimodal - ${toolkit}`;
    const search = new URLSearchParams({
      toolkit_slug: toolkit,
      is_composio_managed: customClient ? 'false' : 'true',
      search: configName,
      limit: '100'
    });
    const listed = await request(`/auth_configs?${search}`);
    const existing = (listed.items || []).find((item) => {
      const configuredScopes = item.credentials?.scopes || item.auth_config?.credentials?.scopes;
      const normalizedScopes = Array.isArray(configuredScopes)
        ? configuredScopes.slice().sort().join(',')
        : String(configuredScopes || '').split(',').filter(Boolean).sort().join(',');
      return Boolean(item.is_composio_managed) === !customClient &&
        item.status !== 'DISABLED' &&
        item.name === configName && normalizedScopes === scopes.slice().sort().join(',');
    });
    if (existing?.id) return existing.id;

    // Bentuk payload `use_custom_auth` diverifikasi langsung ke API v3.1:
    // field di level `auth_config` memakai camelCase (`authScheme`), tetapi
    // isian `credentials` memakai snake_case (`client_id`, dst).
    const created = await request('/auth_configs', {
      method: 'POST',
      body: {
        toolkit: { slug: toolkit },
        auth_config: customClient
          ? {
              type: 'use_custom_auth',
              authScheme: 'OAUTH2',
              credentials: {
                client_id: getGoogleClientId(),
                client_secret: getGoogleClientSecret(),
                oauth_redirect_uri: OAUTH_CALLBACK_URI,
                scopes: scopeString
              },
              name: configName
            }
          : {
              type: 'use_composio_managed_auth',
              credentials: { scopes: scopeString },
              name: configName
            }
      }
    });
    const authConfigId = created?.auth_config?.id || created?.id;
    if (!authConfigId) throw createComposioError('Composio did not return an auth configuration.', 502);
    return authConfigId;
  })();

  authConfigCache.set(toolkit, { promise, expiresAt: 0 });
  try {
    const id = await promise;
    authConfigCache.set(toolkit, { id, expiresAt: Date.now() + CACHE_TTL_MS });
    return id;
  } catch (error) {
    authConfigCache.delete(toolkit);
    throw error;
  }
};

const stableComposioUserId = (uid) => `ai-multimodal:${String(uid || '').trim()}`;

const startConnection = async (uid, toolkit) => {
  if (!TOOLKITS[toolkit]) throw createComposioError('Unsupported Google connector.', 400);
  const authConfigId = await getManagedAuthConfig(toolkit);
  const linked = await request('/connected_accounts/link', {
    method: 'POST',
    body: {
      auth_config_id: authConfigId,
      user_id: stableComposioUserId(uid)
    }
  });
  if (!linked.redirect_url) throw createComposioError('Composio did not return a Google authorization link.', 502);
  return { redirectUrl: linked.redirect_url };
};

const listUserAccounts = async (uid, toolkit) => {
  const query = new URLSearchParams({ limit: '100' });
  query.append('user_ids', stableComposioUserId(uid));
  if (toolkit) query.append('toolkit_slugs', toolkit);
  query.append('statuses', 'ACTIVE');
  const result = await request(`/connected_accounts?${query}`);
  const userId = stableComposioUserId(uid);
  return Array.isArray(result.items) ? result.items.filter((account) => {
    const accountUserId = account.user_id || account.user?.id;
    const toolkitSlug = (account.toolkit?.slug || account.toolkit_slug || '').toLowerCase();
    return account.status === 'ACTIVE' &&
      account.is_disabled !== true &&
      accountUserId === userId &&
      (!toolkit || toolkitSlug === toolkit);
  }) : [];
};

const getConnectorStatus = async (uid) => {
  if (!isConfigured()) return Object.keys(TOOLKITS).map((slug) => ({
    slug,
    name: titleForToolkit(slug),
    connected: false,
    accounts: []
  }));

  const accounts = await listUserAccounts(uid);
  return Object.entries(TOOLKITS).map(([slug, toolkit]) => {
    const matches = accounts.filter((account) =>
      (account.toolkit?.slug || account.toolkit_slug || '').toLowerCase() === slug
    );
    return {
      slug,
      name: toolkit.name,
      connected: matches.length > 0,
      accounts: matches.map((account) => ({
        id: account.id,
        ...(account.alias ? { alias: account.alias } : {}),
        ...(account.word_id ? { label: account.word_id } : {})
      }))
    };
  });
};

// Validator tool call Groq (dan provider ketat lainnya) menolak `null` untuk
// field opsional yang skemanya hanya "string" — padahal model kadang mengisi
// field opsional dengan null (konvensi OpenAI structured outputs), lalu seluruh
// provider gagal berantai dan chat menjawab "All chat providers failed".
// Dua lapis perbaikan:
//   1. Skema yang dikirim ke provider menyatakan field opsional nullable.
//   2. Nilai null dibuang sebelum dieksekusi ("absen" ≠ null di validator
//      Composio), jadi provider yang tidak mendukung null pun tetap aman.
const makeNullable = (schema) => {
  if (Array.isArray(schema.enum) && !schema.enum.includes(null)) schema.enum = [...schema.enum, null];
  if (typeof schema.type === 'string') schema.type = [schema.type, 'null'];
  else if (Array.isArray(schema.type) && !schema.type.includes('null')) schema.type = [...schema.type, 'null'];
};

const allowNullForOptional = (schema) => {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object') {
    const required = new Set(schema.required || []);
    for (const [key, child] of Object.entries(schema.properties)) {
      if (!child || typeof child !== 'object') continue;
      if (!required.has(key) && (child.type !== undefined || Array.isArray(child.enum))) makeNullable(child);
      allowNullForOptional(child);
    }
  }
  if (Array.isArray(schema.items)) schema.items.forEach((item) => allowNullForOptional(item));
  else if (schema.items && typeof schema.items === 'object') allowNullForOptional(schema.items);
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[key])) schema[key].forEach((variant) => allowNullForOptional(variant));
  }
};

const stripNullArgs = (value) => {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined).map(stripNullArgs);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined)
        .map(([key, item]) => [key, stripNullArgs(item)])
    );
  }
  return value;
};

const getToolSchemas = async (selectedToolkits = Object.keys(TOOLKITS)) => {
  const toolkits = [...new Set(selectedToolkits)].filter((slug) => TOOLKITS[slug]);
  const allSlugs = toolkits.flatMap((slug) => TOOLKIT_TOOLS[slug]);
  const cacheKey = allSlugs.join(',');
  const cached = toolSchemaCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.tools;

  const query = new URLSearchParams({
    tool_slugs: allSlugs.join(','),
    toolkit_versions: 'latest',
    limit: String(allSlugs.length)
  });
  const result = await request(`/tools?${query}`);
  const tools = new Map();
  for (const tool of result.items || []) {
    const slug = tool.slug;
    if (!allSlugs.includes(slug) || !tool.input_parameters) continue;
    allowNullForOptional(tool.input_parameters);
    tools.set(slug, {
      type: 'function',
      function: {
        name: slug,
        description: String(tool.description || tool.name || slug).slice(0, 1000),
        parameters: tool.input_parameters
      }
    });
  }

  toolSchemaCache.set(cacheKey, { tools, expiresAt: Date.now() + CACHE_TTL_MS });
  return tools;
};

const getAllowedTools = async (selectedToolkits = Object.keys(TOOLKITS)) => {
  const schemas = await getToolSchemas(selectedToolkits);
  return [...schemas.values()];
};

const getToolkitForTool = (toolSlug) => Object.entries(TOOLKIT_TOOLS)
  .find(([, slugs]) => slugs.includes(toolSlug))?.[0] || null;

const resolveUserAccount = async (uid, toolkit, connectedAccountId) => {
  const accounts = await listUserAccounts(uid, toolkit);
  if (!accounts.length) {
    const error = createComposioError(`Connect ${titleForToolkit(toolkit)} before using this action.`, 409);
    error.code = 'COMPOSIO_NOT_CONNECTED';
    throw error;
  }

  if (connectedAccountId) {
    const selected = accounts.find((account) => account.id === connectedAccountId);
    if (!selected) {
      const error = createComposioError('The selected Google account is not available for this connector.', 403);
      error.code = 'COMPOSIO_INVALID_ACCOUNT';
      throw error;
    }
    return selected;
  }

  if (accounts.length > 1) {
    const error = createComposioError(`Select which ${titleForToolkit(toolkit)} account to use.`, 409);
    error.code = 'COMPOSIO_ACCOUNT_REQUIRED';
    throw error;
  }
  return accounts[0];
};

const valueMatchesType = (type, value) => {
  switch (type) {
    case 'object': return typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
};

const assertValidJsonValue = (value, schema, path) => {
  if (value === null) return;
  const type = schema?.type;
  const types = Array.isArray(type) ? type : type ? [type] : [];
  const valid = !types.length || types.some((expected) => valueMatchesType(expected, value));
  if (!valid) throw createComposioError(`Invalid connector arguments at ${path}.`, 400);
  if (schema?.enum && !schema.enum.includes(value)) {
    throw createComposioError(`Invalid connector arguments at ${path}.`, 400);
  }
  if (typeof value === 'string' && schema?.maxLength && value.length > schema.maxLength) {
    throw createComposioError(`Connector argument ${path} is too long.`, 400);
  }
  if (Array.isArray(value)) {
    if (schema?.maxItems && value.length > schema.maxItems) throw createComposioError(`Too many values in ${path}.`, 400);
    if (schema?.items) value.forEach((item, index) => assertValidJsonValue(item, schema.items, `${path}[${index}]`));
  }
  if (type === 'object' && schema?.properties) {
    const keys = Object.keys(value);
    const extras = keys.filter((key) => !Object.hasOwn(schema.properties, key));
    if (extras.length && schema.additionalProperties !== true) {
      throw createComposioError(`Unsupported connector argument: ${path}.${extras[0]}.`, 400);
    }
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) throw createComposioError(`Missing connector argument: ${path}.${required}.`, 400);
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties[key]) assertValidJsonValue(child, schema.properties[key], `${path}.${key}`);
    }
  }
};

const validateToolArguments = async (toolSlug, args, selectedToolkits = Object.keys(TOOLKITS)) => {
  const toolkit = getToolkitForTool(toolSlug);
  if (!toolkit || !selectedToolkits.includes(toolkit) || !READ_ONLY_TOOLS.has(toolSlug) && !WRITE_TOOLS.has(toolSlug)) {
    throw createComposioError('This connector action is not allowed.', 400);
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw createComposioError('Invalid connector arguments.', 400);
  }
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > 30000) {
    throw createComposioError('Connector arguments exceed the allowed size.', 413);
  }
  args = stripNullArgs(args);

  const schemas = await getToolSchemas([toolkit]);
  const definition = schemas.get(toolSlug)?.function?.parameters;
  if (!definition) throw createComposioError('This connector action is currently unavailable.', 502);
  assertValidJsonValue(args, definition, 'arguments');

  // The generic Docs/Slides batch APIs include destructive operations; permit
  // only insert/replace/update request types and never expose object deletion.
  if (toolSlug === 'GOOGLEDOCS_INSERT_TEXT_ACTION') {
    const text = args.text ?? args.insertion_text ?? args.insert_text;
    if (typeof text !== 'string' || !text.trim()) {
      throw createComposioError('Google Docs edits must include text to insert.', 400);
    }
  }
  if (toolSlug === 'GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE') {
    if (args.requests !== undefined || typeof args.markdown_text !== 'string') {
      throw createComposioError('Only adding Markdown slides to an existing presentation is allowed.', 400);
    }
  }
  if (toolSlug === 'GOOGLESLIDES_CREATE_SLIDES_MARKDOWN' && typeof args.markdown_text !== 'string') {
    throw createComposioError('New presentations must include slide content.', 400);
  }
  return { toolkit, args };
};

const executeTool = async (
  uid,
  toolSlug,
  args,
  selectedToolkits = Object.keys(TOOLKITS),
  connectedAccountId
) => {
  const { toolkit, args: validArgs } = await validateToolArguments(toolSlug, args, selectedToolkits);
  const account = await resolveUserAccount(uid, toolkit, connectedAccountId);

  const result = await request(`/tools/execute/${encodeURIComponent(toolSlug)}`, {
    method: 'POST',
    timeout: 80000,
    body: {
      connected_account_id: account.id,
      user_id: stableComposioUserId(uid),
      version: 'latest',
      arguments: validArgs
    }
  });
  if (result.error || result.successful === false) {
    throw createComposioError('Google connector could not complete this action.', 502);
  }
  return { toolkit, data: result.data };
};

const clearCaches = () => {
  authConfigCache.clear();
  toolSchemaCache.clear();
};

module.exports = {
  API_ROOT,
  OAUTH_CALLBACK_URI,
  TOOLKITS,
  TOOLKIT_TOOLS,
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
  isConfigured,
  usesCustomGoogleClient,
  stableComposioUserId,
  getManagedAuthConfig,
  getAllowedTools,
  getConnectorStatus,
  startConnection,
  getToolkitForTool,
  stripNullArgs,
  validateToolArguments,
  executeTool,
  listUserAccounts,
  resolveUserAccount,
  clearCaches,
  request
};
