/**
 * Provider Text-to-Sound (speech synthesis / TTS).
 *
 * Semua provider di sini dibungkus ke bentuk yang sama:
 *   generateSpeech({ text, voice, style, format })
 *     -> { buffer, format, mimeType, provider, model, duration }
 *
 * Provider dipilih lewat env:
 *   SOUND_PROVIDER = mimo | none        (default: mimo)
 *
 * MiMo (Xiaomi) TIDAK memakai endpoint `/v1/audio/speech` seperti OpenAI,
 * melainkan `/v1/chat/completions` yang kompatibel OpenAI: teks yang diucapkan
 * dikirim sebagai pesan `assistant`, dan audionya kembali sebagai base64 di
 * `choices[0].message.audio.data`. Karena bentuknya chat completion biasa, klien
 * OpenAI SDK yang sudah dipakai modul chat/gambar bisa dipakai ulang tanpa
 * dependency baru.
 *
 * Tiga model dalam seri MiMo-V2.5-TTS, dan bedanya menentukan isi pesan:
 *   mimo-v2.5-tts              : voice bawaan (audio.voice). Pesan `assistant`
 *                                berisi teks yang diucapkan.
 *   mimo-v2.5-tts-voicedesign  : suara dibuat dari deskripsi teks. Pesan `user`
 *                                berisi deskripsi suaranya, `assistant` berisi
 *                                teks yang diucapkan. `audio.voice` TIDAK
 *                                didukung model ini.
 *   mimo-v2.5-tts-voiceclone   : butuh contoh audio base64 sebagai `audio.voice`
 *                                — belum dipakai di sini.
 *
 * Jadi satu permintaan memilih modelnya dari ada/tidaknya `style`: kalau user
 * menuliskan deskripsi gaya suara, modelnya berpindah ke voicedesign.
 */

const { getClient } = require('./openai');

const MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1';
const DEFAULT_TTS_MODEL = 'mimo-v2.5-tts';
const DEFAULT_VOICEDESIGN_MODEL = 'mimo-v2.5-tts-voicedesign';

/**
 * Voice bawaan model `mimo-v2.5-tts` (dari dokumentasi Speech Synthesis).
 * Dipakai sebagai daftar nilai yang sah, dan dicerminkan di frontend.
 */
const BUILT_IN_VOICES = ['mimo_default', '冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean'];
const DEFAULT_VOICE = 'mimo_default';

// Format keluaran. `pcm` sengaja tidak ditawarkan: hasilnya audio mentah tanpa
// header, yang tidak bisa diputar langsung oleh <audio> di browser.
const ALLOWED_FORMATS = ['wav', 'mp3'];
const DEFAULT_FORMAT = 'wav';

const AUDIO_MIME_TYPES = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg'
};

// Batas teks yang diucapkan. Batas ini juga dipakai controller; teks yang jauh
// lebih panjang dari ini membuat satu permintaan memakan waktu sangat lama.
const MAX_TEXT_LENGTH = 2000;
const MAX_STYLE_LENGTH = 300;

const DEFAULT_TIMEOUT_MS = 120000;

// Nilai placeholder di .env.example tidak dianggap konfigurasi valid.
const PLACEHOLDER_VALUES = new Set(['your-mimo-api-key-here', 'mimo-your-key-here']);

const isSet = (value) => {
  if (!value) return false;
  const trimmed = String(value).trim();
  return trimmed !== '' && !PLACEHOLDER_VALUES.has(trimmed);
};

/**
 * Ambil token pertama dari sebuah secret.
 *
 * Nilai dari shell/.env bisa tercemar tanpa disadari — mis. saat kunci ditempel
 * ke ~/.bashrc dengan tanda kutip yang tidak ditutup, dua baris bergabung menjadi
 * `export VAR=...`. Nilai berisi baris baru seperti itu ditolak sebagai header
 * HTTP (dan hanya muncul sebagai "Connection error"), jadi dibersihkan di sini.
 * API key tidak pernah mengandung spasi, jadi token pertama aman.
 */
const sanitizeSecret = (value) => String(value || '').trim().split(/\s+/)[0];

const createError = (message, code) => {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
};

const getTimeoutMs = () =>
  Number(process.env.SOUND_REQUEST_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

const getBaseUrl = () => process.env.MIMO_BASE_URL || MIMO_BASE_URL;

const getTtsModel = () => process.env.MIMO_TTS_MODEL || DEFAULT_TTS_MODEL;

const getVoiceDesignModel = () =>
  process.env.MIMO_TTS_VOICEDESIGN_MODEL || DEFAULT_VOICEDESIGN_MODEL;

/**
 * `optimize_text_preview` meminta provider memoles teks yang diucapkan sebelum
 * disintesis. Dokumentasi resminya menyalakannya pada contoh voicedesign, tetapi
 * efeknya adalah teks user bisa berubah — dan pada alat "Text to Sound" hasil
 * audio yang tidak sesuai teks yang diketik itu membingungkan. Karena itu
 * defaultnya `false` (teks diucapkan apa adanya), dan bisa dinyalakan lewat env
 * bila memang diinginkan. Model ini juga satu-satunya yang mendukung parameter
 * tersebut.
 */
const isOptimizeTextEnabled = () =>
  String(process.env.MIMO_TTS_OPTIMIZE_TEXT || '').trim().toLowerCase() === 'true';

/**
 * Durasi audio WAV dari headernya, dalam detik.
 *
 * Hanya WAV yang bisa dibaca seperti ini (MP3 tidak menyimpan durasi di header
 * yang bisa dipercaya tanpa membaca seluruh frame). Mengembalikan null kalau
 * headernya tidak dikenali, supaya UI cukup tidak menampilkan durasi.
 */
const measureWavDuration = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  // Telusuri chunk sampai menemukan `fmt ` (untuk byteRate) dan `data` (ukurannya).
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ' && body + 12 <= buffer.length) {
      byteRate = buffer.readUInt32LE(body + 8);
    } else if (id === 'data') {
      dataSize = Math.min(size, buffer.length - body);
    }

    // Chunk berukuran ganjil diberi satu byte padding.
    const next = body + size + (size % 2);
    if (next <= offset) break;
    offset = next;
  }

  if (!byteRate || !dataSize) return null;

  const seconds = dataSize / byteRate;
  return Number.isFinite(seconds) && seconds > 0 ? Number(seconds.toFixed(2)) : null;
};

/**
 * Susun pesan sesuai model yang dipakai.
 *
 * Model voicedesign memakai pesan `user` sebagai deskripsi suara, sedangkan
 * model voice bawaan tidak menerimanya sama sekali.
 */
const buildMessages = ({ text, style, voiceDesign }) => {
  if (voiceDesign) {
    return [
      { role: 'user', content: style },
      { role: 'assistant', content: text }
    ];
  }

  // `voice` dikirim lewat `audio`, bukan lewat pesan; pesan hanya berisi teksnya.
  return [{ role: 'assistant', content: text }];
};

/**
 * Provider MiMo (Xiaomi) — seri MiMo-V2.5-TTS lewat endpoint chat completion.
 */
const mimo = {
  name: 'mimo',
  label: 'Xiaomi MiMo (MiMo-V2.5-TTS)',
  envVars: ['MIMO_API_KEY'],

  isConfigured: () => isSet(process.env.MIMO_API_KEY),

  getModel: () => getTtsModel(),

  async generate({ text, voice, style, format }) {
    const voiceDesign = Boolean(style);
    const model = voiceDesign ? getVoiceDesignModel() : getTtsModel();
    const audioFormat = format || DEFAULT_FORMAT;

    const audio = {
      format: audioFormat,
      // `voice` hanya dikenal model voice bawaan; voicedesign menolaknya.
      ...(voiceDesign ? {} : { voice: voice || DEFAULT_VOICE }),
      ...(voiceDesign && isOptimizeTextEnabled() ? { optimize_text_preview: true } : {})
    };

    const client = getClient({
      apiKey: sanitizeSecret(process.env.MIMO_API_KEY),
      baseURL: getBaseUrl(),
      timeout: getTimeoutMs(),
      // Retry bawaan SDK digandakan di sini menjadi dua request berbayar untuk
      // kegagalan yang sama (mis. kredensial ditolak atau kuota habis), jadi
      // dimatikan dan biarkan user yang memutuskan mencoba lagi.
      maxRetries: 0
    });

    let completion;

    try {
      completion = await client.chat.completions.create({
        model,
        messages: buildMessages({ text, style, voiceDesign }),
        audio,
        // Audio tidak dipakai lewat streaming: hasilnya perlu disimpan utuh
        // sebagai satu berkas, sedangkan streaming hanya menambah kompleksitas.
        stream: false
      });
    } catch (error) {
      // Kredensial yang ditolak (401/403) dibedakan dari kegagalan sesaat: yang
      // satu hanya bisa diperbaiki admin, yang satu lagi cukup dicoba ulang.
      // Tanpa pembedaan ini, user disuruh menekan tombol yang sama berulang kali.
      const code =
        error.status === 401 || error.status === 403
          ? 'INVALID_PROVIDER_CONFIG'
          : error.status && error.status >= 500
            ? 'PROVIDER_UNAVAILABLE'
            : 'PROVIDER_ERROR';

      throw createError(
        `MiMo TTS error: ${error.message}${error.status ? ` (HTTP ${error.status})` : ''}`,
        code
      );
    }

    const data = completion?.choices?.[0]?.message?.audio?.data;

    // Balasan tanpa audio berarti permintaannya "berhasil" tetapi tidak ada yang
    // bisa diputar — lebih baik gagal jelas daripada menyimpan berkas kosong.
    if (!data) {
      throw createError(
        'MiMo tidak mengembalikan audio (balasan tidak memuat choices[0].message.audio.data).',
        'PROVIDER_ERROR'
      );
    }

    const buffer = Buffer.from(data, 'base64');

    if (buffer.length === 0) {
      throw createError('MiMo mengembalikan audio kosong.', 'PROVIDER_ERROR');
    }

    return {
      buffer,
      format: audioFormat,
      mimeType: AUDIO_MIME_TYPES[audioFormat] || 'application/octet-stream',
      provider: 'mimo',
      model,
      duration: audioFormat === 'wav' ? measureWavDuration(buffer) : null
    };
  }
};

const PROVIDERS = { mimo };
const PROVIDER_ORDER = ['mimo'];

/**
 * Urutan provider yang akan dicoba untuk satu permintaan suara.
 *
 * Hanya ada satu provider, jadi `SOUND_PROVIDER=none` adalah satu-satunya nilai
 * yang mematikan fiturnya — dipakai test dan operator yang ingin menonaktifkan
 * fitur ini tanpa menghapus kodenya.
 *
 * @returns {string[]}
 * @throws {Error} jika nama provider di env tidak dikenal
 */
const getSpeechChain = () => {
  const explicit = String(process.env.SOUND_PROVIDER || '').trim().toLowerCase();

  if (explicit === 'none') return [];

  if (explicit && !PROVIDERS[explicit]) {
    throw createError(
      `Unknown SOUND_PROVIDER "${explicit}". Available: ${PROVIDER_ORDER.join(', ')}, none.`,
      'INVALID_PROVIDER_CONFIG'
    );
  }

  return [explicit || PROVIDER_ORDER[0]];
};

/**
 * Sintesis teks menjadi audio.
 *
 * @param {{text: string, voice?: string, style?: string, format?: string}} params
 * @returns {Promise<{buffer: Buffer, format: string, mimeType: string, provider: string, model: string, duration: number|null}>}
 */
const CONFIG_ERROR_CODES = ['MISSING_CREDENTIALS', 'INVALID_PROVIDER_CONFIG'];

const generateSpeech = async ({ text, voice, style, format }) => {
  const chain = getSpeechChain();
  const attempts = [];
  let configError = null;

  for (const name of chain) {
    const provider = PROVIDERS[name];

    if (!provider.isConfigured()) {
      attempts.push({ provider: name, reason: 'missing credentials' });
      continue;
    }

    try {
      const result = await provider.generate({ text, voice, style, format });
      return { ...result, attempts };
    } catch (error) {
      attempts.push({ provider: name, reason: error.message });

      // Kegagalan yang berasal dari konfigurasi server diingat dan diutamakan:
      // menyamarkannya jadi "coba lagi" membuat user menekan tombol yang sama
      // berulang kali untuk masalah yang hanya bisa diperbaiki admin.
      if (!configError && CONFIG_ERROR_CODES.includes(error.code)) configError = error;
    }
  }

  // Tidak ada provider aktif: pesannya menyebut variabel yang harus diisi,
  // karena inilah satu-satunya langkah yang bisa memperbaiki keadaan.
  if (chain.length === 0 || attempts.every((item) => item.reason === 'missing credentials')) {
    throw createError(
      'Text-to-sound belum dikonfigurasi di server. Isi MIMO_API_KEY di backend/.env ' +
        '(kunci dari platform MiMo: https://mimo.mi.com).',
      'MISSING_CREDENTIALS'
    );
  }

  if (configError) throw configError;

  const summary = attempts.map((item) => `${item.provider}: ${item.reason}`).join('; ');
  throw createError(`All sound providers failed (${summary}).`, 'PROVIDER_UNAVAILABLE');
};

/**
 * Ringkasan konfigurasi provider suara, dipakai endpoint /health dan log boot.
 */
const getSpeechProviderStatus = () => {
  const status = {};
  for (const name of PROVIDER_ORDER) {
    status[name] = PROVIDERS[name].isConfigured() ? 'configured' : 'missing';
  }

  let chain = [];
  try {
    chain = getSpeechChain();
  } catch {
    chain = [];
  }

  return {
    chain,
    status,
    ready: chain.some((name) => PROVIDERS[name].isConfigured()),
    defaultPrimary: PROVIDER_ORDER[0],
    // Diteruskan ke frontend lewat /health (non-production) supaya halaman bisa
    // menyesuaikan diri tanpa perlu tahu detail provider.
    voices: BUILT_IN_VOICES,
    formats: ALLOWED_FORMATS
  };
};

module.exports = {
  generateSpeech,
  getSpeechChain,
  getSpeechProviderStatus,
  measureWavDuration,
  BUILT_IN_VOICES,
  ALLOWED_FORMATS,
  DEFAULT_FORMAT,
  DEFAULT_VOICE,
  DEFAULT_TTS_MODEL,
  DEFAULT_VOICEDESIGN_MODEL,
  MAX_TEXT_LENGTH,
  MAX_STYLE_LENGTH,
  MIMO_BASE_URL,
  PROVIDERS,
  PROVIDER_ORDER
};
