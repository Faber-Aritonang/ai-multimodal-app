/**
 * OpenAI Client Configuration
 *
 * Selain OpenAI sendiri, modul ini dipakai oleh provider yang menyediakan
 * endpoint **kompatibel OpenAI** (Groq, Gemini) — cukup beda `baseURL` + `apiKey`,
 * tanpa menambah dependency baru.
 *
 * Client dibuat lazy: jika API key belum diisi, server tetap bisa start dan
 * endpoint non-AI tetap jalan. Error baru muncul saat fitur AI dipanggil.
 */

const OpenAI = require('openai');

// Model default untuk fitur chat dan text-to-image
const DEFAULT_CHAT_MODEL = 'gpt-3.5-turbo';
const DEFAULT_IMAGE_MODEL = 'dall-e-3';

const MISSING_KEY_MESSAGE =
  'OPENAI_API_KEY is not set. Add it to backend/.env to enable AI features.';

const createMissingKeyError = () => {
  const error = new Error(MISSING_KEY_MESSAGE);
  error.code = 'MISSING_CREDENTIALS';
  return error;
};

/**
 * Cache klien per baseURL. Kalau API key-nya berubah (mis. setelah mengedit
 * .env lalu restart), klien lama tidak dipakai lagi.
 */
const clients = new Map();

/**
 * Klien OpenAI SDK untuk apiKey/baseURL apa pun.
 * @param {{apiKey?: string, baseURL?: string, timeout?: number, maxRetries?: number}} [options]
 * @throws {Error} dengan code MISSING_CREDENTIALS jika key kosong
 */
function getClient({ apiKey, baseURL, timeout, maxRetries } = {}) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw createMissingKeyError();

  const cacheKey = baseURL || 'default';
  const cached = clients.get(cacheKey);

  if (cached && cached.apiKey === key) return cached.client;

  const client = new OpenAI({
    apiKey: key,
    ...(baseURL ? { baseURL } : {}),
    // Batas waktu eksplisit: default SDK OpenAI adalah 10 menit dengan 2 retry,
    // terlalu lama untuk endpoint kita yang tidak streaming — provider yang
    // menggantung akan menahan request HTTP sampai sepuluh menit.
    ...(timeout ? { timeout } : {}),
    ...(maxRetries === undefined ? {} : { maxRetries })
  });

  clients.set(cacheKey, { apiKey: key, client });
  return client;
}

/**
 * Klien default (OpenAI). Dipertahankan sebagai nama lama karena sudah dipakai
 * provider text-to-image.
 */
function getOpenAIClient() {
  return getClient({ apiKey: process.env.OPENAI_API_KEY });
}

const getChatModel = () => process.env.OPENAI_CHAT_MODEL || DEFAULT_CHAT_MODEL;

const getImageModel = () => process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

/**
 * Apakah model gambar yang dipakai mendukung parameter response_format.
 * Model dall-e-* menerima 'b64_json'; gpt-image-* selalu mengembalikan base64.
 */
const supportsResponseFormat = (model) => String(model).startsWith('dall-e');

module.exports = {
  getClient,
  getOpenAIClient,
  getChatModel,
  getImageModel,
  supportsResponseFormat,
  MISSING_KEY_MESSAGE,
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_MODEL
};
