/**
 * Provider Text-to-Video & Image-to-Video.
 *
 * Setiap provider di sini dibungkus ke bentuk yang sama:
 *   generateVideo({ prompt, mode, imageBuffer, mimeType, resolution, ratio, duration })
 *     -> { buffer, format, mimeType, provider, model, duration, attempts }
 *
 * Provider dipilih lewat env:
 *   VIDEO_PROVIDER           = bynara | none            (default: bynara)
 *   VIDEO_FALLBACK_PROVIDER  = bynara | none            (default: none)
 *
 * Kenapa hanya NaraRouter (Bynara) yang ada di sini — dan kenapa HARUS dijelaskan:
 *
 * Fitur ini berbeda dari text-to-image/sound yang punya jalur gratis tanpa
 * kredensial (Pollinations, Edge TTS). Sampai sekarang TIDAK ADA provider
 * text-to-video yang benar-benar gratis:
 *   - Cloudflare Workers AI (dipakai text-to-image) tidak punya satu pun model
 *     video di katalognya (65 model: teks, gambar, TTS, STT, embedding).
 *   - Pollinations punya model video (Veo 3.1, Seedance, Wan, MiniMax), tetapi
 *     SEMUANYA `paid_only: true` dan dihargai pollen (akun gratis ±1,5 pollen/
 *     minggu) — dan satu-satunya model komunitasnya berstatus `down`.
 *   - OpenRouter Video API berbayar per detik, dan kunci OpenRouter repo ini
 *     sudah dicabut (lihat docs/rotasi-kredensial.md).
 *   - Veo lewat Google API butuh billing aktif di Google Cloud.
 *
 * NaraRouter dipakai karena satu-satunya jalur yang sudah ada di proyek ini
 * (kunci `BYNARA_API_KEY` yang sama dipakai text-to-image) dan model videonya
 * (`agnes-video-v2.0`) masuk paket langganan, bukan bayar-per-pakai. Jangan
 * tambahkan provider video tanpa memastikan dulu status gratis/berbayarnya di
 * sumber resminya — catatan ini ada supaya pengecekan itu tidak diulang dari nol.
 *
 * Bentuk API-nya BEDA dari text-to-image:
 *   POST {base}/videos            -> 202 { id, status: "pending", created }
 *   GET  {base}/videos/{id}       -> { id, status, url: "/v1/videos/{id}/download", ... }
 *   GET  {url}                    -> berkas MP4
 *
 * Generative AI untuk video selalu asinkron (1-5 menit), jadi `generateVideo`
 * di sini MENUNGGU sampai selesai — dan itu sebabnya pemanggilnya (controller)
 * menjalankannya di latar belakang, bukan di dalam siklus request/response HTTP.
 * Tanpa itu satu permintaan user akan menahan koneksi selama menit dan hampir
 * pasti diputus proxy di depannya.
 */

const DEFAULT_TIMEOUT_MS = 120000;
// NaraRouter: "poll GET /v1/videos/{id} every ~5s"; generasi 1-5 menit.
const DEFAULT_POLL_INTERVAL_MS = 5000;
// Batas total satu pekerjaan video. Lebih longgar dari HTTP request mana pun
// karena polling-nya boleh berjalan lama; setelah ini job dianggap gagal dan
// record-nya ditutup supaya tidak tertinggal `processing` selamanya.
const DEFAULT_JOB_TIMEOUT_MS = 600000;

const DEFAULT_BYNARA_VIDEO_BASE_URL = 'https://api-images.bynara.id/v1';
// Unduhan hasil memakai host yang sama dengan endpoint video-nya (dokumentasi
// NaraRouter membalas `url` berupa path relatif `/v1/videos/{id}/download`),
// tetapi host router tetap dicoba sebagai cadangan — pola yang sama dipakai
// provider gambar, yang unduhannya justru hanya dilayani router.bynara.id.
const DEFAULT_BYNARA_VIDEO_DOWNLOAD_BASE_URL = 'https://api-images.bynara.id';
const DEFAULT_BYNARA_FALLBACK_DOWNLOAD_BASE_URL = 'https://router.bynara.id';
const DEFAULT_BYNARA_VIDEO_MODEL = 'agnes-video-v2.0';

// Mode yang didukung provider video berbasis NaraRouter.
//   t2v = teks saja              (0 gambar)
//   i2v = gambar pertama         (tepat 1 gambar)
// r2v (1-3 gambar referensi) sengaja BELUM ditawarkan: halaman Image to Video
// mengirim satu gambar, dan mode yang tidak dipakai hanya menambah jalur uji
// yang tidak pernah dilewati user.
const ALLOWED_MODES = ['t2v', 'i2v'];
const MODE_LABELS = {
  t2v: 'Text to Video',
  i2v: 'Image to Video'
};

// NaraRouter hanya mendokumentasikan 720p dan 1080p ("resolution 720p or 1080p
// (provider default when omitted)"). 480p TIDAK ada di daftar itu, jadi nilainya
// tidak ditawarkan walaupun lebih murah — permintaan yang ditolak provider hanya
// berakhir sebagai kegagalan yang sulit dijelaskan ke user.
const ALLOWED_RESOLUTIONS = ['720p', '1080p'];
const DEFAULT_RESOLUTION = '720p';
const ALLOWED_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9'];
const DEFAULT_RATIO = '16:9';

// Provider (agnes-video-v2.0) menerima durasi 3-15 detik, dan halaman web
// menawarkan seluruh rentang itu. Bawaannya 5 detik; `VIDEO_DURATION` hanya
// mengubah nilai yang terpilih lebih dulu saat halaman dibuka, bukan mengunci
// pilihannya.
const MIN_DURATION = 3;
const MAX_DURATION = 15;
const DEFAULT_DURATION = 5;

/** Seluruh durasi yang diterima provider: 3, 4, … 15 detik. */
const DURATION_CHOICES = Array.from(
  { length: MAX_DURATION - MIN_DURATION + 1 },
  (_, index) => MIN_DURATION + index
);

// Prompt video boleh jauh lebih panjang dari prompt gambar: dokumentasi
// NaraRouter menyebut batas 3.500 karakter, dan deskripsi gerakan kamera memang
// butuh ruang. Dipotong di 2000 supaya satu permintaan tidak memakan waktu lama
// hanya untuk mengirim teksnya.
const MAX_PROMPT_LENGTH = 2000;

// Gambar pertama untuk i2v. Tidak ada batas sisi dari provider, tetapi berkas
// yang sangat besar membuat unggahan multipart lambat; frontend memperkecilnya
// lebih dulu dan nilai ini adalah validasi lapis kedua di server.
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

// Format video keluaran. NaraRouter selalu menghasilkan MP4.
const VIDEO_FORMAT = 'mp4';
const VIDEO_MIME_TYPE = 'video/mp4';

// Nilai placeholder di .env.example tidak dianggap konfigurasi valid.
const PLACEHOLDER_VALUES = new Set([
  'your-bynara-key-here',
  'sk-nry-...',
  'your-nararouter-key-here'
]);

const isSet = (value) => {
  if (!value) return false;
  const trimmed = String(value).trim();
  return trimmed !== '' && !PLACEHOLDER_VALUES.has(trimmed);
};

/**
 * Ambil token pertama dari sebuah secret.
 *
 * Alasannya sama dengan provider gambar/suara: nilai dari shell/.env bisa
 * tercemar tanpa disadari (dua baris bergabung karena tanda kutip yang tidak
 * ditutup), dan nilai berisi baris baru ditolak sebagai header HTTP — gejalanya
 * hanya "fetch failed", bukan pesan yang bisa ditindaklanjuti.
 */
const sanitizeSecret = (value) => String(value || '').trim().split(/\s+/)[0];

const createError = (message, code) => {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
};

const getTimeoutMs = () =>
  Number(process.env.VIDEO_REQUEST_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

const getPollIntervalMs = () =>
  Number(process.env.VIDEO_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;

const getJobTimeoutMs = () =>
  Number(process.env.VIDEO_JOB_TIMEOUT_MS) || DEFAULT_JOB_TIMEOUT_MS;

const bynaraModel = () =>
  process.env.BYNARA_VIDEO_MODEL || process.env.VIDEO_MODEL || DEFAULT_BYNARA_VIDEO_MODEL;

const bynaraVideoBaseUrl = () =>
  (process.env.BYNARA_VIDEO_BASE_URL || DEFAULT_BYNARA_VIDEO_BASE_URL).replace(/\/+$/, '');

const bynaraAuthHeader = () => ({
  Authorization: `Bearer ${sanitizeSecret(process.env.BYNARA_API_KEY)}`
});

/**
 * Terjemahkan kegagalan fetch menjadi pesan yang bisa ditindaklanjuti.
 *
 * Sama seperti provider gambar: saat koneksi gagal di level jaringan, Node
 * hanya memberi "fetch failed" dan sebab sebenarnya ada di `error.cause`.
 * Tanpa meneruskannya, kredensial salah dan gangguan jaringan terlihat sama.
 */
const describeFetchFailure = (error) => {
  const cause = error.cause || {};
  const detail = [cause.code, cause.message, cause.hostname]
    .filter((part) => part && String(part).trim() !== '')
    .join(' · ');

  return detail
    ? `${error.message || 'fetch failed'} (${detail})`
    : error.message || 'fetch failed';
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = getTimeoutMs()) => {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw createError(
        `Request ke provider video melewati batas ${timeoutMs} ms`,
        'PROVIDER_TIMEOUT'
      );
    }

    throw createError(describeFetchFailure(error), 'PROVIDER_NETWORK');
  }
};

/** Baca body sebagai JSON tanpa meledak kalau provider mengirim HTML/teks. */
const readJson = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

/**
 * Pesan galat yang berguna dari balasan provider.
 *
 * Bentuk galat NaraRouter: `{ error: { type, message, request_id } }`. Bentuk
 * lain tetap dibaca supaya pesan dari proxy di depannya tidak hilang.
 */
const describeProviderError = (data, response) => {
  const dariEnvelope =
    typeof data?.error === 'string' ? data.error : data?.error?.message;

  return (
    dariEnvelope ||
    data?.message ||
    (data?.raw ? String(data.raw).slice(0, 200) : '') ||
    `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
  );
};

const errorCodeFromStatus = (status) => {
  if (status === 401 || status === 403) return 'INVALID_PROVIDER_CONFIG';
  // 429 (batas laju/kuota per kelas model) dan 503 sengaja bisa dicoba ulang:
  // kuota berbayar yang habis memang biasanya pulih sendiri.
  if (status === 429 || (status && status >= 500)) return 'PROVIDER_UNAVAILABLE';
  if (status === 402) return 'PROVIDER_UNPAID';
  return 'PROVIDER_ERROR';
};

// Status pekerjaan yang berarti masih berjalan. Nama yang berbeda-beda antar
// versi API diterima sekaligus: menunggu satu ejaan saja berarti job yang
// sebenarnya selesai dianggap menggantung sampai batas waktu habis.
const PENDING_STATUSES = new Set([
  'pending',
  'queued',
  'processing',
  'in_progress',
  'in-progress',
  'running',
  'starting'
]);

const SUCCEEDED_STATUSES = new Set(['succeeded', 'completed', 'complete', 'done', 'success']);

const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled', 'expired', 'rejected']);

/** Klasifikasi status pekerjaan yang dilaporkan provider. */
const classifyJobStatus = (status) => {
  const value = String(status || '').trim().toLowerCase();

  if (SUCCEEDED_STATUSES.has(value)) return 'completed';
  if (FAILED_STATUSES.has(value)) return 'failed';
  if (PENDING_STATUSES.has(value)) return 'pending';

  // Status tak dikenal diperlakukan sebagai "masih berjalan": job yang benar-
  // benar gagal akan berhenti sendiri lewat batas waktu, sedangkan job yang
  // sebenarnya sukses tetapi memakai nama status baru tetap bisa diselamatkan
  // selama balasannya sudah memuat URL berkasnya.
  return 'pending';
};

/**
 * URL unduhan hasil video.
 *
 * NaraRouter membalas `url` berupa path relatif (`/v1/videos/{id}/download`),
 * dan host yang melayaninya tidak selalu sama dengan host pembuat job. Karena
 * itu host dicoba berurutan: host video lebih dulu, lalu host router — pola yang
 * sama dengan `bynaraDownloadCandidates()` di imageProviders.js, yang sudah
 * terbukti perlu karena host generate dan host unduhan memang berbeda di sana.
 *
 * @returns {string[]} minimal satu URL absolut
 */
const bynaraDownloadCandidates = (raw) => {
  if (/^https?:\/\//i.test(raw)) return [raw];

  const path = raw.startsWith('/') ? raw : `/${raw}`;
  const hosts = [
    process.env.BYNARA_VIDEO_DOWNLOAD_BASE_URL || DEFAULT_BYNARA_VIDEO_DOWNLOAD_BASE_URL,
    DEFAULT_BYNARA_FALLBACK_DOWNLOAD_BASE_URL,
    // Host video bisa saja diarahkan ke host lain lewat env; origin-nya ikut
    // dicoba supaya konfigurasi yang menyimpang tidak langsung gagal.
    new URL(bynaraVideoBaseUrl()).origin
  ]
    .map((host) => String(host).replace(/\/+$/, ''))
    .filter((host, index, semua) => host && semua.indexOf(host) === index);

  const kandidat = [];

  for (const host of hosts) {
    const url = `${host}${path}`;
    if (!kandidat.includes(url)) kandidat.push(url);
  }

  return kandidat;
};

/** Nama host dari sebuah URL, atau URL-nya sendiri kalau tidak bisa diurai. */
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * NaraRouter (Bynara) — pembuat video asinkron.
 *
 * Mengirim permintaan, memantau statusnya, lalu mengunduh MP4-nya. Ketiganya
 * dibungkus dalam satu provider karena tidak ada gunanya menukar provider di
 * tengah jalan: job yang sudah dibuat tetap berjalan di sana dan tidak bisa
 * dipindahkan.
 */
const bynara = {
  name: 'bynara',
  label: 'NaraRouter (Agnes Video 2.0)',
  envVars: ['BYNARA_API_KEY'],
  // Kedua mode ditawarkan oleh model yang sama; mode dikirim sebagai field
  // terpisah, bukan sebagai akhiran nama model (berbeda dari model lain di
  // katalog NaraRouter yang memakai akhiran -t2v/-i2v).
  supportedModes: ALLOWED_MODES,

  isConfigured: () => isSet(process.env.BYNARA_API_KEY),

  getModel: () => bynaraModel(),

  /**
   * Buat pekerjaan video.
   *
   * text-to-video dikirim sebagai JSON, image-to-video sebagai multipart —
   * dokumentasi NaraRouter memang membedakan keduanya, dan mengirim JSON berisi
   * gambar tidak dilayani.
   *
   * @returns {Promise<{jobId: string, provider: string, model: string, status: string}>}
   */
  async createJob({ prompt, mode, imageBuffer, mimeType, resolution, ratio, duration }) {
    const model = bynaraModel();
    const base = bynaraVideoBaseUrl();
    const url = `${base}/videos`;

    let response;

    if (mode === 'i2v') {
      const form = new FormData();

      form.append('model', model);
      form.append('mode', 'i2v');
      form.append('prompt', prompt);
      form.append('resolution', resolution);
      form.append('duration', String(duration));
      // Sesuai dokumentasi: gambar i2v dikirim sebagai berkas bernama `image`.
      // Content-Type sengaja tidak disetel manual — fetch menambahkan boundary
      // multipart sendiri, dan nilai manual justru merusak berkasnya.
      form.append('image', new Blob([imageBuffer], { type: mimeType || 'image/png' }), 'first-frame');

      response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: bynaraAuthHeader(),
        body: form
      });
    } else {
      response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { ...bynaraAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, mode: 't2v', resolution, ratio, duration })
      });
    }

    const data = await readJson(response);

    if (!response.ok) {
      throw createError(
        `NaraRouter video error (HTTP ${response.status}): ${describeProviderError(data, response)}`,
        errorCodeFromStatus(response.status)
      );
    }

    // 202 Accepted: `{ id, status: "pending", created }`. Id-nya bisa muncul di
    // beberapa nama kunci tergantung versi gateway, jadi ketiganya dibaca.
    const jobId = data?.id || data?.job_id || data?.task_id;

    if (!jobId) {
      throw createError(
        `NaraRouter tidak mengembalikan id pekerjaan (kunci balasan: ${
          Object.keys(data || {}).join(', ') || 'kosong'
        })`,
        'PROVIDER_ERROR'
      );
    }

    return { jobId: String(jobId), provider: 'bynara', model, status: data?.status || 'pending' };
  },

  /**
   * Status satu pekerjaan.
   * @returns {Promise<{status: 'pending'|'completed'|'failed', url?: string, error?: string, duration?: number}>}
   */
  async getJob(jobId) {
    const response = await fetchWithTimeout(
      `${bynaraVideoBaseUrl()}/videos/${encodeURIComponent(jobId)}`,
      { headers: bynaraAuthHeader() }
    );

    const data = await readJson(response);

    if (!response.ok) {
      throw createError(
        `NaraRouter video error (HTTP ${response.status}): ${describeProviderError(data, response)}`,
        errorCodeFromStatus(response.status)
      );
    }

    const status = classifyJobStatus(data?.status);
    // URL hasil bisa ada di beberapa nama kunci: dokumentasi menyebut `url`,
    // tetapi sebagian balasan lain memakai `video_url`/`output.url`.
    const url =
      data?.url ||
      data?.video_url ||
      data?.output?.url ||
      (Array.isArray(data?.outputs) ? data.outputs[0]?.url : null) ||
      null;

    if (status === 'pending') return { status };

    if (status === 'failed' || !url) {
      return {
        status: 'failed',
        error:
          data?.error?.message ||
          data?.error ||
          data?.message ||
          `Pekerjaan video berakhir tanpa berkas hasil (status: ${data?.status ?? 'tidak dikenal'})`
      };
    }

    return { status: 'completed', url, duration: Number(data?.duration) || null };
  },

  /** Unduh MP4 hasil pekerjaan. */
  async downloadVideo(rawUrl) {
    const kegagalan = [];
    let buffer = null;

    for (const url of bynaraDownloadCandidates(rawUrl)) {
      const response = await fetchWithTimeout(url, { headers: bynaraAuthHeader() }, getTimeoutMs());

      if (response.ok) {
        buffer = Buffer.from(await response.arrayBuffer());
        break;
      }

      // 404 di satu host tidak berarti berkasnya tidak ada di host lain: itulah
      // alasan daftar kandidat ini ada.
      kegagalan.push(`${hostOf(url)} HTTP ${response.status}`);
    }

    if (!buffer) {
      throw createError(
        `NaraRouter mengirim URL video yang tidak bisa diunduh (${kegagalan.join(', ')})`,
        'PROVIDER_ERROR'
      );
    }

    if (buffer.length === 0) {
      throw createError('NaraRouter mengembalikan video kosong', 'PROVIDER_ERROR');
    }

    return buffer;
  }
};

const PROVIDERS = { bynara };
const PROVIDER_ORDER = ['bynara'];
const DEFAULT_FALLBACK_PROVIDER = 'none';

const CONFIG_ERROR_CODES = ['MISSING_CREDENTIALS', 'INVALID_PROVIDER_CONFIG', 'PROVIDER_UNSUPPORTED'];

const normalizeName = (value) => String(value || '').trim().toLowerCase();

/**
 * Urutan provider yang akan dicoba untuk satu permintaan video.
 * @returns {string[]}
 * @throws {Error} jika nama provider di env tidak dikenal
 */
const getVideoChain = () => {
  const explicit = normalizeName(process.env.VIDEO_PROVIDER);

  if (explicit === 'none') return [];

  if (explicit && !PROVIDERS[explicit]) {
    throw createError(
      `Unknown VIDEO_PROVIDER "${explicit}". Available: ${PROVIDER_ORDER.join(', ')}, none.`,
      'INVALID_PROVIDER_CONFIG'
    );
  }

  const primary = explicit || (bynara.isConfigured() ? 'bynara' : PROVIDER_ORDER[0]);
  const fallbackRaw =
    process.env.VIDEO_FALLBACK_PROVIDER === undefined
      ? DEFAULT_FALLBACK_PROVIDER
      : normalizeName(process.env.VIDEO_FALLBACK_PROVIDER);

  const chain = [primary];

  if (fallbackRaw && fallbackRaw !== 'none') {
    if (!PROVIDERS[fallbackRaw]) {
      throw createError(
        `Unknown VIDEO_FALLBACK_PROVIDER "${fallbackRaw}". Available: ` +
          `${PROVIDER_ORDER.join(', ')}, none.`,
        'INVALID_PROVIDER_CONFIG'
      );
    }

    if (!chain.includes(fallbackRaw)) chain.push(fallbackRaw);
  }

  return chain;
};

/**
 * Durasi yang dipakai kalau user tidak memilih apa pun.
 *
 * Nilainya dari env `VIDEO_DURATION` dan dijepit ke rentang provider, jadi
 * default yang mustahil (mis. 30) tetap menjadi nilai yang diterima. Ini hanya
 * nilai awal; user tetap bebas memilih 3-15 detik di halaman.
 */
const getDuration = () => {
  const nilai = Number(process.env.VIDEO_DURATION);
  if (!Number.isFinite(nilai) || nilai <= 0) return DEFAULT_DURATION;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(nilai)));
};

const getResolution = () => {
  const nilai = normalizeName(process.env.VIDEO_RESOLUTION);
  return ALLOWED_RESOLUTIONS.includes(nilai) ? nilai : DEFAULT_RESOLUTION;
};

const getRatio = () => {
  const nilai = String(process.env.VIDEO_RATIO || '').trim();
  return ALLOWED_RATIOS.includes(nilai) ? nilai : DEFAULT_RATIO;
};

/**
 * Pilihan yang sah untuk endpoint GET /media/video-options.
 *
 * Halaman text-to-video & image-to-video mengambil daftarnya dari sini supaya
 * aturan yang ditampilkan ke user (mode, resolusi, batas prompt) tidak perlu
 * disalin ulang di frontend dan tidak bisa menyimpang dari yang divalidasi
 * server — pola yang sama dengan sound-voices dan transcribe-options.
 */
const getVideoOptions = () => {
  let chain = [];
  try {
    chain = getVideoChain();
  } catch {
    chain = [];
  }

  const provider = chain[0] || PROVIDER_ORDER[0];
  const modes = ALLOWED_MODES.filter((mode) =>
    (PROVIDERS[provider]?.supportedModes || ALLOWED_MODES).includes(mode)
  );

  return {
    provider,
    model: bynaraModel(),
    modes,
    modeLabels: MODE_LABELS,
    resolutions: ALLOWED_RESOLUTIONS,
    defaultResolution: getResolution(),
    ratios: ALLOWED_RATIOS,
    defaultRatio: getRatio(),
    // Seluruh rentang 3-15 detik ditawarkan, sama seperti resolusi/rasio.
    // `defaultDuration` adalah nilai yang terpilih lebih dulu di UI.
    durations: DURATION_CHOICES,
    defaultDuration: getDuration(),
    minDuration: MIN_DURATION,
    maxDuration: MAX_DURATION,
    maxPromptLength: MAX_PROMPT_LENGTH,
    maxImageBytes: MAX_INPUT_BYTES,
    format: VIDEO_FORMAT,
    mimeType: VIDEO_MIME_TYPE,
    // Estimasi kasar: provider menyelesaikan 1-5 menit. Dipakai UI untuk
    // menyiapkan harapan user, bukan sebagai janji.
    estimatedSeconds: 120
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tunggu sampai pekerjaan selesai, lalu unduh berkasnya.
 *
 * Batas waktunya dihitung dari saat job dibuat, bukan per polling: provider yang
 * menggantung harus berakhir sebagai kegagalan yang jelas, bukan sebagai record
 * `processing` yang tidak pernah ditutup.
 *
 * @param {{provider: string, jobId: string, startedAt: number}} job
 * @param {{onPoll?: Function}} [opsi]
 */
const waitForJob = async ({ provider, jobId, startedAt }, { onPoll } = {}) => {
  const batas = startedAt + getJobTimeoutMs();
  const interval = getPollIntervalMs();
  let pollingTerakhir = null;

  while (Date.now() < batas) {
    await sleep(interval);

    const status = await PROVIDERS[provider].getJob(jobId);
    pollingTerakhir = status;

    if (onPoll) onPoll(status);

    if (status.status === 'completed') return status;

    if (status.status === 'failed') {
      throw createError(
        `Pekerjaan video gagal di ${provider}: ${status.error || 'tanpa keterangan'}`,
        'PROVIDER_ERROR'
      );
    }
  }

  throw createError(
    `Pekerjaan video tidak selesai dalam ${Math.round(getJobTimeoutMs() / 1000)} detik ` +
      `(status terakhir: ${pollingTerakhir?.status || 'pending'})`,
    'PROVIDER_TIMEOUT'
  );
};

/**
 * Buat video memakai provider pertama yang tersedia dan berhasil.
 *
 * @param {{prompt: string, mode: string, imageBuffer?: Buffer, mimeType?: string,
 *          resolution?: string, ratio?: string, duration?: number,
 *          onPoll?: Function}} params
 * @returns {Promise<{buffer: Buffer, format: string, mimeType: string, provider: string,
 *          model: string, duration: number|null, jobId: string, attempts: Array}>}
 */
const generateVideo = async ({
  prompt,
  mode,
  imageBuffer,
  mimeType,
  resolution,
  ratio,
  duration,
  onPoll
}) => {
  const chain = getVideoChain();
  const attempts = [];
  let configError = null;
  // Galat terakhir yang punya kode berarti (timeout, jaringan, kuota berbayar
  // habis) dibawa ke luar: meratakannya menjadi "provider tidak tersedia"
  // membuat satu-satunya informasi yang berguna hilang dari log dan UI.
  let lastError = null;

  if (!chain.length) {
    throw createError(
      'Video generation is disabled (VIDEO_PROVIDER=none).',
      'INVALID_PROVIDER_CONFIG'
    );
  }

  const requestedMode = mode || 't2v';
  const pakaiResolution = resolution || getResolution();
  const pakaiRatio = ratio || getRatio();
  const pakaiDuration = Number(duration) || getDuration();

  for (const name of chain) {
    const provider = PROVIDERS[name];

    if (!provider.isConfigured()) {
      attempts.push({ provider: name, reason: 'missing credentials' });
      continue;
    }

    // Provider yang tidak sanggup mode yang diminta dilewati, bukan dicoba:
    // permintaan image-to-video ke provider teks-saja akan gagal di tengah
    // jalan, dan itu terlihat sebagai kegagalan padahal provider cadangan bisa
    // melayaninya.
    if (Array.isArray(provider.supportedModes) && !provider.supportedModes.includes(requestedMode)) {
      attempts.push({ provider: name, reason: `mode ${requestedMode} is not supported` });
      continue;
    }

    try {
      const job = await provider.createJob({
        prompt,
        mode: requestedMode,
        imageBuffer,
        mimeType,
        resolution: pakaiResolution,
        ratio: pakaiRatio,
        duration: pakaiDuration
      });

      const hasil = await waitForJob(
        { provider: name, jobId: job.jobId, startedAt: Date.now() },
        { onPoll }
      );

      const buffer = await provider.downloadVideo(hasil.url);

      return {
        buffer,
        format: VIDEO_FORMAT,
        mimeType: VIDEO_MIME_TYPE,
        provider: name,
        model: job.model,
        duration: hasil.duration || pakaiDuration,
        jobId: job.jobId,
        attempts
      };
    } catch (error) {
      attempts.push({ provider: name, reason: error.message });
      lastError = error;

      // Kegagalan konfigurasi diingat dan diutamakan: menyamarkannya sebagai
      // "coba lagi" membuat user menekan tombol yang sama berulang kali untuk
      // masalah yang hanya bisa diperbaiki admin.
      if (!configError && CONFIG_ERROR_CODES.includes(error.code)) configError = error;
    }
  }

  if (configError) throw configError;

  const summary = attempts.map((item) => `${item.provider}: ${item.reason}`).join('; ');
  const nothingConfigured = chain.every((name) => !PROVIDERS[name].isConfigured());

  // Kode yang layak diteruskan: semuanya berarti "coba lagi nanti" tetapi
  // tindak lanjutnya berbeda (menunggu, menambah saldo, memeriksa jaringan).
  const KODE_LAYAK_DITERUSKAN = ['PROVIDER_TIMEOUT', 'PROVIDER_UNPAID', 'PROVIDER_NETWORK'];

  throw createError(
    `All video providers failed (${summary}). Set BYNARA_API_KEY di backend/.env ` +
      '(dipakai model agnes-video-v2.0).',
    nothingConfigured
      ? 'MISSING_CREDENTIALS'
      : KODE_LAYAK_DITERUSKAN.includes(lastError?.code)
        ? lastError.code
        : 'PROVIDER_UNAVAILABLE'
  );
};

/**
 * Ringkasan konfigurasi provider video, dipakai oleh endpoint /health.
 */
const getVideoProviderStatus = () => {
  const status = {};
  for (const [name, provider] of Object.entries(PROVIDERS)) {
    status[name] = provider.isConfigured() ? 'configured' : 'missing';
  }

  let chain = [];
  try {
    chain = getVideoChain();
  } catch {
    chain = [];
  }

  return {
    chain,
    status,
    models: Object.fromEntries(PROVIDER_ORDER.map((name) => [name, bynaraModel()])),
    // Video BEDA dari fitur lain: tidak ada provider yang bisa dipakai tanpa
    // kredensial, jadi `ready` benar-benar bisa false.
    ready: chain.some((name) => PROVIDERS[name].isConfigured()),
    modes: ALLOWED_MODES
  };
};

module.exports = {
  generateVideo,
  getVideoChain,
  getVideoProviderStatus,
  getVideoOptions,
  getDuration,
  getResolution,
  getRatio,
  classifyJobStatus,
  bynaraDownloadCandidates,
  PROVIDERS,
  PROVIDER_ORDER,
  ALLOWED_MODES,
  ALLOWED_RESOLUTIONS,
  ALLOWED_RATIOS,
  MIN_DURATION,
  MAX_DURATION,
  DEFAULT_DURATION,
  DURATION_CHOICES,
  DEFAULT_RESOLUTION,
  DEFAULT_RATIO,
  DEFAULT_BYNARA_VIDEO_MODEL,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_JOB_TIMEOUT_MS,
  MAX_PROMPT_LENGTH,
  MAX_INPUT_BYTES,
  VIDEO_FORMAT,
  VIDEO_MIME_TYPE
};
