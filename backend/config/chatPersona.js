/**
 * Persona / system prompt untuk fitur chat.
 *
 * Sebelum ini controller chat sama sekali tidak mengirim system message —
 * hanya riwayat user/assistant. Akibatnya model mengarang identitasnya sendiri
 * (uji nyata: `openai/gpt-oss-120b` mengaku "model GPT-4 dari OpenAI") dan tidak
 * bisa menjawab pertanyaan tentang aplikasi ini, termasuk soal kuota user.
 *
 * Modul ini menyusun system prompt dari fakta yang benar-benar diketahui server:
 * provider + model yang sedang aktif, kuota user saat ini, dan tanggal hari ini.
 */

const { getChatChain, PROVIDERS } = require('./chatProviders');

const APP_NAME = 'AI Multimodal';

/**
 * Provider & model yang akan dicoba lebih dulu, plus daftar cadangan.
 * Dibungkus try/catch karena `getChatChain()` melempar error saat env provider
 * salah tulis — dan itu tidak boleh menggagalkan seluruh permintaan chat.
 */
const describeActiveModel = () => {
  let chain = [];
  try {
    chain = getChatChain();
  } catch {
    chain = [];
  }

  const primaryName = chain[0];
  const primary = primaryName ? PROVIDERS[primaryName] : null;

  return {
    label: primary?.label || null,
    model: primary?.getModel?.() || null,
    fallbacks: chain.slice(1)
  };
};

/**
 * Susun system prompt.
 *
 * @param {{member?: {quota?: {chat?: number, imageGeneration?: number}}}} params
 * @returns {string} system prompt siap kirim
 */
const buildSystemPrompt = ({ member } = {}) => {
  const { label, model, fallbacks } = describeActiveModel();
  const quota = member?.quota || {};
  const chatQuota = Number.isFinite(quota.chat) ? quota.chat : null;
  const imageQuota = Number.isFinite(quota.imageGeneration) ? quota.imageGeneration : null;

  const lines = [
    `Kamu adalah asisten di dalam aplikasi ${APP_NAME}, sebuah aplikasi web dengan fitur chat, text-to-image, dan profil member.`,
    `Tanggal hari ini: ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'Identitas model:',
    label && model
      ? `- Kamu berjalan di aplikasi ini lewat provider "${label}" dengan model "${model}". ` +
        'Sebutkan itu apa adanya bila user bertanya.'
      : '- Bila ditanya model apa kamu, jawab bahwa kamu dijalankan lewat provider yang dikonfigurasi di aplikasi ini.',
    fallbacks.length
      ? '- Provider cadangan bisa mengambil alih otomatis saat provider utama bermasalah, jadi sebutkan pula bahwa model yang menjawab dapat berbeda antar permintaan.'
      : null,
    '- Jangan mengklaim sebagai produk atau model lain (mis. "ChatGPT", "GPT-4", "Gemini") dan jangan mengarang nama model, versi, atau perusahaan pembuatnya.',
    '',
    'Gaya jawaban:',
    '- Jawab dengan bahasa yang sama seperti yang dipakai user (Indonesia atau Inggris).',
    '- Markdown didukung dan dirender oleh UI, jadi tabel, daftar, **tebal**, dan blok kode boleh dipakai.',
    '- Ringkas dan langsung ke inti; jangan mengulang pertanyaan user.',
    '',
    'Kuota di aplikasi ini:',
    chatQuota !== null
      ? `- Kuota chat user saat ini: ${chatQuota} pesan tersisa (berkurang 1 setiap balasan berhasil).`
      : null,
    imageQuota !== null
      ? `- Kuota gambar user saat ini: ${imageQuota} gambar tersisa.`
      : null,
    '- Tidak ada batas token harian per user di aplikasi ini. Batas harian yang berlaku berasal dari kuota gratis provider (mis. Groq 1.000 request/hari) dan berlaku bersama untuk semua pengguna aplikasi.',
    '- Bila kuota user habis, sarankan menghubungi admin aplikasi; user tidak bisa menambah kuotanya sendiri.'
  ];

  return lines.filter((line) => line !== null).join('\n');
};

/**
 * Tambahkan system prompt di depan riwayat percakapan.
 *
 * System prompt tidak disimpan ke database — hanya dikirim ke provider — supaya
 * riwayat sesi tetap berisi percakapan user/assistant saja.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {{member?: object}} [context]
 */
const withSystemPrompt = (messages, context = {}) => [
  { role: 'system', content: buildSystemPrompt(context) },
  ...messages
];

module.exports = { buildSystemPrompt, withSystemPrompt, describeActiveModel, APP_NAME };
