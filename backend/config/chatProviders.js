/**
 * Provider Chat (LLM)
 *
 * Semua provider di sini memakai klien OpenAI SDK dengan `baseURL` masing-masing,
 * jadi bentuk pemanggilannya identik:
 *   generate({ messages, maxTokens }) -> { content, model, usage }
 *
 * Dipilih lewat env:
 *   CHAT_PROVIDER           = groq | gemini | openai
 *   CHAT_FALLBACK_PROVIDER  = groq | gemini | openai | none
 *
 * Default tanpa mengisi apa pun: provider pertama yang punya API key, dengan
 * urutan Groq → Gemini → OpenAI. Fallback dipakai otomatis saat provider utama
 * gagal (mis. kuota harian gratisnya habis).
 *
 * Catatan penting: berbeda dari text-to-image, chat tidak punya provider tanpa
 * API key, jadi minimal satu key wajib diisi.
 */

const { getClient, getChatModel } = require('./openai');

const DEFAULT_MAX_TOKENS = 2000;
const PROVIDER_ORDER = ['groq', 'gemini', 'openai'];

// Groq biasanya menjawab < 1 detik, tapi free tier Gemini terukur 17-60 detik
// (dan kadang 503 sesaat lalu berhasil saat di-retry). Timeout dibuat eksplisit
// supaya provider yang menggantung tidak menahan request sampai batas default
// SDK (10 menit), tapi tetap cukup longgar untuk Gemini.
const DEFAULT_REQUEST_TIMEOUT_MS = 90000;
const DEFAULT_MAX_RETRIES = 1;

const getRequestTimeoutMs = () =>
  Number(process.env.CHAT_REQUEST_TIMEOUT_MS) || DEFAULT_REQUEST_TIMEOUT_MS;

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

// Nilai placeholder di .env.example tidak dianggap konfigurasi valid.
const PLACEHOLDER_VALUES = new Set([
  'gsk-your-groq-key-here',
  'your-gemini-key-here'
]);

const isSet = (value) => {
  if (!value) return false;
  const trimmed = String(value).trim();
  return trimmed !== '' && !PLACEHOLDER_VALUES.has(trimmed);
};

/**
 * Ambil token pertama dari sebuah secret.
 *
 * Nilai dari shell/.env bisa ikut tercemar tanpa disadari — mis. saat kunci
ditempel ke ~/.bashrc dengan tanda kutip yang tidak ditutup, dua baris
bergabung menjadi: `gsk_xxx\nexport GROQ_API_KEY=gsk_xxx`. Nilai berisi baris
baru seperti itu ditolak oleh fetch (header tidak valid) dan hanya muncul
sebagai "Connection error", jadi lebih baik dibersihkan di sini.
 *
 * API key tidak pernah mengandung spasi, jadi mengambil token pertama aman.
 */
const sanitizeSecret = (value) => String(value || '').trim().split(/\s+/)[0];

const createError = (message, code) => {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
};

const normalizeName = (value) => String(value || '').trim().toLowerCase();

/**
 * Pesan error provider + status HTTP bila ada (mis. 429 saat kuota habis).
 */
const describeError = (error) =>
  `${error.message}${error.status ? ` (HTTP ${error.status})` : ''}`;

/**
 * Panggil chat completion dan ambil teks jawabannya.
 */
const requestCompletion = async ({ client, model, messages, maxTokens, maxTokensParam }) => {
  const params = { model, messages };

  // Nama parameter batas token berbeda antar penyedia:
  // Groq sudah menandai `max_tokens` sebagai deprecated, sedangkan lapisan
  // kompatibilitas Gemini mengabaikan field yang tidak dikenal.
  if (maxTokens) params[maxTokensParam] = maxTokens;

  const response = await client.chat.completions.create(params);
  const content = response?.choices?.[0]?.message?.content;

  // Model reasoning (mis. gpt-oss) bisa mengembalikan content kosong kalau
  // jatah tokennya habis untuk berpikir — ini bukan error jaringan, tapi user
  // perlu pesan yang jelas, bukan bubble kosong.
  if (!content || !String(content).trim()) {
    throw createError(
      'The model returned an empty reply (its token budget may be too small)',
      'PROVIDER_ERROR'
    );
  }

  return { content, model, usage: response.usage || null };
};

/**
 * Groq — gratis tanpa kartu kredit (30 req/menit, 1.000 req/hari,
 * 200K token/hari pada model gpt-oss/qwen). Model tercepat dari ketiganya.
 */
const groq = {
  name: 'groq',
  label: 'Groq (gratis)',
  envVars: ['GROQ_API_KEY'],
  maxTokensParam: 'max_completion_tokens',

  isConfigured: () => isSet(process.env.GROQ_API_KEY),

  getModel: () => process.env.GROQ_CHAT_MODEL || DEFAULT_GROQ_MODEL,

  generate({ messages, maxTokens }) {
    return requestCompletion({
      client: getClient({
        apiKey: sanitizeSecret(process.env.GROQ_API_KEY),
        baseURL: process.env.GROQ_BASE_URL || GROQ_BASE_URL,
        timeout: getRequestTimeoutMs(),
        maxRetries: DEFAULT_MAX_RETRIES
      }),
      model: this.getModel(),
      messages,
      maxTokens,
      maxTokensParam: this.maxTokensParam
    });
  }
};

/**
 * Google Gemini — free tier paling longgar, tapi kontennya dipakai Google
 * untuk perbaikan produk selama masih di tier gratis.
 */
const gemini = {
  name: 'gemini',
  label: 'Google Gemini (free tier)',
  envVars: ['GEMINI_API_KEY'],
  maxTokensParam: 'max_tokens',

  isConfigured: () => isSet(process.env.GEMINI_API_KEY),

  getModel: () => process.env.GEMINI_CHAT_MODEL || DEFAULT_GEMINI_MODEL,

  generate({ messages, maxTokens }) {
    return requestCompletion({
      client: getClient({
        apiKey: sanitizeSecret(process.env.GEMINI_API_KEY),
        baseURL: process.env.GEMINI_BASE_URL || GEMINI_BASE_URL,
        timeout: getRequestTimeoutMs(),
        maxRetries: DEFAULT_MAX_RETRIES
      }),
      model: this.getModel(),
      messages,
      maxTokens,
      maxTokensParam: this.maxTokensParam
    });
  }
};

/**
 * OpenAI — paling matang, tapi butuh billing (bukan free tier).
 */
const openai = {
  name: 'openai',
  label: 'OpenAI',
  envVars: ['OPENAI_API_KEY'],
  maxTokensParam: 'max_tokens',

  isConfigured: () => isSet(process.env.OPENAI_API_KEY),

  getModel: () => getChatModel(),

  generate({ messages, maxTokens }) {
    return requestCompletion({
      client: getClient({
        apiKey: sanitizeSecret(process.env.OPENAI_API_KEY),
        timeout: getRequestTimeoutMs(),
        maxRetries: DEFAULT_MAX_RETRIES
      }),
      model: this.getModel(),
      messages,
      maxTokens,
      maxTokensParam: this.maxTokensParam
    });
  }
};

const PROVIDERS = { groq, gemini, openai };

/**
 * Provider pertama yang siap dipakai, sesuai urutan prioritas.
 */
const resolveDefaultPrimary = () =>
  PROVIDER_ORDER.find((name) => PROVIDERS[name].isConfigured()) || PROVIDER_ORDER[0];

/**
 * Urutan provider yang akan dicoba untuk satu pesan.
 * @returns {string[]}
 * @throws {Error} jika nama provider di env tidak dikenal
 */
const getChatChain = () => {
  const explicit = normalizeName(process.env.CHAT_PROVIDER);

  if (explicit && !PROVIDERS[explicit]) {
    throw createError(
      `Unknown CHAT_PROVIDER "${explicit}". Available: ${PROVIDER_ORDER.join(', ')}.`,
      'INVALID_PROVIDER_CONFIG'
    );
  }

  const chain = [explicit || resolveDefaultPrimary()];
  const fallbackRaw =
    process.env.CHAT_FALLBACK_PROVIDER === undefined
      ? null
      : normalizeName(process.env.CHAT_FALLBACK_PROVIDER);

  if (fallbackRaw === 'none') return chain;

  if (fallbackRaw) {
    if (!PROVIDERS[fallbackRaw]) {
      throw createError(
        `Unknown CHAT_FALLBACK_PROVIDER "${fallbackRaw}". Available: ${PROVIDER_ORDER.join(', ')}, none.`,
        'INVALID_PROVIDER_CONFIG'
      );
    }

    if (!chain.includes(fallbackRaw)) chain.push(fallbackRaw);
    return chain;
  }

  // Default: semua provider lain yang kredensialnya tersedia.
  for (const name of PROVIDER_ORDER) {
    if (!chain.includes(name) && PROVIDERS[name].isConfigured()) chain.push(name);
  }

  return chain;
};

/**
 * Kirim percakapan ke provider pertama yang tersedia dan berhasil.
 *
 * @param {{messages: Array<{role: string, content: string}>, maxTokens?: number}} params
 * @returns {Promise<{content: string, model: string, usage: object|null, provider: string, attempts: Array}>}
 */
const generateChatReply = async ({ messages, maxTokens }) => {
  const limit = Number(maxTokens || process.env.CHAT_MAX_TOKENS) || DEFAULT_MAX_TOKENS;
  const chain = getChatChain();
  const attempts = [];

  for (const name of chain) {
    const provider = PROVIDERS[name];

    if (!provider.isConfigured()) {
      attempts.push({ provider: name, reason: 'missing credentials' });
      continue;
    }

    try {
      const result = await provider.generate({ messages, maxTokens: limit });
      return { ...result, provider: name, attempts };
    } catch (error) {
      attempts.push({ provider: name, reason: describeError(error) });
    }
  }

  const summary = attempts.map((item) => `${item.provider}: ${item.reason}`).join('; ');
  const nothingConfigured =
    chain.length > 0 && chain.every((name) => !PROVIDERS[name].isConfigured());

  throw createError(
    `All chat providers failed (${summary}). Set a free API key in backend/.env: ` +
      'GROQ_API_KEY (https://console.groq.com/keys) or GEMINI_API_KEY.',
    nothingConfigured ? 'MISSING_CREDENTIALS' : 'PROVIDER_UNAVAILABLE'
  );
};

/**
 * Ringkasan konfigurasi provider chat, dipakai endpoint /health.
 */
const getChatProviderStatus = () => {
  const status = {};
  for (const name of PROVIDER_ORDER) {
    status[name] = PROVIDERS[name].isConfigured() ? 'configured' : 'missing';
  }

  let chain = [];
  try {
    chain = getChatChain();
  } catch {
    chain = [];
  }

  return { chain, status, defaultPrimary: resolveDefaultPrimary() };
};

module.exports = {
  generateChatReply,
  getChatChain,
  getChatProviderStatus,
  resolveDefaultPrimary,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_GROQ_MODEL,
  DEFAULT_GEMINI_MODEL,
  PROVIDERS,
  PROVIDER_ORDER
};
