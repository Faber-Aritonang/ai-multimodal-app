/**
 * Provider Text-to-Sound (speech synthesis / TTS).
 *
 * Semua provider di sini dibungkus ke bentuk yang sama:
 *   generateSpeech({ text, voice, style, format })
 *     -> { buffer, format, mimeType, provider, model, duration }
 *
 * Provider dipilih lewat env:
 *   SOUND_PROVIDER          = gemini | edge | elevenlabs | openai | none
 *   SOUND_FALLBACK_PROVIDER = gemini | edge | elevenlabs | openai | none
 *                             (default: edge)
 *
 * Default tanpa diisi: provider pertama yang kredensialnya tersedia, urut
 * Gemini -> ElevenLabs -> OpenAI -> Edge. Teks Indonesia diarahkan ke Gemini
 * (kuota gratis tanpa billing, logat bisa diarahkan lewat prompt) dan ke Edge
 * (suara neural Indonesia, tanpa kredensial sama sekali — lihat catatan provider
 * `edge` di bawah).
 *
 * Cadangan defaultnya Edge, dan itu disengaja: cadangan yang membutuhkan kunci
 * akan gagal persis pada saat ia paling dibutuhkan — ketika admin belum sempat
 * mengisi kunci itu. Jadi begitu kuota gratis Gemini habis (HTTP 429),
 * permintaan yang sama langsung dicoba ke Edge dan audionya tetap berbahasa
 * Indonesia, bukan berlogat Mandarin dan bukan pula gagal.
 *
 * Empat provider di sini semuanya punya suara Indonesia. OpenAI tetap tersedia,
 * tetapi tidak dipakai otomatis karena berbayar — ia melayani hanya bila diminta
 * lewat `SOUND_PROVIDER=openai`.
 *
 * Endpoint tiap provider berbeda dan tidak bisa saling ditukar: Gemini memakai
 * `/v1beta/interactions` dan mengembalikan PCM mentah, ElevenLabs mengembalikan
 * berkas audio langsung dari `/v1/text-to-speech/{voice_id}`, OpenAI memakai
 * `/v1/audio/speech`, dan Edge memakai WebSocket Read Aloud milik Microsoft yang
 * mengirim MP3 dalam potongan (lihat provider `edge`).
 * Daftar voice yang sah untuk tiap provider diteruskan ke frontend lewat
 * getSoundVoiceOptions(), sehingga dropdown di UI selalu cocok dengan provider
 * yang benar-benar melayani permintaan.
 *
 * Provider MiMo (Xiaomi) pernah ada di sini dan sudah DIHAPUS: dokumentasi
 * resminya menyatakan hanya Mandarin dan Inggris yang didukung, sedangkan
 * halaman /tools/text-to-sound selalu mengucapkan teks Indonesia. Selama ia ada
 * di daftar, mengisi MIMO_API_KEY sudah cukup untuk memindahkan seluruh halaman
 * ke suara Mandarin tanpa ada yang memintanya — dan tidak ada nilai yang hilang
 * dengan menghapusnya, karena Gemini/ElevenLabs/Edge sama-sama bersuara
 * Indonesia dan gratis. Jangan tambahkan lagi tanpa alasan yang lebih kuat.
 */

const crypto = require('crypto');
const WebSocketClient = require('ws');
const { getClient } = require('./openai');

// OpenAI Text-to-Speech. `gpt-4o-mini-tts` menerima `instructions` (deskripsi
// gaya suara), sedangkan `tts-1`/`tts-1-hd` tidak — jadi gaya suara hanya
// berpengaruh pada model pertama.
const DEFAULT_OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';

// Google Gemini TTS (Google AI Studio). Kuota gratisnya tidak butuh billing,
// dan kuncinya sama dengan provider chat Gemini yang sudah dipakai aplikasi ini.
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
// Gemini TTS mengembalikan PCM mentah 24 kHz, mono, 16-bit — tanpa header.
const GEMINI_PCM = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };

// ElevenLabs. Free tier-nya 10.000 karakter/bulan; model multilingual yang
// mendukung Indonesia. Free tier tidak menyediakan voice library, hanya voice
// bawaan akun "si pemilik kunci", jadi ID-nya dibaca dari akun lewat /v1/voices
// (lihat fetchElevenLabsVoices) alih-alih dipercaya dari daftar statis.
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2';
// Rachel — ID voice bawaan yang paling lama dipakai ElevenLabs. Dipakai hanya
// sebagai pilihan terakhir: akun yang dibuat setelah ElevenLabs mengganti daftar
// default (Feb 2026) bisa saja tidak memilikinya, dan saat itu terjadi voice
// pertama yang benar-benar ada di akun itu yang dipakai.
const DEFAULT_ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const ELEVENLABS_PCM = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };
const ELEVENLABS_VOICES_TTL_MS = 60 * 60 * 1000;

// Microsoft Edge TTS — endpoint "Read Aloud" yang dipakai browser Edge. Ini
// endpoint yang TIDAK didokumentasikan sebagai API publik: nilai-nilai di bawah
// disalin dari implementasi rujukan (rany2/edge-tts) dan sudah diuji langsung
// dari proyek ini. Konsekuensinya jujur: Microsoft bisa mengubahnya kapan saja
// tanpa pemberitahuan, dan request-nya (walau gratis) secara harfiah memakai
// layanan yang ditujukan untuk fitur "Read Aloud" di browser. Karena itu
// provider ini ditaruh paling belakang di urutan default, dan selalu bisa
// dimatikan lewat SOUND_PROVIDER/`none`.
const EDGE_WSS_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
// Token klien yang sama dipakai semua klien Read Aloud publik; namanya
// "trusted client token", bukan rahasia akun siapa pun.
const EDGE_TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
// Versi Chromium yang dilaporkan ke server. Dipakai juga untuk menyusun
// Sec-MS-GEC-Version, dan itulah sebabnya nilainya ditulis lengkap.
const EDGE_CHROMIUM_VERSION = '143.0.3650.75';
// Edge hanya menerima beberapa format keluaran. WAV/PCM mentah TIDAK termasuk
// (sudah diuji: permintaannya tidak dijawab sama sekali), jadi satu-satunya
// format yang tersedia adalah MP3 — lihat SUPPORTED_FORMATS_BY_PROVIDER.edge.
const EDGE_MP3_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const EDGE_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const EDGE_MODEL = 'edge-tts-readaloud';
// Epoch "Windows file time" (1601-01-01) dalam detik, dasar token Sec-MS-GEC.
const WIN_EPOCH_SECONDS = 11644473600;

/**
 * Voice yang sah PER PROVIDER, lengkap dengan label untuk dropdown UI.
 *
 * Tiap provider memakai nama voice yang sama sekali berbeda (Gemini: `Kore`,
 * ElevenLabs: UUID voice, OpenAI: `alloy`), jadi satu daftar
 * gabungan membuat user memilih nilai yang pasti ditolak provider yang aktif.
 * Daftar ini satu-satunya sumber kebenaran — frontend mengambilnya lewat
 * GET /media/sound-voices, jadi tidak ada lagi dua daftar yang harus dijaga
 * tetap sama.
 *
 * "Normal" dan "ceria" bukan penanda resmi dari provider mana pun; itu ringkasan
 * karakter suara supaya user bisa menebak sebelum mendengarkan.
 */
const VOICES_BY_PROVIDER = {
  gemini: [
    { value: 'Kore', label: 'Kore', hint: 'netral' },
    { value: 'Puck', label: 'Puck', hint: 'ceria' },
    { value: 'Charon', label: 'Charon', hint: 'pria' },
    { value: 'Orus', label: 'Orus', hint: 'pria' },
    { value: 'Fenrir', label: 'Fenrir', hint: 'pria' },
    { value: 'Aoede', label: 'Aoede', hint: 'wanita' },
    { value: 'Leda', label: 'Leda', hint: 'wanita' },
    { value: 'Zephyr', label: 'Zephyr', hint: 'wanita' }
  ],
  // Nilai di sini adalah ID voice ElevenLabs (bukan nama). Daftar statis ini
  // hanya untuk dropdown; saat sintesis, provider memakai voice yang benar-benar
  // ada di akun pemilik kunci (lihat resolveElevenLabsVoiceId).
  elevenlabs: [
    { value: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', hint: 'wanita' },
    { value: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella', hint: 'wanita' },
    { value: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli', hint: 'wanita' },
    { value: 'pNInz6obpgDQGcFmaJgB', label: 'Adam', hint: 'pria' },
    { value: 'ErXwobaYiN019PkySvjV', label: 'Antoni', hint: 'pria' },
    { value: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh', hint: 'pria' }
  ],
  openai: [
    { value: 'alloy', label: 'Alloy', hint: 'netral' },
    { value: 'ash', label: 'Ash', hint: 'male' },
    { value: 'ballad', label: 'Ballad', hint: 'male' },
    { value: 'coral', label: 'Coral', hint: 'female' },
    { value: 'echo', label: 'Echo', hint: 'male' },
    { value: 'nova', label: 'Nova', hint: 'female' },
    { value: 'onyx', label: 'Onyx', hint: 'male' },
    { value: 'sage', label: 'Sage', hint: 'female' },
    { value: 'shimmer', label: 'Shimmer', hint: 'female' }
  ],
  // Edge: dua suara neural Indonesia bawaan Microsoft (id-ID). Provider ini
  // tidak menawarkan suara bahasa lain di sini — suara itu sudah ada di
  // provider lain, sedangkan yang membuat Edge berguna justru Indonesianya.
  edge: [
    { value: 'id-ID-GadisNeural', label: 'Gadis', hint: 'wanita ID' },
    { value: 'id-ID-ArdiNeural', label: 'Ardi', hint: 'pria ID' }
  ]
};

// Voice yang dipakai kalau user tidak memilih (atau memilih voice milik
// provider lain, mis. saat provider cadangan yang akhirnya melayani).
const DEFAULT_VOICE_BY_PROVIDER = {
  gemini: 'Kore',
  edge: 'id-ID-GadisNeural',
  elevenlabs: DEFAULT_ELEVENLABS_VOICE_ID,
  openai: 'alloy'
};

/**
 * Format keluaran yang sanggup dihasilkan tiap provider.
 *
 * Gemini TTS mengembalikan PCM, dan proyek ini tidak punya encoder MP3 — jadi
 * yang bisa ditawarkan hanya WAV (PCM dibungkus header). ElevenLabs bisa MP3
 * langsung, dan PCM untuk permintaan WAV. OpenAI menerima `wav`/`mp3` langsung
 * dari API-nya.
 *
 * Dipakai dua tempat: rantai provider melewati provider yang tidak sanggup
 * memenuhi format yang diminta, dan frontend hanya menawarkan format yang valid
 * untuk provider yang aktif.
 */
const SUPPORTED_FORMATS_BY_PROVIDER = {
  gemini: ['wav'],
  edge: ['mp3'],
  elevenlabs: ['wav', 'mp3'],
  openai: ['wav', 'mp3']
};

/**
 * Format yang dipakai bila pemanggil TIDAK menentukan format.
 *
 * Sebelumnya satu nilai global ('wav') dipakai untuk semua provider, dan itu
 * membuat provider yang tidak sanggup WAV (Edge, hanya MP3) terlewat begitu saja
 * oleh rantai provider — permintaan yang tidak menyebut format berakhir gagal
 * walau providernya sehat. Sekarang tiap provider menyebut kemampuannya sendiri.
 */
const DEFAULT_FORMAT_BY_PROVIDER = {
  gemini: 'wav',
  edge: 'mp3',
  elevenlabs: 'wav',
  openai: 'wav'
};

const defaultFormatFor = (providerName) =>
  DEFAULT_FORMAT_BY_PROVIDER[providerName] || DEFAULT_FORMAT;

const supportedFormats = (providerName) =>
  SUPPORTED_FORMATS_BY_PROVIDER[providerName] || ALLOWED_FORMATS;

const voiceValues = (providerName) =>
  (VOICES_BY_PROVIDER[providerName] || []).map((item) => item.value);

/** Voice provider milik provider lain → pakai voice bawaan provider itu. */
const resolveVoice = (providerName, voice) => {
  const values = voiceValues(providerName);
  return values.includes(voice) ? voice : DEFAULT_VOICE_BY_PROVIDER[providerName];
};

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
const PLACEHOLDER_VALUES = new Set(['sk-your-openai-key-here']);

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

const getOpenAiTtsModel = () =>
  process.env.OPENAI_TTS_MODEL || DEFAULT_OPENAI_TTS_MODEL;

const getGeminiTtsModel = () =>
  process.env.GEMINI_TTS_MODEL || DEFAULT_GEMINI_TTS_MODEL;

const getElevenLabsModel = () =>
  process.env.ELEVENLABS_MODEL || DEFAULT_ELEVENLABS_MODEL;

const getEdgeUrl = () => process.env.EDGE_TTS_WSS_URL || EDGE_WSS_URL;

/**
 * Hanya `gpt-4o-mini-tts` yang menerima `instructions`. Mengirimkannya ke
 * `tts-1` membuat permintaan ditolak, jadi parameter itu tidak ikut dikirim.
 */
const supportsTtsInstructions = (model) => String(model).startsWith('gpt-4o');

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
 * Bungkus PCM mentah menjadi WAV.
 *
 * Gemini TTS (dan permintaan `pcm_*` ElevenLabs) mengembalikan audio tanpa
 * header apa pun. `<audio>` di browser tidak bisa memutarnya sebelum ada header
 * RIFF, jadi headernya disusun di sini — jauh lebih murah daripada menambah
 * dependency encoder audio ke proyek ini.
 */
const wrapPcmAsWav = (
  pcm,
  { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {}
) => {
  if (!Buffer.isBuffer(pcm) || pcm.length === 0) {
    throw createError('Provider mengembalikan audio kosong.', 'PROVIDER_ERROR');
  }

  const header = Buffer.alloc(44);
  const blockAlign = channels * (bitsPerSample / 8);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // ukuran chunk fmt
  header.writeUInt16LE(1, 20); // PCM tanpa kompresi
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28); // byteRate
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
};

/**
 * Terjemahkan kegagalan HTTP provider menjadi kode galat yang bisa ditindaklanjuti.
 *
 * `429` sengaja masuk `PROVIDER_UNAVAILABLE` (bukan galat konfigurasi) supaya
 * rantai provider terus mencoba cadangan — inilah jalur yang dipakai saat kuota
 * gratis sebuah provider habis.
 */
const errorCodeFromStatus = (status) => {
  if (status === 401 || status === 403) return 'INVALID_PROVIDER_CONFIG';
  if (status === 429 || (status && status >= 500)) return 'PROVIDER_UNAVAILABLE';
  return 'PROVIDER_ERROR';
};

/** Ambil pesan galat dari balasan JSON provider, kalau ada. */
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

/**
 * OpenAI Text-to-Speech — `/v1/audio/speech` dengan klien OpenAI SDK yang sudah
 * dipakai modul chat/gambar, jadi tidak ada dependency baru.
 *
 * Provider ini mengembalikan berkas audio mentah (bukan base64 di dalam JSON),
 * jadi body-nya dibaca lewat `.arrayBuffer()`.
 */
const openai = {
  name: 'openai',
  label: 'OpenAI Text-to-Speech (gpt-4o-mini-tts)',
  envVars: ['OPENAI_API_KEY'],

  isConfigured: () => isSet(process.env.OPENAI_API_KEY),

  getModel: () => getOpenAiTtsModel(),

  async generate({ text, voice, style, format }) {
    const model = getOpenAiTtsModel();
    const audioFormat = format || DEFAULT_FORMAT;
    const usedVoice = resolveVoice('openai', voice);

    // Gaya suara (deskripsi bebas) hanya dikenal `gpt-4o-mini-tts`. Pada model
    // tts-1* parameter itu tidak ada, jadi teksnya diucapkan apa adanya.
    const pakaiGaya = Boolean(style) && supportsTtsInstructions(model);

    if (style && !pakaiGaya) {
      console.warn(
        `Voice style diabaikan: model ${model} tidak mendukung parameter instructions. ` +
          'Pakai OPENAI_TTS_MODEL=gpt-4o-mini-tts untuk memakainya.'
      );
    }

    const client = getClient({
      apiKey: sanitizeSecret(process.env.OPENAI_API_KEY),
      timeout: getTimeoutMs(),
      // Retry bawaan SDK digandakan menjadi dua request berbayar untuk
      // kegagalan yang sama (mis. kredensial ditolak atau kuota habis), jadi
      // dimatikan dan biarkan user yang memutuskan mencoba lagi.
      maxRetries: 0
    });

    let response;

    try {
      response = await client.audio.speech.create({
        model,
        voice: usedVoice,
        input: text,
        response_format: audioFormat,
        ...(pakaiGaya ? { instructions: style } : {})
      });
    } catch (error) {
      const code =
        error.status === 401 || error.status === 403
          ? 'INVALID_PROVIDER_CONFIG'
          : error.status && error.status >= 500
            ? 'PROVIDER_UNAVAILABLE'
            : 'PROVIDER_ERROR';

      throw createError(
        `OpenAI TTS error: ${error.message}${error.status ? ` (HTTP ${error.status})` : ''}`,
        code
      );
    }

    // Balasan berupa body audio mentah — `.arrayBuffer()` adalah satu-satunya
    // cara membacanya di SDK ini.
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length === 0) {
      throw createError('OpenAI mengembalikan audio kosong.', 'PROVIDER_ERROR');
    }

    return {
      buffer,
      format: audioFormat,
      mimeType: AUDIO_MIME_TYPES[audioFormat] || 'application/octet-stream',
      provider: 'openai',
      model,
      voice: usedVoice,
      duration: audioFormat === 'wav' ? measureWavDuration(buffer) : null
    };
  }
};

/**
 * Google Gemini TTS (Google AI Studio).
 *
 * Provider utama untuk teks Indonesia: kuota gratisnya tidak memerlukan billing,
 * kuncinya sama dengan provider chat Gemini (`GEMINI_API_KEY`), dan suaranya
 * mendukung 70+ bahasa — termasuk Indonesia, dengan logat yang bisa diarahkan
 * lewat bahasa alami. Model yang dipakai masih berstatus preview.
 *
 * Bentuk API-nya paling berbeda di antara provider di sini: hasilnya PCM mentah
 * ber-base64, jadi harus dibungkus WAV sebelum bisa diputar browser.
 */
const gemini = {
  name: 'gemini',
  label: 'Google Gemini TTS (Google AI Studio)',
  envVars: ['GEMINI_API_KEY'],
  supportedFormats: SUPPORTED_FORMATS_BY_PROVIDER.gemini,

  isConfigured: () => isSet(process.env.GEMINI_API_KEY),

  getModel: () => getGeminiTtsModel(),

  async generate({ text, voice, style }) {
    const model = getGeminiTtsModel();
    const usedVoice = resolveVoice('gemini', voice);

    // Gemini TTS tidak punya parameter arahan terpisah seperti `instructions`
    // OpenAI: gaya dan logat diarahkan lewat bahasa alami di dalam input
    // (dokumentasi resminya bercontoh "Say cheerfully: Have a wonderful day!").
    // Tanpa deskripsi gaya, teks dikirim apa adanya supaya yang diucapkan persis
    // teks yang diketik user.
    const input = style ? `${style}:\n${text}` : text;

    let response;

    try {
      response = await requestGeminiAudio({
        model,
        input,
        voice: usedVoice,
        apiKey: sanitizeSecret(process.env.GEMINI_API_KEY)
      });
    } catch (error) {
      throw createError(`Gemini TTS error: ${error.message}`, 'PROVIDER_UNAVAILABLE');
    }

    if (!response.ok) {
      const detail = await readErrorMessage(response);

      throw createError(
        `Gemini TTS error: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
        errorCodeFromStatus(response.status)
      );
    }

    const payload = await response.json();
    const base64 = extractGeminiAudioBase64(payload);

    // Balasan tanpa audio berarti permintaannya "berhasil" tetapi tidak ada yang
    // bisa diputar. Nama kunci yang benar-benar diterima dicetak supaya bentuk
    // balasan baru bisa ditambahkan tanpa menebak.
    if (!base64) {
      throw createError(
        'Gemini TTS tidak mengembalikan audio. Kunci yang diterima: ' +
          `${Object.keys(payload || {}).join(', ') || '(balasan kosong)'}.`,
        'PROVIDER_ERROR'
      );
    }

    const buffer = wrapPcmAsWav(Buffer.from(base64, 'base64'), GEMINI_PCM);

    return {
      buffer,
      // PCM yang dikembalikan Gemini selalu dibungkus menjadi WAV; MP3 bukan
      // format yang sanggup dihasilkan provider ini (lihat supportedFormats).
      format: 'wav',
      mimeType: AUDIO_MIME_TYPES.wav,
      provider: 'gemini',
      model,
      voice: usedVoice,
      duration: measureWavDuration(buffer)
    };
  }
};

/**
 * Kirim permintaan sintesis ke Gemini dan kembalikan balasan mentahnya.
 *
 * Dua bentuk API dicoba: `/interactions` (bentuk yang dipakai dokumentasi saat
 * ini) dan `models/{model}:generateContent` (bentuk lama, yang sampai sekarang
 * masih melayani permintaan audio lewat `responseModalities: ['AUDIO']`).
 * Gemini TTS masih berstatus preview, dan preview bisa berganti bentuk kapan
 * saja; bertahan pada satu bentuk berarti fitur ini mati total begitu itu
 * terjadi. Bentuk lama HANYA dicoba saat yang baru membalas 404 — bukan untuk
 * semua kegagalan, supaya galat kredensial dan kuota tidak tersamarkan.
 */
const requestGeminiAudio = async ({ model, input, voice, apiKey }) => {
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  // Satu signal dipakai kedua percobaan: batas waktunya adalah batas waktu
  // permintaan suara, bukan batas per endpoint.
  const signal = AbortSignal.timeout(getTimeoutMs());
  const kirim = (url, body) =>
    fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });

  const terbaru = await kirim(`${GEMINI_BASE_URL}/interactions`, {
    model,
    input,
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] }
  });

  if (terbaru.status !== 404) return terbaru;

  console.warn(
    'Gemini TTS: /interactions membalas 404, mencoba bentuk lama models/{model}:generateContent.'
  );

  return kirim(
    `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
    {
      contents: [{ role: 'user', parts: [{ text: input }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
      }
    }
  );
};

/**
 * Ambil audio ber-base64 dari balasan Gemini TTS.
 *
 * Bentuk balasannya berbeda antar versi API: endpoint `/interactions`
 * mengembalikan `output_audio.data`, sedangkan bentuk lama `generateContent`
 * menaruh base64-nya di `candidates[0].content.parts[].inlineData.data`. Keduanya
 * dibaca supaya model/endpoint yang berubah tidak langsung mematikan fiturnya.
 */
const extractGeminiAudioBase64 = (payload) => {
  const langsung = payload?.output_audio?.data || payload?.outputAudio?.data;
  if (typeof langsung === 'string' && langsung) return langsung;

  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const inlineData = parts
    .map((part) => part?.inlineData || part?.inline_data)
    .find((item) => typeof item?.data === 'string' && item.data);

  return inlineData?.data || null;
};

// Cache daftar voice ElevenLabs per kunci. Isinya jarang berubah, dan tanpa
// cache setiap permintaan suara menambah satu request HTTP hanya untuk memeriksa
// ID voice.
let elevenLabsVoicesCache = null;

/**
 * Daftar voice yang benar-benar tersedia di akun pemilik kunci.
 *
 * ElevenLabs mengganti daftar voice bawaan per akun (perubahan Februari 2026),
 * dan free tier tidak boleh memakai voice library. Karena itu ID voice TIDAK
 * bisa dipercaya dari daftar statis: satu-satunya sumber yang benar adalah akun
 * itu sendiri. Kegagalannya tidak fatal — pemanggilnya tetap mencoba ID yang
 * diminta (lihat resolveElevenLabsVoiceId).
 */
const fetchElevenLabsVoices = async (apiKey) => {
  const sekarang = Date.now();

  if (
    elevenLabsVoicesCache &&
    elevenLabsVoicesCache.apiKey === apiKey &&
    sekarang - elevenLabsVoicesCache.at < ELEVENLABS_VOICES_TTL_MS
  ) {
    return elevenLabsVoicesCache.voices;
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(getTimeoutMs())
  });

  if (!response.ok) {
    const detail = await readErrorMessage(response);

    throw createError(
      `ElevenLabs voices error: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
      errorCodeFromStatus(response.status)
    );
  }

  const payload = await response.json();
  const voices = (payload?.voices || [])
    .map((voice) => ({ voiceId: voice?.voice_id, name: voice?.name || voice?.voice_id }))
    .filter((voice) => voice.voiceId);

  elevenLabsVoicesCache = { apiKey, at: sekarang, voices };
  return voices;
};

/**
 * ID voice yang akan dipakai satu permintaan.
 *
 * Urutan pilihannya: voice yang diminta user (bila ada di akun itu) →
 * `ELEVENLABS_VOICE_ID` → ID bawaan → voice pertama yang tersedia di akun.
 * Setiap penggantian dicatat ke log: suara yang berbeda dari yang dipilih user
 * harus bisa ditelusuri, bukan terjadi diam-diam.
 */
/**
 * Buang cache daftar voice ElevenLabs.
 *
 * Dipakai test supaya urutan test tidak saling memengaruhi, dan bisa dipakai
 * operator setelah mengganti kunci di .env tanpa me-restart proses.
 */
const resetElevenLabsVoiceCache = () => {
  elevenLabsVoicesCache = null;
};

const resolveElevenLabsVoiceId = async (apiKey, requested) => {
  const fallback = requested || process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID;

  let voices;

  try {
    voices = await fetchElevenLabsVoices(apiKey);
  } catch (error) {
    console.warn(
      `ElevenLabs: daftar voice tidak terbaca (${error.message}); mencoba ${fallback} langsung.`
    );
    return fallback;
  }

  if (!voices.length) return fallback;

  const ids = new Set(voices.map((voice) => voice.voiceId));

  if (requested && ids.has(requested)) return requested;

  const dikonfigurasi = process.env.ELEVENLABS_VOICE_ID;
  if (dikonfigurasi && ids.has(dikonfigurasi)) return dikonfigurasi;

  if (ids.has(DEFAULT_ELEVENLABS_VOICE_ID)) {
    if (requested) {
      console.warn(
        `ElevenLabs: voice ${requested} tidak ada di akun ini; memakai voice bawaan ${DEFAULT_ELEVENLABS_VOICE_ID}.`
      );
    }
    return DEFAULT_ELEVENLABS_VOICE_ID;
  }

  const pengganti = voices[0];

  console.warn(
    `ElevenLabs: voice ${fallback} tidak ada di akun ini; memakai "${pengganti.name}". ` +
      'Isi ELEVENLABS_VOICE_ID untuk memilih voice lain (daftarnya: GET /v1/voices).'
  );

  return pengganti.voiceId;
};

/**
 * ElevenLabs — model `eleven_multilingual_v2` (mendukung Bahasa Indonesia).
 *
 * Dipakai sebagai CADANGAN gratis: free tier-nya 10.000 karakter/bulan, cukup
 * untuk menerima limpahan saat kuota gratis Gemini habis (HTTP 429).
 */
const elevenlabs = {
  name: 'elevenlabs',
  label: 'ElevenLabs (multilingual v2)',
  envVars: ['ELEVENLABS_API_KEY'],
  supportedFormats: SUPPORTED_FORMATS_BY_PROVIDER.elevenlabs,

  isConfigured: () => isSet(process.env.ELEVENLABS_API_KEY),

  getModel: () => getElevenLabsModel(),

  async generate({ text, voice, style, format }) {
    const model = getElevenLabsModel();
    const audioFormat = format || DEFAULT_FORMAT;
    const apiKey = sanitizeSecret(process.env.ELEVENLABS_API_KEY);
    const voiceId = await resolveElevenLabsVoiceId(apiKey, voice);

    // ElevenLabs tidak punya arahan gaya bebas seperti `instructions` (OpenAI)
    // atau bahasa alami di input (Gemini). Deskripsi gaya diabaikan dengan
    // peringatan supaya user tidak mengira suaranya berubah. Gemini TTS adalah
    // tempat yang tepat untuk deskripsi gaya.
    if (style) {
      console.warn(
        'ElevenLabs: deskripsi voice style diabaikan — provider ini tidak menerima arahan gaya bebas.'
      );
    }

    // MP3 diminta langsung ke provider; WAV tidak disediakan ElevenLabs, jadi
    // PCM yang diminta lalu dibungkus header di sini.
    const outputFormat = audioFormat === 'mp3' ? 'mp3_44100_128' : 'pcm_24000';

    let response;

    try {
      response = await fetch(
        `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}` +
          `?output_format=${outputFormat}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey
          },
          // ElevenLabs tidak menerima `output_format=wav`, jadi permintaan WAV
          // memakai PCM dan dibungkus sendiri di bawah.
          body: JSON.stringify({ text, model_id: model }),
          signal: AbortSignal.timeout(getTimeoutMs())
        }
      );
    } catch (error) {
      throw createError(`ElevenLabs TTS error: ${error.message}`, 'PROVIDER_UNAVAILABLE');
    }

    if (!response.ok) {
      const detail = await readErrorMessage(response);

      throw createError(
        `ElevenLabs TTS error: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
        errorCodeFromStatus(response.status)
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    if (bytes.length === 0) {
      throw createError('ElevenLabs mengembalikan audio kosong.', 'PROVIDER_ERROR');
    }

    if (audioFormat === 'mp3') {
      return {
        buffer: bytes,
        format: 'mp3',
        mimeType: AUDIO_MIME_TYPES.mp3,
        provider: 'elevenlabs',
        model,
        voice: voiceId,
        duration: null
      };
    }

    const buffer = wrapPcmAsWav(bytes, ELEVENLABS_PCM);

    return {
      buffer,
      format: 'wav',
      mimeType: AUDIO_MIME_TYPES.wav,
      provider: 'elevenlabs',
      model,
      voice: voiceId,
      duration: measureWavDuration(buffer)
    };
  }
};

/**
 * Microsoft Edge TTS ("Read Aloud").
 *
 * Provider gratis yang TIDAK membutuhkan kredensial apa pun, dengan suara
 * neural Indonesia bawaan Microsoft (`id-ID-GadisNeural`, `id-ID-ArdiNeural`).
 * Inilah satu-satunya jalur gratis di rantai default yang tetap bekerja tanpa
 * akun: Gemini butuh GEMINI_API_KEY dan ElevenLabs butuh kunci free tier-nya.
 *
 * Protokolnya WebSocket, bukan HTTP — dan itu alasan `ws` menjadi satu-satunya
 * dependency baru di modul ini: WebSocket bawaan Node tidak bisa menyetel header
 * handshake, sedangkan server Microsoft menolak (non-101) permintaan tanpa
 * `Origin` dan `User-Agent` ala Edge. Sudah diuji langsung dari proyek ini.
 *
 * Server meminta token anti-abuse `Sec-MS-GEC`: SHA-256 dari jumlah tick (100 ns
 * sejak 1601) yang dibulatkan ke bawah per 5 menit, disambung token klien Read
 * Aloud. Karena itu jam server yang melenceng membuat handshake ditolak —
 * gejalanya kegagalan koneksi, bukan suara yang salah.
 *
 * Keluarannya MP3 24 kHz 48 kbps (WAV dan PCM mentah ditolak server, sudah
 * diuji), dan potongannya disatukan di sini supaya berbentuk satu berkas seperti
 * provider lain — controller tidak perlu tahu bedanya.
 */
const edgeGecToken = (now = Date.now()) => {
  let ticks = now / 1000 + WIN_EPOCH_SECONDS;
  ticks -= ticks % 300;
  ticks *= 1e7;

  return crypto
    .createHash('sha256')
    .update(`${ticks.toFixed(0)}${EDGE_TRUSTED_CLIENT_TOKEN}`, 'ascii')
    .digest('hex')
    .toUpperCase();
};

const buildEdgeUrl = () =>
  `${getEdgeUrl()}?TrustedClientToken=${EDGE_TRUSTED_CLIENT_TOKEN}` +
  `&ConnectionId=${crypto.randomUUID().replace(/-/g, '')}` +
  `&Sec-MS-GEC=${edgeGecToken()}` +
  `&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM_VERSION}`;

const buildEdgeHeaders = () => ({
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    `(KHTML, like Gecko) Chrome/${EDGE_CHROMIUM_VERSION.split('.')[0]}.0.0.0 ` +
    `Safari/537.36 Edg/${EDGE_CHROMIUM_VERSION.split('.')[0]}.0.0.0`,
  Origin: EDGE_ORIGIN,
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9',
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
  // MUID acak: identitas klien anonim yang diharapkan server.
  Cookie: `muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};`
});

/** Bahasa SSML diturunkan dari nama voice: id-ID-GadisNeural -> id-ID. */
const edgeLanguageFromVoice = (voice) => {
  const bagian = String(voice || '').split('-');
  return bagian.length >= 2 ? `${bagian[0]}-${bagian[1]}` : 'id-ID';
};

// Teks user harus di-escape: satu `<` mentah membuat SSML-nya tidak sah dan
// permintaannya ditolak server.
const escapeSsml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const buildEdgeSsml = (text, voice) =>
  "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' " +
  `xml:lang='${edgeLanguageFromVoice(voice)}'><voice name='${voice}'>` +
  `<prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeSsml(text)}` +
  '</prosody></voice></speak>';

/**
 * Pisahkan frame biner Edge: 2 byte panjang header (big-endian), header teks,
 * lalu isi audionya.
 */
const parseEdgeFrame = (data) => {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buffer.length < 2) return { header: '', body: Buffer.alloc(0) };

  const headerLength = buffer.readUInt16BE(0);
  const headerEnd = 2 + headerLength;
  if (buffer.length < headerEnd) return { header: '', body: Buffer.alloc(0) };

  return {
    header: buffer.toString('utf8', 2, headerEnd),
    body: buffer.subarray(headerEnd)
  };
};

const edgeFramePath = (header) => /Path:([^\r\n]+)/.exec(header)?.[1]?.trim() || null;

/**
 * Pabrik socket Edge. Bisa ditimpa test supaya suite test tidak membuka koneksi
 * ke layanan Microsoft (lihat setEdgeSocketFactory).
 */
const defaultEdgeSocketFactory = (url) =>
  new WebSocketClient(url, { headers: buildEdgeHeaders() });

let edgeSocketFactory = defaultEdgeSocketFactory;

const setEdgeSocketFactory = (factory) => {
  edgeSocketFactory = factory || defaultEdgeSocketFactory;
};

/**
 * Satu permintaan sintesis ke Edge; mengembalikan MP3 utuh sebagai Buffer.
 */
const synthesizeWithEdge = ({ text, voice, timeoutMs }) =>
  new Promise((resolve, reject) => {
    let socket;

    try {
      socket = edgeSocketFactory(buildEdgeUrl());
    } catch (error) {
      reject(createError(`Edge TTS error: ${error.message}`, 'PROVIDER_UNAVAILABLE'));
      return;
    }

    const chunks = [];
    let settled = false;
    let timer = null;
    // Frame terakhir dari server disimpan untuk pesan galat: saat voice atau
    // formatnya ditolak, penjelasannya ada di situ, bukan di kode HTTP.
    let pesanTerakhir = '';

    const selesai = (fn, nilai) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // Koneksi yang dibiarkan terbuka akan dihitung server sebagai sesi
      // menganggur, jadi selalu ditutup setelah suara terkumpul.
      try {
        socket.close();
      } catch {
        // Sudah tertutup — tidak ada yang perlu dilakukan.
      }
      fn(nilai);
    };

    const gagal = (error) => selesai(reject, error);

    timer = setTimeout(
      () =>
        gagal(
          createError(
            `Edge TTS error: tidak ada balasan dalam ${timeoutMs} ms. Voice atau ` +
              'format yang diminta kemungkinan tidak didukung ' +
              `(pesan terakhir dari server: ${pesanTerakhir || 'tidak ada'}).`,
            'PROVIDER_UNAVAILABLE'
          )
        ),
      timeoutMs
    );

    socket.on('open', () => {
      socket.send(
        `X-Timestamp:${new Date().toISOString()}\r\n` +
          'Content-Type:application/json; charset=utf-8\r\n' +
          'Path:speech.config\r\n\r\n' +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  // Metadata dimatikan: yang dibutuhkan hanya audionya, dan
                  // metadata kata hanya menambah frame untuk diabaikan.
                  metadataoptions: {
                    sentenceBoundaryEnabled: 'false',
                    wordBoundaryEnabled: 'false'
                  },
                  outputFormat: EDGE_MP3_FORMAT
                }
              }
            }
          })
      );

      socket.send(
        `X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${new Date().toISOString()}\r\n` +
          `Path:ssml\r\n\r\n${buildEdgeSsml(text, voice)}`
      );
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        const { header, body } = parseEdgeFrame(data);

        if (edgeFramePath(header) === 'audio' && body.length) chunks.push(body);
        return;
      }

      const pesan = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      pesanTerakhir = pesan.replace(/\r\n/g, ' ').slice(0, 200);

      if (edgeFramePath(pesan) !== 'turn.end') return;

      if (!chunks.length) {
        gagal(
          createError(
            `Edge TTS tidak mengembalikan audio (pesan dari server: ${pesanTerakhir}).`,
            'PROVIDER_ERROR'
          )
        );
        return;
      }

      selesai(resolve, Buffer.concat(chunks));
    });

    // Handshake yang ditolak (mis. jam server melenceng sehingga token
    // Sec-MS-GEC kedaluwarsa) datang lewat dua jalur di bawah. Keduanya
    // dilaporkan sebagai gangguan sementara, BUKAN galat konfigurasi: provider
    // ini tidak punya kredensial yang bisa salah, dan masalahnya bisa hilang
    // sendiri.
    socket.on('error', (error) =>
      gagal(createError(`Edge TTS error: ${error.message}`, 'PROVIDER_UNAVAILABLE'))
    );

    socket.on('unexpected-response', (_request, response) =>
      gagal(
        createError(
          `Edge TTS error: HTTP ${response?.statusCode || 'tidak dikenal'}`,
          'PROVIDER_UNAVAILABLE'
        )
      )
    );

    socket.on('close', () =>
      gagal(
        createError(
          'Edge TTS error: koneksi ditutup sebelum audio selesai ' +
            `(pesan terakhir dari server: ${pesanTerakhir || 'tidak ada'}).`,
          'PROVIDER_UNAVAILABLE'
        )
      )
    );
  });

/**
 * Microsoft Edge TTS — suara neural Indonesia bawaan Microsoft.
 */
const edge = {
  name: 'edge',
  label: 'Microsoft Edge TTS (suara Indonesia, tanpa kunci API)',
  // Tidak ada variabel yang harus diisi; kolom ini tetap ada supaya bentuk
  // provider di sini seragam.
  envVars: [],
  supportedFormats: SUPPORTED_FORMATS_BY_PROVIDER.edge,

  // Selalu siap — inilah provider yang bekerja tanpa kunci apa pun. Karena itu
  // pula ia diletakkan di urutan TERAKHIR daftar default: provider yang
  // kredensialnya sudah diisi tetap didahulukan.
  isConfigured: () => true,

  getModel: () => EDGE_MODEL,

  async generate({ text, voice, style, format }) {
    const audioFormat = format || DEFAULT_FORMAT_BY_PROVIDER.edge;
    const usedVoice = resolveVoice('edge', voice);

    // Rantai provider sudah melewati provider yang tidak sanggup format yang
    // diminta, jadi cabang ini hanya tercapai oleh pemanggil langsung. Lebih
    // baik gagal jelas daripada mengirim MP3 dengan label WAV.
    if (audioFormat !== 'mp3') {
      throw createError(
        `Edge TTS hanya menghasilkan MP3 (diminta ${audioFormat}). Pakai format mp3, ` +
          'atau pilih provider lain untuk WAV.',
        'PROVIDER_UNSUPPORTED'
      );
    }

    // Edge tidak punya arahan gaya bebas: kecepatan dan nada hanya bisa diatur
    // lewat angka di SSML, bukan deskripsi bahasa alami. Diabaikan dengan
    // peringatan supaya user tidak mengira suaranya berubah — deskripsi gaya
    // adalah fitur Gemini TTS.
    if (style) {
      console.warn(
        'Edge TTS: deskripsi voice style diabaikan — provider ini tidak menerima arahan gaya bebas.'
      );
    }

    const buffer = await synthesizeWithEdge({
      text,
      voice: usedVoice,
      timeoutMs: getTimeoutMs()
    });

    if (buffer.length === 0) {
      throw createError('Edge mengembalikan audio kosong.', 'PROVIDER_ERROR');
    }

    return {
      buffer,
      format: 'mp3',
      mimeType: AUDIO_MIME_TYPES.mp3,
      provider: 'edge',
      model: EDGE_MODEL,
      voice: usedVoice,
      // MP3 tidak menyimpan durasi di header yang bisa dipercaya.
      duration: null
    };
  }
};

const PROVIDERS = { gemini, edge, elevenlabs, openai };
// Urutan ini menentukan provider utama default: yang gratis dan bersuara
// Indonesia didahulukan (Gemini, lalu ElevenLabs free tier), lalu OpenAI (yang
// berbayar), dan Edge di belakang ketiganya. Edge sengaja tidak di depan justru
// karena ia SELALU siap: kalau ia diletakkan lebih awal, ia akan selalu menang
// dan kunci Gemini/ElevenLabs yang sudah diisi admin tidak pernah terpakai.
//
// Setiap provider di daftar ini punya suara Indonesia — itu syarat masuknya,
// karena halaman /tools/text-to-sound selalu mengucapkan teks Indonesia.
const PROVIDER_ORDER = ['gemini', 'elevenlabs', 'openai', 'edge'];
// Cadangan default adalah Edge — satu-satunya provider yang tidak membutuhkan
// kredensial. Cadangan yang butuh kunci akan gagal tepat saat ia paling
// dibutuhkan (admin belum mengisi kunci itu), sedangkan Edge selalu bisa
// mencoba. Efeknya: permintaan yang gagal di Gemini karena kuota gratisnya
// habis (HTTP 429) tetap keluar sebagai audio Indonesia, bukan kegagalan.
const DEFAULT_FALLBACK_PROVIDER = 'edge';

const normalizeName = (value) => String(value || '').trim().toLowerCase();

/**
 * Provider utama saat SOUND_PROVIDER tidak diisi: provider pertama yang
 * kredensialnya sudah tersedia.
 *
 * Edge termasuk di sini karena isConfigured()-nya selalu true: tanpa kunci apa
 * pun, Edge-lah yang dilaporkan sebagai provider utama — dan itu benar, karena
 * ia memang bisa melayani permintaan suara Indonesia tanpa akun. Provider yang
 * kredensialnya sudah diisi tetap didahulukan karena urutannya lebih depan.
 */
const resolveDefaultPrimary = () =>
  PROVIDER_ORDER.find((name) => PROVIDERS[name].isConfigured()) || PROVIDER_ORDER[0];

/**
 * Urutan provider yang akan dicoba untuk satu permintaan suara.
 *
 * `SOUND_PROVIDER=none` mematikan fiturnya — dipakai test dan operator yang
 * ingin menonaktifkan fitur ini tanpa menghapus kodenya.
 *
 * Cadangan default-nya ElevenLabs (gratis juga), jadi kuota gratis Gemini yang
 * habis tidak membuat user menunggu sampai bulan depan. Cadangan dipakai untuk
 * SEMUA kegagalan yang bisa dicoba ulang (kuota habis, gangguan provider), bukan
 * hanya 429 — kegagalan kredensial tetap dilaporkan apa adanya karena mencoba
 * provider lain tidak menolong.
 *
 * @returns {string[]}
 * @throws {Error} jika nama provider di env tidak dikenal
 */
const getSpeechChain = () => {
  const explicit = normalizeName(process.env.SOUND_PROVIDER);

  if (explicit === 'none') return [];

  if (explicit && !PROVIDERS[explicit]) {
    throw createError(
      `Unknown SOUND_PROVIDER "${explicit}". Available: ${PROVIDER_ORDER.join(', ')}, none.`,
      'INVALID_PROVIDER_CONFIG'
    );
  }

  const primary = explicit || resolveDefaultPrimary();

  const fallbackRaw =
    process.env.SOUND_FALLBACK_PROVIDER === undefined
      ? DEFAULT_FALLBACK_PROVIDER
      : normalizeName(process.env.SOUND_FALLBACK_PROVIDER);

  const chain = [primary];

  if (fallbackRaw && fallbackRaw !== 'none') {
    if (!PROVIDERS[fallbackRaw]) {
      throw createError(
        `Unknown SOUND_FALLBACK_PROVIDER "${fallbackRaw}". Available: ` +
          `${PROVIDER_ORDER.join(', ')}, none.`,
        'INVALID_PROVIDER_CONFIG'
      );
    }

    if (!chain.includes(fallbackRaw)) chain.push(fallbackRaw);
  }

  return chain;
};

/**
 * Pilihan suara untuk provider yang aktif, dipakai endpoint
 * GET /media/sound-voices dan dropdown di frontend.
 *
 * Daftar ini berasal dari provider di urutan pertama rantai (yang benar-benar
 * melayani permintaan lebih dulu), jadi user tidak pernah memilih voice yang
 * pasti ditolak — masalah yang muncul kalau daftar voice disimpan terpisah di
 * frontend.
 */
const getSoundVoiceOptions = () => {
  let chain = [];
  try {
    chain = getSpeechChain();
  } catch {
    chain = [];
  }

  const provider = chain[0] || PROVIDER_ORDER[0];

  return {
    provider,
    voices: VOICES_BY_PROVIDER[provider] || [],
    defaultVoice: DEFAULT_VOICE_BY_PROVIDER[provider],
    // Format mengikuti provider yang aktif, bukan seluruh provider: Gemini TTS
    // tidak bisa menghasilkan MP3, jadi menawarkan MP3 di UI hanya akan membuat
    // permintaan itu dilayani provider lain (dan kuotanya) tanpa user tahu.
    formats: supportedFormats(provider),
    // Format yang dipakai bila klien tidak mengirim `format` (POST langsung dari
    // API, bukan dari halaman web). Ikut provider yang aktif: Edge hanya bisa
    // MP3, sedangkan Gemini hanya WAV.
    defaultFormat: defaultFormatFor(provider)
  };
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
  // `undefined` diperlakukan berbeda dari format yang disebut eksplisit: kalau
  // klien tidak memilih format, tiap provider memakai default-nya sendiri
  // (Edge: mp3, Gemini: wav) sehingga tidak ada provider sehat yang terlewat
  // hanya karena beda format bawaan.
  const formatDiminta = format || null;
  // Provider yang dilewati HANYA karena formatnya tidak didukung. Dipakai untuk
  // percobaan terakhir di bawah.
  const dilewatiKarenaFormat = [];
  // Apakah ada provider yang benar-benar dicoba lalu gagal (bukan sekadar
  // dilewati). Bedanya penting: penggantian format di bawah hanya masuk akal
  // kalau permintaannya memang akan gagal kalau dibiarkan.
  let adaKegagalanNyata = false;

  for (const name of chain) {
    const provider = PROVIDERS[name];

    if (!provider.isConfigured()) {
      attempts.push({ provider: name, reason: 'missing credentials' });
      continue;
    }

    const formatUntukProvider = formatDiminta || defaultFormatFor(name);

    // Provider yang tidak sanggup menghasilkan format yang diminta dilewati.
    // Gemini hanya menghasilkan PCM (jadi WAV) dan Edge hanya MP3, sehingga
    // permintaan yang formatnya disebut eksplisit tetap bisa dilayani provider
    // cadangan alih-alih gagal di tengah jalan.
    if (
      Array.isArray(provider.supportedFormats) &&
      !provider.supportedFormats.includes(formatUntukProvider)
    ) {
      attempts.push({
        provider: name,
        reason: `format ${formatUntukProvider} is not supported`
      });

      if (formatDiminta) dilewatiKarenaFormat.push(name);
      continue;
    }

    try {
      const result = await provider.generate({
        text,
        voice,
        style,
        format: formatUntukProvider
      });
      return { ...result, attempts };
    } catch (error) {
      attempts.push({ provider: name, reason: error.message });
      adaKegagalanNyata = true;

      // Kegagalan yang berasal dari konfigurasi server diingat dan diutamakan:
      // menyamarkannya jadi "coba lagi" membuat user menekan tombol yang sama
      // berulang kali untuk masalah yang hanya bisa diperbaiki admin.
      if (!configError && CONFIG_ERROR_CODES.includes(error.code)) configError = error;
    }
  }

  /**
   * Percobaan terakhir: provider yang dilewati karena format dicoba sekali lagi
   * dengan format bawaan-NYA.
   *
   * Kasus yang diselamatkan: provider utama gagal sesaat (mis. kuota gratis
   * Gemini habis, HTTP 429) sementara satu-satunya cadangan hanya sanggup format
   * lain — tanpa langkah ini permintaannya gagal total padahal provider yang bisa
   * melayaninya sudah ada di rantai. Audio dalam wadah berbeda jauh lebih berguna
   * daripada tidak ada audio, dan penggantian formatnya DICATAT di `attempts`
   * serta terlihat di metadata, jadi tidak terjadi diam-diam.
   *
   * Dua syarat membatasinya, supaya tidak berubah menjadi penggantian sepihak:
   *   - ada galat konfigurasi? Berhenti. Kunci yang ditolak harus terlihat apa
   *     adanya, bukan ditutupi oleh suara yang formatnya berbeda.
   *   - format yang diminta bukan format bawaan provider UTAMA? Berhenti. Klien
   *     yang meminta format di luar kebiasaan halaman (mis. MP3 padahal provider
   *     utamanya Gemini) sedang meminta sesuatu yang spesifik, dan memanggil
   *     provider lain justru memakai kuotanya untuk sesuatu yang tidak diminta.
   */
  const formatBawaanUtama = defaultFormatFor(chain[0]);

  if (
    !configError &&
    adaKegagalanNyata &&
    dilewatiKarenaFormat.length &&
    formatDiminta === formatBawaanUtama
  ) {
    const nama = dilewatiKarenaFormat[0];
    const formatPengganti = defaultFormatFor(nama);

    try {
      const result = await PROVIDERS[nama].generate({
        text,
        voice,
        style,
        format: formatPengganti
      });

      // Catatannya menempel pada entri "dilewati karena format" yang sudah ada,
      // bukan menambah entri kedua untuk provider yang sama.
      const entri = attempts.find((item) => item.provider === nama);

      if (entri) {
        entri.reason += `; dilayani sebagai ${formatPengganti}`;
      } else {
        attempts.push({
          provider: nama,
          reason: `dilayani sebagai ${formatPengganti} (format ${formatDiminta} tidak didukung)`
        });
      }

      return { ...result, attempts };
    } catch (error) {
      attempts.push({ provider: nama, reason: error.message });

      if (!configError && CONFIG_ERROR_CODES.includes(error.code)) configError = error;
    }
  }

  // Tidak ada provider aktif: pesannya menyebut variabel yang harus diisi,
  // karena inilah satu-satunya langkah yang bisa memperbaiki keadaan.
  // Hanya tercapai kalau SOUND_PROVIDER=none, karena Edge tidak butuh
  // kredensial dan karenanya rantai defaultnya tidak pernah kosong.
  if (chain.length === 0 || attempts.every((item) => item.reason === 'missing credentials')) {
    throw createError(
      'Text-to-sound dimatikan di server (SOUND_PROVIDER=none). Lepaskan ' +
        'pengaturan itu untuk memakai Edge TTS (suara Indonesia, tanpa kunci) ' +
        'atau isi GEMINI_API_KEY (https://aistudio.google.com/apikey) untuk ' +
        'logat yang bisa diarahkan lewat deskripsi gaya.',
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
    defaultPrimary: resolveDefaultPrimary(),
    // Voice milik provider yang dilayani lebih dulu. Frontend mengambil daftar
    // lengkapnya (beserta label) dari GET /media/sound-voices. nilai ini tetap
    // ada supaya blok /health bisa dipakai untuk debugging tanpa request kedua.
    voices: voiceValues(chain[0]),
    formats: ALLOWED_FORMATS
  };
};

module.exports = {
  generateSpeech,
  getSpeechChain,
  getSpeechProviderStatus,
  getSoundVoiceOptions,
  resolveVoice,
  resetElevenLabsVoiceCache,
  supportedFormats,
  measureWavDuration,
  wrapPcmAsWav,
  // Dipakai test: mengganti pabrik socket Edge supaya suite test tidak membuka
  // koneksi ke layanan Microsoft, dan membaca bagian protokolnya secara terpisah.
  setEdgeSocketFactory,
  buildEdgeHeaders,
  buildEdgeSsml,
  edgeGecToken,
  parseEdgeFrame,
  defaultFormatFor,
  VOICES_BY_PROVIDER,
  SUPPORTED_FORMATS_BY_PROVIDER,
  DEFAULT_VOICE_BY_PROVIDER,
  DEFAULT_FORMAT_BY_PROVIDER,
  ALLOWED_FORMATS,
  DEFAULT_FORMAT,
  DEFAULT_OPENAI_TTS_MODEL,
  DEFAULT_GEMINI_TTS_MODEL,
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_VOICE_ID,
  DEFAULT_FALLBACK_PROVIDER,
  MAX_TEXT_LENGTH,
  MAX_STYLE_LENGTH,
  GEMINI_BASE_URL,
  ELEVENLABS_BASE_URL,
  EDGE_WSS_URL,
  EDGE_TRUSTED_CLIENT_TOKEN,
  EDGE_CHROMIUM_VERSION,
  PROVIDERS,
  PROVIDER_ORDER
};
