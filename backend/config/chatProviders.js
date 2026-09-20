/**
 * Provider Chat (LLM)
 *
 * Semua provider di sini memakai klien OpenAI SDK dengan `baseURL` masing-masing,
 * jadi bentuk pemanggilannya identik:
 *   generate({ messages, maxTokens }) -> { content, model, usage }
 *
 * Dipilih lewat env:
 *   CHAT_PROVIDER           = groq | gemini | openai | openrouter
 *   CHAT_FALLBACK_PROVIDER  = groq | gemini | openai | openrouter | none
 *                             (boleh beberapa nama dipisah koma, mis.
 *                              `gemini,openrouter` — dicoba berurutan;
 *                              provider berkey lain tetap ikut di belakangnya,
 *                              lihat catatan di getChatChain)
 *   OPENROUTER_CHAT_MODEL   = daftar model OpenRouter, dipisah koma dan dicoba
 *                             berurutan (huruf besar/kecil tidak diubah)
 *   OPENROUTER_FAILURE_COOLDOWN_MS = jeda sebelum model yang baru gagal dicoba
 *                             lagi (default 60000; 0 = selalu coba semua)
 *   OPENROUTER_REASONING    = off | exclude | default  (default: off)
 *                             (khusus provider OpenRouter — lihat catatan di
 *                              DEFAULT_OPENROUTER_REASONING)
 *
 * Default tanpa mengisi apa pun: provider pertama yang punya API key, dengan
 * urutan Groq → Gemini → OpenAI → OpenRouter. Fallback dipakai otomatis saat
 * provider utama gagal (mis. kuota harian gratisnya habis).
 *
 * Catatan penting: berbeda dari text-to-image, chat tidak punya provider tanpa
 * API key, jadi minimal satu key wajib diisi.
 */

const { getClient, getChatModel } = require('./openai');

const DEFAULT_MAX_TOKENS = 2000;
// Urutan ini menentukan provider utama default sekaligus urutan cadangan:
// nama yang ditulis di CHAT_FALLBACK_PROVIDER didahulukan, sisanya mengikuti
// urutan ini. OpenRouter ditaruh paling akhir supaya provider utama dan
// cadangan yang sudah ada tidak bergeser posisinya.
const PROVIDER_ORDER = ['groq', 'gemini', 'openai', 'openrouter'];

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
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
// Model gratis dari OpenRouter (gratis = akhiran `:free`, rate limit harian).
//
// Dipilih setelah membandingkan 22 model `:free` di katalog OpenRouter: ini yang
// paling cepat dan paling konsisten (±0,7–1,0 detik, 6/6 permintaan berhasil),
// setara provider utama Groq (±0,9 detik). Pembanding terdekat, model
// `nvidia/nemotron-3.5-lightning:free` yang dipakai sebelumnya, terukur ±71–76
// detik untuk prompt yang sama — terlalu lambat sebagai cadangan karena sudah
// melewati `CHAT_REQUEST_TIMEOUT_MS` (90 detik) pada jawaban yang panjang.
//
// Urutannya penting: model tercepat dipakai lebih dulu, lalu model berikutnya
// menampung kasus rate limit/kuota model gratis yang bersifat per model.
// Model kedua terukur ±5,0–6,3 detik (pernah `503 Service temporarily overloaded`
// dari sisi NVIDIA), dan model ketiga ±1,0–1,9 detik (4/4 percobaan berhasil) —
// sengaja ditaruh paling akhir sebagai jaring pengaman terakhir, bukan pilihan
// pertama, supaya urutan yang sudah dipakai tidak bergeser.
//
// Model keempat (`inclusionai/ling-3.0-flash-fin:free`) terukur 815–2317 ms,
// 3/3 percobaan berhasil, jawabannya rapi — varian "fin" dari model ketiga.
//
// `z-ai/glm-5.2:free` dikeluarkan dari daftar: ia selalu dibalas `429` karena
// kolam gratis bersama provider upstreamnya (`limit_source:
// upstream_provider_shared_pool`, provider "Decart") sedang jenuh — 0 berhasil
// dari 8 percobaan di empat ronde pengujian. Itu bukan kuota akun kita, jadi
// ia bisa dimasukkan kembali kapan saja lewat OPENROUTER_CHAT_MODEL begitu
// kolamnya longgar (opsi BYOK ada di docs bagian 3c).
const DEFAULT_OPENROUTER_MODELS = [
  'nex-agi/nex-n2.5-mini:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'inclusionai/ling-3.0-flash-vl:free',
  'inclusionai/ling-3.0-flash-fin:free'
];
const DEFAULT_OPENROUTER_MODEL = DEFAULT_OPENROUTER_MODELS[0];

// Model ini tetap bisa berpikir (reasoning): kalau dibiarkan, ia memakai jatah
// `max_tokens` untuk berpikir dan yang tersisa di `content` hanya jejak berpikir
// ("Here's a thinking process: ..."), sementara waktunya membengkak (terukur
// ±100 detik vs ±19 detik saat penalaran dimatikan). Jadi secara default
// penalaran dimatikan untuk provider ini.
//   off     -> reasoning.enabled=false  (jawaban bersih, tercepat)
//   exclude -> reasoning.exclude=true   (tetap berpikir, jejaknya disembunyikan)
//   default -> tidak mengirim parameter apa pun (ikut perilaku model)
const DEFAULT_OPENROUTER_REASONING = 'off';
const OPENROUTER_REASONING_MODES = {
  off: { enabled: false },
  exclude: { exclude: true },
  default: null
};

const getOpenRouterReasoning = () => {
  const raw =
    process.env.OPENROUTER_REASONING === undefined
      ? DEFAULT_OPENROUTER_REASONING
      : normalizeName(process.env.OPENROUTER_REASONING);

  // Nilai tak dikenal sengaja tidak melempar error: salah tulis di env tidak
  // boleh mematikan seluruh fitur chat, cukup kembali ke perilaku model.
  return OPENROUTER_REASONING_MODES[raw] ?? OPENROUTER_REASONING_MODES.default;
};

/**
 * Jeda sebelum model OpenRouter yang baru gagal dicoba lagi.
 *
 * Batas gratis di OpenRouter bersifat per model dan sering bertahan lebih dari
 * satu request (mis. `429` dari upstream z-ai yang bertahan berjam-jam). Tanpa
 * ingatan antar-request, setiap pesan user membayar ulang kegagalan yang sama —
 * itulah yang membuat "semua provider gagal" terasa lama. Nilai 0 mematikan
 * jeda ini (semua model selalu dicoba).
 */
const DEFAULT_OPENROUTER_COOLDOWN_MS = 60000;

// Retry bawaan SDK sengaja dimatikan untuk OpenRouter: percobaan ulang di sini
// sudah ditangani dengan mencoba model berikutnya, jadi retry internal hanya
// menggandakan waktu tunggu saat sebuah model sedang kena `429`.
const OPENROUTER_MAX_RETRIES = 0;

// model -> { until, reason } untuk model yang baru gagal.
const openRouterFailures = new Map();

const getOpenRouterCooldownMs = () =>
  process.env.OPENROUTER_FAILURE_COOLDOWN_MS === undefined
    ? DEFAULT_OPENROUTER_COOLDOWN_MS
    : Number(process.env.OPENROUTER_FAILURE_COOLDOWN_MS) || 0;

const recordOpenRouterFailure = (model, reason) => {
  openRouterFailures.set(model, { until: Date.now() + getOpenRouterCooldownMs(), reason });
};

/**
 * Sisa waktu jeda sebuah model dalam milidetik (0 = siap dicoba).
 * Catatan yang sudah kedaluwarsa langsung dibuang supaya Map tidak menumpuk.
 */
const getOpenRouterCooldownRemaining = (model, now = Date.now()) => {
  const entry = openRouterFailures.get(model);
  if (!entry) return 0;

  const remaining = entry.until - now;
  if (remaining <= 0) {
    openRouterFailures.delete(model);
    return 0;
  }

  return remaining;
};

const getOpenRouterFailureReason = (model) => openRouterFailures.get(model)?.reason || null;

/** Dipakai test agar jeda antar-test tidak saling mewarisi. */
const resetOpenRouterCooldowns = () => openRouterFailures.clear();

// Nilai placeholder di .env.example tidak dianggap konfigurasi valid.
const PLACEHOLDER_VALUES = new Set([
  'process.env.GROQ_API_KEY',
  'your-gemini-key-here',
  'your-openrouter-key-here'
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
bergabung menjadi: `process.env.GROQ_API_KEY`. Nilai berisi baris
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
 * Pecah nilai env berisi beberapa nama provider dipisah koma menjadi daftar.
 * Satu nama tetap bekerja seperti sebelumnya (`gemini`), tapi sekarang bisa
 * juga berisi rantai cadangan (`gemini,openrouter`).
 */
const parseProviderList = (value) => parseModelList(value).map((name) => normalizeName(name));

/**
 * Pecah daftar model dari env menjadi array.
 *
 * Berbeda dari nama provider, id model TIDAK dinormalkan: nilainya adalah
 * pengenal dari katalog OpenRouter (mis. `meta-llama/Llama-3.3-70B-Instruct:free`),
 * dan yang diketik operator dikirim apa adanya.
 */
const parseModelList = (value) => {
  const seen = new Set();

  return String(value || '')
    .split(',')
    .map((model) => model.trim())
    .filter((model) => {
      // Model kembar dibuang: menuliskan model yang sama dua kali hanya membuat
      // kegagalannya dibayar dua kali dalam satu permintaan.
      if (model === '' || seen.has(model)) return false;
      seen.add(model);
      return true;
    });
};

/**
 * Pesan error provider + status HTTP bila ada (mis. 429 saat kuota habis).
 */
const describeError = (error) =>
  `${error.message}${error.status ? ` (HTTP ${error.status})` : ''}`;

/**
 * Panggil chat completion dan ambil teks jawabannya.
 */
const requestCompletion = async ({
  client,
  model,
  messages,
  maxTokens,
  maxTokensParam,
  reasoning
}) => {
  const params = { model, messages };

  // Nama parameter batas token berbeda antar penyedia:
  // Groq sudah menandai `max_tokens` sebagai deprecated, sedangkan lapisan
  // kompatibilitas Gemini mengabaikan field yang tidak dikenal.
  if (maxTokens) params[maxTokensParam] = maxTokens;

  // Parameter khusus reasoning model (OpenRouter). Tanpa arahan eksplisit,
  // penalaran bisa menghabiskan seluruh jatah token sehingga jawaban tidak
  // pernah muncul di `content`.
  if (reasoning) params.reasoning = reasoning;

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

/**
 * OpenRouter — gateway ke banyak model (termasuk yang gratis, ditandai `:free`).
 * Endpoint-nya kompatibel OpenAI, jadi cukup baseURL + key yang berbeda.
 * Dipakai sebagai cadangan tambahan: key-nya opsional, dan selama
 * OPENROUTER_API_KEY kosong provider ini hanya dilewati.
 */
const openrouter = {
  name: 'openrouter',
  label: 'OpenRouter (model gratis)',
  envVars: ['OPENROUTER_API_KEY'],
  maxTokensParam: 'max_tokens',

  isConfigured: () => isSet(process.env.OPENROUTER_API_KEY),

  /**
   * Semua model yang akan dicoba untuk provider ini, berurutan.
   * Satu nama di `OPENROUTER_CHAT_MODEL` tetap bekerja seperti sebelumnya; nilai
   * berisi koma menambahkan model cadangan di dalam provider yang sama. Nama yang
   * tertulis dua kali dihitung sekali.
   * @returns {string[]}
   */
  getModels() {
    const configured =
      process.env.OPENROUTER_CHAT_MODEL === undefined
        ? DEFAULT_OPENROUTER_MODELS
        : parseModelList(process.env.OPENROUTER_CHAT_MODEL);

    // Nilai kosong (mis. `OPENROUTER_CHAT_MODEL=`) jangan membuat daftar kosong,
    // karena itu akan mematikan provider ini tanpa penjelasan.
    return configured.length ? configured : DEFAULT_OPENROUTER_MODELS;
  },

  // Metode biasa (bukan arrow function) supaya `this` menunjuk ke provider ini.
  getModel() {
    return this.getModels()[0];
  },

  async generate({ messages, maxTokens }) {
    const models = this.getModels();
    const now = Date.now();
    const cooling = models
      .map((model) => ({ model, remaining: getOpenRouterCooldownRemaining(model, now) }))
      .filter((item) => item.remaining > 0);

    // Semua model sedang dijeda -> gagal cepat. Ini yang membuat kegagalan total
    // tidak lagi memakan waktu: percobaan ulang tetap dijamin terjadi karena jeda
    // punya batas waktu (default 60 detik), bukan mematikan provider selamanya.
    const candidates = models.filter(
      (model) => !cooling.some((item) => item.model === model)
    );

    const failures = cooling.map(
      (item) =>
        `${item.model}: dijeda ${Math.ceil(item.remaining / 1000)} detik lagi ` +
        `(percobaan terakhir: ${getOpenRouterFailureReason(item.model)})`
    );

    // Batas gratis OpenRouter berlaku per model, jadi model berikutnya dicoba
    // ketika model sebelumnya menolak (mis. 429/503) — rantai kecil di dalam
    // satu provider, sama seperti rantai antar-provider di `generateChatReply`.
    for (const model of candidates) {
      try {
        const result = await requestCompletion({
          client: getClient({
            apiKey: sanitizeSecret(process.env.OPENROUTER_API_KEY),
            baseURL: process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL,
            timeout: getRequestTimeoutMs(),
            maxRetries: OPENROUTER_MAX_RETRIES
          }),
          model,
          messages,
          maxTokens,
          maxTokensParam: this.maxTokensParam,
          reasoning: getOpenRouterReasoning()
        });

        // Model ini sehat lagi: hapus catatan kegagalannya supaya request
        // berikutnya langsung memakainya kembali.
        openRouterFailures.delete(model);
        return result;
      } catch (error) {
        const reason = describeError(error);
        recordOpenRouterFailure(model, reason);
        failures.push(`${model}: ${reason}`);
      }
    }

    throw createError(
      `All OpenRouter models failed (${failures.join('; ')})`,
      'PROVIDER_UNAVAILABLE'
    );
  }
};

const PROVIDERS = { groq, gemini, openai, openrouter };

/**
 * Provider pertama yang siap dipakai, sesuai urutan prioritas.
 */
const resolveDefaultPrimary = () =>
  PROVIDER_ORDER.find((name) => PROVIDERS[name].isConfigured()) || PROVIDER_ORDER[0];

/**
 * Tambahkan semua provider lain yang kredensialnya tersedia, sesuai urutan
 * prioritas, tanpa menggeser provider yang sudah ada di dalam rantai.
 *
 * Dipakai baik saat daftar cadangan tidak diatur maupun saat operator menulis
 * daftarnya sendiri. Key yang sudah diisi tidak boleh "diam" hanya karena
 * daftar itu tidak menyebut namanya: key adalah bukti operator menyiapkan
 * provider tersebut, sedangkan `CHAT_FALLBACK_PROVIDER` mengatur **urutan**
 * cadangan, bukan membatasi siapa saja yang boleh dipakai. Perilaku lama
 * (daftar dihormati persis) membuat key yang baru ditambahkan tidak berefek
 * sampai daftar lama ikut disunting — sumber kebingungan yang nyata.
 */
const appendConfiguredProviders = (chain) => {
  for (const name of PROVIDER_ORDER) {
    if (!chain.includes(name) && PROVIDERS[name].isConfigured()) chain.push(name);
  }

  return chain;
};

/**
 * Urutan provider yang akan dicoba untuk satu pesan.
 *
 * Provider pertama selalu `CHAT_PROVIDER` (atau provider pertama yang punya
 * key). Sesudahnya: nama yang ditulis di `CHAT_FALLBACK_PROVIDER` lebih dulu —
 * urutannya dihormati — lalu sisa provider yang kredensialnya tersedia.
 * `CHAT_FALLBACK_PROVIDER=none` adalah satu-satunya nilai yang benar-benar
 * mematikan cadangan, termasuk untuk provider yang key-nya sudah diisi.
 *
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
  const fallbackEnv = process.env.CHAT_FALLBACK_PROVIDER;

  if (fallbackEnv !== undefined && normalizeName(fallbackEnv) === 'none') return chain;

  // Cadangan eksplisit: boleh satu nama (`gemini`) atau beberapa dipisah koma
  // (`gemini,openrouter`). Urutan yang ditulis dihormati, lalu provider berkey
  // yang belum tercantum tetap ditambahkan di belakangnya.
  const fallbackNames = fallbackEnv === undefined ? [] : parseProviderList(fallbackEnv);

  for (const name of fallbackNames) {
    if (!PROVIDERS[name]) {
      throw createError(
        `Unknown CHAT_FALLBACK_PROVIDER "${name}". Available: ${PROVIDER_ORDER.join(', ')}, none.`,
        'INVALID_PROVIDER_CONFIG'
      );
    }

    if (!chain.includes(name)) chain.push(name);
  }

  // Default maupun daftar eksplisit sama-sama ditutup dengan provider berkey
  // yang belum ikut, supaya menambahkan key selalu berefek.
  return appendConfiguredProviders(chain);
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
      'GROQ_API_KEY (https://console.groq.com/keys), GEMINI_API_KEY, or ' +
      'OPENROUTER_API_KEY (https://openrouter.ai/keys).',
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
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_MODELS,
  DEFAULT_OPENROUTER_COOLDOWN_MS,
  DEFAULT_OPENROUTER_REASONING,
  resetOpenRouterCooldowns,
  OPENROUTER_BASE_URL,
  PROVIDERS,
  PROVIDER_ORDER
};
