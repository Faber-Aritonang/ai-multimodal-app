/**
 * Provider Sound-to-Text (transkripsi audio menjadi teks).
 *
 * Semua provider dibungkus ke bentuk yang sama:
 *   transcribe({ buffer, format, mimeType, language, prompt })
 *     -> { text, provider, model, language }
 *
 * Provider dipilih lewat env:
 *   STT_PROVIDER           = groq | gemini | openai | none
 *   STT_FALLBACK_PROVIDER  = groq | gemini | openai | none
 *                            (default: gemini)
 *
 * Default tanpa diisi: provider pertama yang kredensialnya tersedia, urut
 * Groq -> Gemini -> OpenAI. Dua yang pertama gratis; OpenAI tetap terdaftar
 * tetapi tidak pernah dipakai otomatis karena berbayar — ia hanya melayani
 * bila diminta lewat `STT_PROVIDER=openai`.
 *
 * URUTANNYA SENGAJA Groq lebih dulu. Tidak seperti text-to-sound (yang punya
 * Edge sebagai jalur tanpa kunci sama sekali), TIDAK ADA provider transkripsi
 * yang bisa dipakai tanpa akun. Karena itu yang dicari adalah provider gratis
 * paling longgar dan paling cepat: Groq Whisper-large-v3 membalas < 2 detik
 * dengan 1.000 request/hari, sedangkan kuota gratis Gemini jauh lebih ketat
 * per menit. Gemini tetap dipakai sebagai cadangan default: kuncinya sering
 * sudah ada di mesin yang sama untuk chat/TTS, jadi jaringan cadangannya tidak
 * bergantung pada editor yang mengisi variabel baru.
 *
 * Catatan bahasa: transkripsi di aplikasi ini diarahkan ke Bahasa Indonesia
 * secara default (`STT_DEFAULT_LANGUAGE`), tetapi bahasa tetap bisa dipilih per
 * permintaan — termasuk `auto` yang membiarkan provider mendeteksi sendiri.
 */

const { toFile } = require('openai');
const { getClient } = require('./openai');
const { GEMINI_BASE_URL } = require('./soundProviders');

const PROVIDER_ORDER = ['groq', 'gemini', 'openai'];
// Cadangan gratis: dipakai saat provider utama gagal sesaat (mis. kuota harian
// Groq habis). OpenAI sengaja bukan cadangan default — cadangan berbayar bisa
// diam-diam memakai kuota berbayar pemilik kunci.
const DEFAULT_FALLBACK_PROVIDER = 'gemini';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

const DEFAULT_GROQ_MODEL = 'whisper-large-v3';
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
// Whisper klasik dipakai sebagai default OpenAI: hasilnya sudah lebih dari
// cukup untuk Bahasa Indonesia, dan model `gpt-4o-transcribe` bisa dipilih
// lewat env bila akurasinya memang dibutuhkan.
const DEFAULT_OPENAI_MODEL = 'whisper-1';

const DEFAULT_LANGUAGE = 'id';
const DEFAULT_TIMEOUT_MS = 120000;

// Batas keras OpenAI/Groq untuk satu berkas (25 MB). Divalidasi juga di
// controller supaya body raksasa tidak masuk ke memori.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 500;

/**
 * Format audio yang dikenali, dari magic bytes isinya (bukan dari header yang
 * dikirim klien). Nama di sini dipakai sebagai satu-satunya bahasa format antar
 * modul: controller memvalidasinya, dan rantai provider memakainya untuk
 * melewati provider yang tidak sanggup membacanya.
 */
const AUDIO_MIME_TYPES = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
  aac: 'audio/aac',
  aiff: 'audio/aiff'
};

/**
 * Format yang sanggup dibaca tiap provider.
 *
 * Bukan daftar yang bisa disatukan: Gemini TIDAK menerima WebM/Opus (format
 * yang paling sering dihasilkan MediaRecorder), sedangkan Groq/OpenAI
 * menerimanya. Tanpa daftar per provider, rekaman dari browser akan dikirim ke
 * Gemini dan gagal dengan pesan yang sulit dipahami, padahal provider lain di
 * rantai sanggup melayaninya.
 */
const SUPPORTED_FORMATS_BY_PROVIDER = {
  groq: ['flac', 'mp3', 'm4a', 'ogg', 'wav', 'webm'],
  openai: ['flac', 'mp3', 'm4a', 'ogg', 'wav', 'webm'],
  gemini: ['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac', 'm4a']
};

const mimeTypeFor = (format) => AUDIO_MIME_TYPES[format] || 'application/octet-stream';

/**
 * Format audio dari isi berkasnya.
 *
 * Diperiksa dari magic bytes seperti pada gambar: klien bisa saja mengirim
 * MIME type yang salah, dan provider menerima berkas yang benar-benar bisa
 * dibacanya. Mengembalikan null untuk apa pun yang tidak dikenali, supaya
 * controller menolaknya lebih awal dengan pesan yang jelas.
 *
 * @returns {'wav'|'mp3'|'m4a'|'ogg'|'flac'|'webm'|null}
 */
const detectAudioFormat = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  const ascii = (start, end) => buffer.toString('ascii', start, end);

  // RIFF....WAVE
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  // WebM/Matroska: EBML header.
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return 'webm';
  }
  // MP4/M4A: `ftyp` sebagai box pertama.
  if (ascii(4, 8) === 'ftyp') return 'm4a';
  // MP3: tag ID3, atau frame sync (0xFFE0) untuk berkas tanpa tag.
  if (ascii(0, 3) === 'ID3') return 'mp3';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3';

  return null;
};

// Nilai placeholder di .env.example tidak dianggap konfigurasi valid.
const PLACEHOLDER_VALUES = new Set([
  'gsk-your-groq-key-here',
  'your-gemini-key-here',
  'sk-your-openai-key-here'
]);

const isSet = (value) => {
  if (!value) return false;
  const trimmed = String(value).trim();
  return trimmed !== '' && !PLACEHOLDER_VALUES.has(trimmed);
};

/**
 * Ambil token pertama dari sebuah secret.
 * Alasannya sama dengan modul provider lain: nilai dari shell/.env bisa
 * tercemar (mis. dua baris bergabung menjadi `export VAR=...`), dan nilai
 * berisi baris baru ditolak sebagai header HTTP.
 */
const sanitizeSecret = (value) => String(value || '').trim().split(/\s+/)[0];

const createError = (message, code) => {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
};

const getTimeoutMs = () =>
  Number(process.env.STT_REQUEST_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

const getDefaultLanguage = () =>
  (process.env.STT_DEFAULT_LANGUAGE || DEFAULT_LANGUAGE).trim() || DEFAULT_LANGUAGE;

const normalizeName = (value) =>
  String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/**
 * Kode galat dari status HTTP provider. `429` sengaja dianggap kegagalan
 * sesaat supaya rantai berlanjut ke provider cadangan (itu jalur yang dipakai
 * ketika kuota gratis sebuah provider habis).
 */
const errorCodeFromStatus = (status) => {
  if (status === 401 || status === 403) return 'INVALID_PROVIDER_CONFIG';
  if (status === 429 || (status && status >= 500)) return 'PROVIDER_UNAVAILABLE';
  return 'PROVIDER_ERROR';
};

/** Pesan galat dari balasan JSON provider, kalau ada. */
const readErrorMessage = async (response) => {
  try {
    const text = await response.text();
    const parsed = JSON.parse(text);
    const pesan =
      parsed?.error?.message || parsed?.detail?.message || parsed?.message || text;

    return String(pesan || '').slice(0, 300);
  } catch {
    return '';
  }
};

/** Label bahasa untuk arahan Gemini (provider ini tidak punya parameter `language`). */
const LANGUAGE_LABELS = {
  id: 'Indonesia',
  en: 'Inggris',
  ms: 'Melayu',
  jv: 'Jawa',
  su: 'Sunda'
};

const languageLabel = (language) => LANGUAGE_LABELS[language] || language;

/**
 * Dua provider (Groq & OpenAI) memakai endpoint transkripsi yang kompatibel
 * OpenAI, jadi isi permintaannya identik — hanya baseURL dan kuncinya berbeda.
 * Menyatukannya di sini mencegah keduanya menyimpang tanpa disadari.
 *
 * @returns {Promise<{text: string, provider: string, model: string, language: string|null}>}
 */
const transcribeOpenAiCompatible = async ({
  buffer,
  format,
  mimeType,
  language,
  prompt,
  apiKey,
  baseURL,
  provider,
  model
}) => {
  const client = getClient({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    timeout: getTimeoutMs(),
    // Beberapa provider transkripsi dihitung per detik audio; percobaan ulang
    // otomatis hanya menggandakan biaya untuk kegagalan yang sama.
    maxRetries: 0
  });

  // SDK OpenAI menerima buffer lewat helper `toFile`, jadi tidak perlu menulis
  // berkas sementara ke disk.
  const file = await toFile(buffer, `audio.${format}`, { type: mimeType });

  let response;

  try {
    response = await client.audio.transcriptions.create({
      file,
      model,
      // `auto` berarti biarkan provider mendeteksi bahasanya: parameternya
      // tidak dikirim sama sekali.
      ...(language && language !== 'auto' ? { language } : {}),
      ...(prompt ? { prompt } : {})
    });
  } catch (error) {
    const status = error?.status;

    throw createError(
      `${provider} transcribe error: ${error.message}${status ? ` (HTTP ${status})` : ''}`,
      status ? errorCodeFromStatus(status) : 'PROVIDER_UNAVAILABLE'
    );
  }

  const text = typeof response?.text === 'string' ? response.text.trim() : '';

  if (!text) {
    throw createError(
      `${provider} tidak mengembalikan teks untuk audio ini. Coba audio yang lebih jelas atau lebih panjang.`,
      'PROVIDER_ERROR'
    );
  }

  return { text, provider, model, language: language && language !== 'auto' ? language : null };
};

/** Groq Whisper — gratis, 1.000 request/hari, endpoint kompatibel OpenAI. */
const groq = {
  name: 'groq',
  label: 'Groq Whisper (whisper-large-v3)',
  envVars: ['GROQ_API_KEY'],
  supportedFormats: SUPPORTED_FORMATS_BY_PROVIDER.groq,

  isConfigured: () => isSet(process.env.GROQ_API_KEY),

  getModel: () => process.env.GROQ_TRANSCRIBE_MODEL || DEFAULT_GROQ_MODEL,

  transcribe: (params) =>
    transcribeOpenAiCompatible({
      ...params,
      apiKey: sanitizeSecret(process.env.GROQ_API_KEY),
      baseURL: process.env.GROQ_BASE_URL || GROQ_BASE_URL,
      provider: 'groq',
      model: process.env.GROQ_TRANSCRIBE_MODEL || DEFAULT_GROQ_MODEL
    })
};

/** OpenAI Whisper — berbayar, hanya dipakai bila diminta eksplisit. */
const openai = {
  name: 'openai',
  label: 'OpenAI Whisper (whisper-1)',
  envVars: ['OPENAI_API_KEY'],
  supportedFormats: SUPPORTED_FORMATS_BY_PROVIDER.openai,

  isConfigured: () => isSet(process.env.OPENAI_API_KEY),

  getModel: () => process.env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_OPENAI_MODEL,

  transcribe: (params) =>
    transcribeOpenAiCompatible({
      ...params,
      apiKey: sanitizeSecret(process.env.OPENAI_API_KEY),
      provider: 'openai',
      model: process.env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_OPENAI_MODEL
    })
};

/** Ambil teks dari balasan Gemini. */
const extractGeminiText = (payload) => {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const teks = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  return teks || null;
};

/**
 * Google Gemini — audio dikirim inline sebagai base64 ke generateContent.
 *
 * Bentuknya berbeda dari dua provider lain: tidak ada endpoint transkripsi
 * khusus, jadi teksnya diminta lewat percakapan biasa. Karena itu bahasanya
 * diarahkan lewat kalimat di dalam permintaan, bukan parameter `language`.
 */
const gemini = {
  name: 'gemini',
  label: 'Google Gemini (audio understanding)',
  envVars: ['GEMINI_API_KEY'],
  supportedFormats: SUPPORTED_FORMATS_BY_PROVIDER.gemini,

  isConfigured: () => isSet(process.env.GEMINI_API_KEY),

  getModel: () => process.env.GEMINI_TRANSCRIBE_MODEL || DEFAULT_GEMINI_MODEL,

  async transcribe({ buffer, mimeType, language, prompt, format }) {
    const model = process.env.GEMINI_TRANSCRIBE_MODEL || DEFAULT_GEMINI_MODEL;
    const apiKey = sanitizeSecret(process.env.GEMINI_API_KEY);

    const arahan =
      language && language !== 'auto'
        ? `Transkripsikan audio berikut apa adanya dalam bahasa ${languageLabel(language)}.`
        : 'Transkripsikan audio berikut apa adanya dan deteksi bahasanya sendiri.';

    // Kosa kata/prompt tambahan dari klien diletakkan sebelum audio supaya
    // berfungsi seperti `prompt` di Whisper.
    const konteks = prompt ? ` Konteks untuk membantu akurasi: ${prompt}.` : '';

    const instruction =
      `${arahan}${konteks} Balas HANYA teks transkripnya, tanpa penjelasan, ` +
      'tanpa terjemahan, dan tanpa tanda kutip.';

    let response;

    try {
      response = await fetch(
        `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: instruction },
                  { inlineData: { mimeType, data: buffer.toString('base64') } }
                ]
              }
            ]
          }),
          signal: AbortSignal.timeout(getTimeoutMs())
        }
      );
    } catch (error) {
      throw createError(`Gemini transcribe error: ${error.message}`, 'PROVIDER_UNAVAILABLE');
    }

    if (!response.ok) {
      const detail = await readErrorMessage(response);

      throw createError(
        `Gemini transcribe error: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
        errorCodeFromStatus(response.status)
      );
    }

    const payload = await response.json();
    const text = extractGeminiText(payload);

    if (!text) {
      throw createError(
        'Gemini tidak mengembalikan teks. Kunci yang diterima: ' +
          `${Object.keys(payload || {}).join(', ') || '(balasan kosong)'}.`,
        'PROVIDER_ERROR'
      );
    }

    return {
      text,
      provider: 'gemini',
      model,
      language: language && language !== 'auto' ? language : null,
      format
    };
  }
};

const PROVIDERS = { groq, gemini, openai };

/**
 * Provider utama default: yang pertama punya kredensial.
 * Kalau tidak ada satu pun, nama pertama di urutan dikembalikan supaya pesan
 * galatnya menyebut provider yang paling mungkin diaktifkan.
 */
const resolveDefaultPrimary = () =>
  PROVIDER_ORDER.find((name) => PROVIDERS[name].isConfigured()) || PROVIDER_ORDER[0];

/**
 * Urutan provider yang dicoba untuk satu permintaan transkripsi.
 *
 * `STT_PROVIDER=none` mematikan fiturnya — dipakai test dan operator yang
 * ingin menonaktifkannya tanpa menghapus kodenya.
 *
 * @returns {string[]}
 * @throws {Error} jika nama provider di env tidak dikenal
 */
const getSpeechToTextChain = () => {
  const explicit = normalizeName(process.env.STT_PROVIDER);

  if (explicit === 'none') return [];

  if (explicit && !PROVIDERS[explicit]) {
    throw createError(
      `Unknown STT_PROVIDER "${explicit}". Available: ${PROVIDER_ORDER.join(', ')}, none.`,
      'INVALID_PROVIDER_CONFIG'
    );
  }

  const primary = explicit || resolveDefaultPrimary();

  const fallbackRaw =
    process.env.STT_FALLBACK_PROVIDER === undefined
      ? DEFAULT_FALLBACK_PROVIDER
      : normalizeName(process.env.STT_FALLBACK_PROVIDER);

  const chain = [primary];

  if (fallbackRaw && fallbackRaw !== 'none') {
    if (!PROVIDERS[fallbackRaw]) {
      throw createError(
        `Unknown STT_FALLBACK_PROVIDER "${fallbackRaw}". Available: ` +
          `${PROVIDER_ORDER.join(', ')}, none.`,
        'INVALID_PROVIDER_CONFIG'
      );
    }

    if (!chain.includes(fallbackRaw)) chain.push(fallbackRaw);
  }

  return chain;
};

const ALLOWED_AUDIO_FORMATS = Object.keys(AUDIO_MIME_TYPES);

/**
 * Pilihan yang dipakai halaman /tools/sound-to-text, dilayani endpoint
 * GET /media/transcribe-options.

 * Daftarnya (bahasa, format, batas ukuran) datang dari backend supaya halaman
 * tidak pernah menawarkan sesuatu yang pasti ditolak — pola yang sama dengan
 * daftar voice text-to-sound.
 */
const getTranscribeOptions = () => {
  let chain = [];
  try {
    chain = getSpeechToTextChain();
  } catch {
    chain = [];
  }

  const provider = chain[0] || PROVIDER_ORDER[0];

  return {
    provider,
    defaultLanguage: getDefaultLanguage(),
    languages: [
      { value: 'id', label: 'Indonesia', hint: 'default' },
      { value: 'en', label: 'English', hint: 'Inggris' },
      { value: 'auto', label: 'Deteksi otomatis', hint: 'biar provider memilih' }
    ],
    acceptedFormats: ALLOWED_AUDIO_FORMATS,
    maxAudioBytes: MAX_AUDIO_BYTES,
    maxPromptLength: MAX_PROMPT_LENGTH
  };
};

const CONFIG_ERROR_CODES = ['MISSING_CREDENTIALS', 'INVALID_PROVIDER_CONFIG'];

/**
 * Transkripsi audio menjadi teks.
 *
 * @param {{buffer: Buffer, format: string, mimeType: string, language?: string, prompt?: string}} params
 * @returns {Promise<{text: string, provider: string, model: string, language: string|null, attempts: Array}>}
 */
const transcribeAudio = async ({ buffer, format, mimeType, language, prompt }) => {
  const chain = getSpeechToTextChain();
  const attempts = [];
  let configError = null;

  for (const name of chain) {
    const provider = PROVIDERS[name];

    if (!provider.isConfigured()) {
      attempts.push({ provider: name, reason: 'missing credentials' });
      continue;
    }

    // Provider yang tidak sanggup membaca format ini dilewati SEBELUM dipanggil:
    // mengirimnya hanya membuang kuota dan menambah waktu tunggu.
    if (format && !provider.supportedFormats.includes(format)) {
      attempts.push({ provider: name, reason: `format ${format} is not supported` });
      continue;
    }

    try {
      const result = await provider.transcribe({ buffer, format, mimeType, language, prompt });

      return { ...result, attempts };
    } catch (error) {
      attempts.push({ provider: name, reason: error.message });

      if (!configError && CONFIG_ERROR_CODES.includes(error.code)) configError = error;
    }
  }

  // Tidak ada provider yang benar-benar mencoba: pesannya menyebut variabel yang
  // harus diisi, karena itulah satu-satunya langkah yang bisa memperbaiki.
  if (chain.length === 0 || attempts.every((item) => item.reason === 'missing credentials')) {
    throw createError(
      'Sound-to-text belum aktif di server: tidak ada kredensial provider ' +
        'transkripsi yang terisi. Isi GROQ_API_KEY (https://console.groq.com/keys, ' +
        'gratis, 1.000 request/hari) atau GEMINI_API_KEY ' +
        '(https://aistudio.google.com/apikey) lalu restart backend.',
      'MISSING_CREDENTIALS'
    );
  }

  if (configError) throw configError;

  const summary = attempts.map((item) => `${item.provider}: ${item.reason}`).join('; ');
  throw createError(`All speech-to-text providers failed (${summary}).`, 'PROVIDER_UNAVAILABLE');
};

/** Ringkasan konfigurasi provider transkripsi, dipakai /health dan log boot. */
const getSpeechToTextStatus = () => {
  const status = {};
  for (const name of PROVIDER_ORDER) {
    status[name] = PROVIDERS[name].isConfigured() ? 'configured' : 'missing';
  }

  let chain = [];
  try {
    chain = getSpeechToTextChain();
  } catch {
    chain = [];
  }

  return {
    chain,
    status,
    ready: chain.some((name) => PROVIDERS[name].isConfigured()),
    defaultPrimary: resolveDefaultPrimary(),
    models: Object.fromEntries(PROVIDER_ORDER.map((name) => [name, PROVIDERS[name].getModel()]))
  };
};

module.exports = {
  transcribeAudio,
  getSpeechToTextChain,
  getSpeechToTextStatus,
  getTranscribeOptions,
  detectAudioFormat,
  mimeTypeFor,
  AUDIO_MIME_TYPES,
  ALLOWED_AUDIO_FORMATS,
  SUPPORTED_FORMATS_BY_PROVIDER,
  MAX_AUDIO_BYTES,
  MAX_PROMPT_LENGTH,
  DEFAULT_LANGUAGE,
  DEFAULT_GROQ_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_FALLBACK_PROVIDER,
  GROQ_BASE_URL,
  PROVIDERS,
  PROVIDER_ORDER
};
