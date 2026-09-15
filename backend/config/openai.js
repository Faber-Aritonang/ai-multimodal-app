/**
 * OpenAI Client Configuration
 *
 * Client dibuat lazy: jika OPENAI_API_KEY belum diisi, server tetap bisa start
 * dan endpoint non-AI tetap jalan. Error baru muncul saat fitur AI dipanggil.
 */

const OpenAI = require('openai');

// Model default untuk fitur chat dan text-to-image
const DEFAULT_CHAT_MODEL = 'gpt-3.5-turbo';
const DEFAULT_IMAGE_MODEL = 'dall-e-3';

let client = null;

/**
 * Dapatkan instance OpenAI SDK yang sudah siap dipakai.
 * @throws {Error} jika OPENAI_API_KEY tidak diset
 */
function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is not set. Add it to backend/.env to enable AI features.'
    );
  }

  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return client;
}

const getChatModel = () => process.env.OPENAI_CHAT_MODEL || DEFAULT_CHAT_MODEL;

const getImageModel = () => process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

/**
 * Apakah model gambar yang dipakai mendukung parameter response_format.
 * Model dall-e-* menerima 'b64_json'; gpt-image-* selalu mengembalikan base64.
 */
const supportsResponseFormat = (model) => String(model).startsWith('dall-e');

module.exports = {
  getOpenAIClient,
  getChatModel,
  getImageModel,
  supportsResponseFormat,
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_MODEL
};
