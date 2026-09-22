/**
 * Provider Text-to-Image
 *
 * Setiap provider dibungkus ke bentuk yang sama:
 *   generate({ prompt, size, quality }) -> { buffer, format, mimeType, provider, model }
 *
 * Provider dipilih lewat env:
 *   IMAGE_PROVIDER           = bynara | cloudflare | pollinations | openai
 *   IMAGE_FALLBACK_PROVIDER  = bynara | cloudflare | pollinations | openai | none
 *
 * Default: Bynara (Agnes) kalau kuncinya ada, lalu Cloudflare Workers AI (free
 * tier) kalau kredensialnya ada, terakhir Pollinations (tanpa API key sama
 * sekali). Fallback dipakai ketika kredensial provider utama belum diisi, ukuran
 * yang diminta tidak didukung, atau provider utama sedang gagal/kuotanya habis.
 *
 * Image-to-image punya rantai sendiri dan TIDAK memakai Pollinations; lihat
 * getEditProviderChain().
 *
 * Semua provider mengembalikan Buffer, sehingga controller tidak perlu tahu
 * asal gambarnya. Tidak ada dependency baru: memakai fetch bawaan Node 18+.
 */

const {
  getOpenAIClient,
  getImageModel,
  supportsResponseFormat
} = require('./openai');

const DEFAULT_TIMEOUT_MS = 120000;
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4/accounts';
const DEFAULT_CLOUDFLARE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
// Model edit gambar (image-to-image). Menggantikan @cf/runwayml/stable-diffusion-v1-5-img2img
// yang sudah tidak ada lagi di katalog Workers AI (docs 404, hilang dari tabel harga).
// FLUX.2 [klein] menyatukan generate + edit, dan masih masuk kuota gratis
// 10.000 neurons/hari (klein-4b ±110 neurons per gambar 1024x1024 -> ±90 gambar/hari).
const DEFAULT_CLOUDFLARE_EDIT_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';

// Batas dari provider: semua gambar input untuk model klein harus < 512x512.
// Frontend sudah memperkecil gambar di browser sebelum dikirim; nilai ini
// dipakai sebagai validasi lapis kedua di server.
const MAX_EDIT_INPUT_EDGE = 512;
// Bynara (NaraRouter) menaruh endpoint gambar di host terpisah dari gateway
// chat-nya: dokumentasi menyebut https://api-images.bynara.id/v1/images/generations,
// sedangkan router.bynara.id melayani chat/embeddings/rerank. Kunci yang sama
// (berawalan `sk-nry-`) dipakai untuk keduanya.
const DEFAULT_BYNARA_BASE_URL = 'https://api-images.bynara.id/v1';
const DEFAULT_BYNARA_MODEL = 'agnes-image-2.0-flash';

// Host unduhan berbeda lagi dari host generate. Yang benar-benar terlihat di
// produksi (22 Sep 2026): generate membalas `{"url":"/v1/images/<id>/download"}`
// — path relatif tanpa host — dan path itu hanya dilayani router.bynara.id,
// bukan api-images.bynara.id (di sana 404). Unduhannya juga butuh header
// Authorization yang sama; tanpa itu gateway membalas 401.
const DEFAULT_BYNARA_DOWNLOAD_BASE_URL = 'https://router.bynara.id';
const DEFAULT_POLLINATIONS_BASE_URL = 'https://image.pollinations.ai';
const DEFAULT_POLLINATIONS_MODEL = 'flux';
const DEFAULT_FALLBACK_PROVIDER = 'pollinations';

// Batas laju Pollinations dihitung PER MODEL, bukan per alamat IP saja. Yang
// benar-benar terlihat di produksi (22 Sep 2026):
//
//   Pollinations error (HTTP 500): Gen Sana request failed with 429:
//   {"message":"Per-user limit of 300 RPM exceeded for model lykon/dreamshaper-8-lcm"}
//
// Satu model yang penuh tidak berarti model lain ikut penuh. Karena itu satu
// permintaan user dicoba ke beberapa model berurutan: permintaan pertama yang
// gagal hanya karena kuota model, bukan lagi langsung menjadi 502 di UI.
const DEFAULT_POLLINATIONS_FALLBACK_MODELS = ['turbo', 'flux-realism'];
const DEFAULT_POLLINATIONS_ATTEMPTS = 3;

// Nilai placeholder di .env.example tidak boleh dianggap konfigurasi valid.
const PLACEHOLDER_VALUES = new Set([
  'your-cloudflare-account-id',
  'your-cloudflare-api-token',
  'your-pollinations-token'
]);

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
 * `export VAR=process.env.GROQ_API_KEY`. Nilai berisi baris baru seperti itu ditolak
 * fetch (header tidak valid) dan hanya muncul sebagai "Connection error".
 *
 * Kredensial API tidak pernah mengandung spasi, jadi token pertama aman.
 */
const sanitizeSecret = (value) => String(value || '').trim().split(/\s+/)[0];

const getTimeoutMs = () =>
  Number(process.env.IMAGE_REQUEST_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

const randomSeed = () => Math.floor(Math.random() * 1000000);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const createError = (message, code) => {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
};

/**
 * @returns {{width: number, height: number}}
 * @throws {Error} jika format ukuran tidak dikenali
 */
const parseSize = (size) => {
  const [width, height] = String(size).split('x').map(Number);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw createError(`Invalid image size: ${size}`, 'INVALID_SIZE');
  }

  return { width, height };
};

/**
 * Deteksi format gambar dari magic bytes, bukan dari header Content-Type,
 * supaya nama ekstensi file yang disimpan selalu cocok dengan isinya.
 * @returns {{format: string, mimeType: string}}
 */
const detectFormat = (buffer) => {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { format: 'png', mimeType: 'image/png' };
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { format: 'jpeg', mimeType: 'image/jpeg' };
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { format: 'webp', mimeType: 'image/webp' };
  }

  // Sebagian besar provider mengirim PNG; ini hanya jaring pengaman.
  return { format: 'png', mimeType: 'image/png' };
};

/**
 * Baca dimensi asli gambar dari header-nya (PNG IHDR atau JPEG SOFn).
 *
 * Ini perlu karena provider tidak selalu menghormati ukuran yang diminta —
 * FLUX di Pollinations, misalnya, mengembalikan gambar yang lebih kecil. Tanpa
 * pengukuran ini metadata riwayat akan melaporkan ukuran yang keliru.
 *
 * @returns {{width: number, height: number}|null} null jika header tak dikenali
 */
const measureImage = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 11) return null;

  // PNG: signature diikuti chunk IHDR yang memuat width & height
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (buffer.length < 24 || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
      return null;
    }

    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // JPEG: telusuri segmen sampai menemukan marker SOF (0xC0-0xCF, kecuali C4/C8/CC)
  let offset = 2;

  while (offset + 4 <= buffer.length) {
    // Lewati byte filler 0xFF yang menyusun ulang marker
    if (buffer[offset] !== 0xff || buffer[offset + 1] === 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];

    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      // Tinggi & lebar ada di 5 dan 7 byte setelah awal marker
      if (offset + 9 > buffer.length) return null;

      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;

    offset += 2 + segmentLength;
  }

  return null;
};

/**
 * Terjemahkan kegagalan fetch menjadi pesan yang bisa ditindaklanjuti.
 *
 * Saat koneksi gagal di level jaringan (DNS salah, koneksi putus, TLS ditolak),
 * Node hanya memberi pesan "fetch failed" dan menaruh sebab sebenarnya di
 * `error.cause`. Tanpa meneruskan cause, operator tidak bisa membedakan
 * kredensial salah dari gangguan jaringan — dan gangguan jaringan seperti ini
 * bisa datang sesaat, jadi menandainya dengan kode sendiri membuatnya bisa
 * ditangani berbeda di controller.
 */
const describeFetchFailure = (error) => {
  const cause = error.cause || {};
  const detail = [cause.code, cause.message, cause.hostname]
    .filter((part) => part && String(part).trim() !== '')
    .join(' · ');

  return detail ? `${error.message || 'fetch failed'} (${detail})` : error.message || 'fetch failed';
};

const fetchWithTimeout = async (url, options = {}) => {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(getTimeoutMs())
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw createError(
        `Request to image provider timed out after ${getTimeoutMs()} ms`,
        'PROVIDER_TIMEOUT'
      );
    }

    throw createError(describeFetchFailure(error), 'PROVIDER_NETWORK');
  }
};

/**
 * Baca body sebagai JSON tanpa meledak kalau provider mengirim HTML/teks.
 */
const readJson = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

/**
 * Cari kandidat base64 terpanjang di dalam teks.
 * Dipakai sebagai jaring pengaman kalau provider membalas multipart, bukan JSON.
 */
const MIN_BASE64_CANDIDATE_LENGTH = 100;

const extractBase64Candidate = (text) => {
  const kandidat = String(text).match(
    new RegExp(`[A-Za-z0-9+/=]{${MIN_BASE64_CANDIDATE_LENGTH},}`, 'g')
  ) || [];
  if (!kandidat.length) return null;

  return kandidat.sort((a, b) => b.length - a.length)[0];
};

/**
 * Apakah buffer benar-benar gambar (dicek dari magic bytes)?
 * `detectFormat` punya nilai default png, jadi hasilnya tidak boleh dipercaya
 * tanpa pemeriksaan ini.
 */
const looksLikeImage = (buffer) => {
  // Batas 3 byte karena JPEG hanya butuh SOI + awal marker; pemeriksaan WEBP
  // punya guard panjangnya sendiri.
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return false;

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return true;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return true;
  }

  return false;
};

/**
 * Baca pesan error yang berguna dari respons provider yang gagal.
 */
const describeProviderError = (data, response) => {
  const fromArray = Array.isArray(data?.errors)
    ? data.errors.map((item) => item?.message).filter(Boolean).join('; ')
    : '';

  return (
    fromArray ||
    data?.error?.message ||
    data?.message ||
    (data?.raw ? String(data.raw).slice(0, 200) : '') ||
    `HTTP ${response.status}`
  );
};

/**
 * Ambil base64 gambar dari respons Cloudflare Workers AI.
 *
 * Normalnya JSON (`result.image`), tapi sebagian model gambar bisa membalas
 * multipart/form-data. Untuk itu ada jaring pengaman: cari blok base64 terpanjang
 * di body lalu pastikan hasilnya benar-benar gambar.
 *
 * @returns {Promise<string>} base64 gambar
 */
const readCloudflareImage = async (response) => {
  // `headers` dijaga opsional supaya fungsi ini tetap bisa diuji dengan
  // respons tiruan yang hanya menyediakan body.
  const contentType = response.headers?.get?.('content-type') || '';
  const text = await response.text();
  const isJson = contentType.includes('json') || text.trimStart().startsWith('{');

  if (isJson) {
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    const base64 = typeof data.result === 'string' ? data.result : data.result?.image;

    if (!response.ok || data.success === false || !base64) {
      throw createError(
        `Cloudflare Workers AI error: ${describeProviderError(data, response)}`,
        'PROVIDER_ERROR'
      );
    }

    return base64;
  }

  if (!response.ok) {
    throw createError(
      `Cloudflare Workers AI error (HTTP ${response.status}): ${text.slice(0, 200)}`,
      'PROVIDER_ERROR'
    );
  }

  const candidate = extractBase64Candidate(text);

  if (!candidate) {
    throw createError(
      `Cloudflare Workers AI mengirim balasan ${contentType || 'tanpa content-type'} tanpa data gambar`,
      'PROVIDER_ERROR'
    );
  }

  return candidate;
};

/**
 * Cloudflare Workers AI — FLUX.1 [schnell] (tersedia di free tier).
 * Gratis 10.000 Neurons/hari; satu gambar 1024x1024 ±154 neurons.
 */
const cloudflare = {
  name: 'cloudflare',
  label: 'Cloudflare Workers AI (FLUX)',
  envVars: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  // FLUX.1 [schnell] di Workers AI memakai ukuran keluaran tetap 1024x1024,
  // jadi permintaan non-square diteruskan ke provider berikutnya.
  supportedSizes: ['1024x1024'],

  isConfigured: () =>
    isSet(process.env.CLOUDFLARE_ACCOUNT_ID) && isSet(process.env.CLOUDFLARE_API_TOKEN),

  async generate({ prompt }) {
    const accountId = sanitizeSecret(process.env.CLOUDFLARE_ACCOUNT_ID);
    const model = process.env.CLOUDFLARE_IMAGE_MODEL || DEFAULT_CLOUDFLARE_MODEL;
    const steps = Number(process.env.CLOUDFLARE_IMAGE_STEPS) || 4;

    const response = await fetchWithTimeout(
      `${CLOUDFLARE_API_BASE}/${accountId}/ai/run/${model}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sanitizeSecret(process.env.CLOUDFLARE_API_TOKEN)}`,
          'Content-Type': 'application/json'
        },
        // Hanya `prompt` dan `steps` yang diterima model ini. Mengirim `seed`
        // membuat Workers AI menolak request dengan "Additional or unevaluated
        // properties '/seed' at '/' not allowed" — kegagalan itu dulu tersamar
        // sebagai fallback ke Pollinations, sehingga gambar yang keluar selalu
        // 768x768 dari provider publik padahal kredensial Cloudflare sudah ada.
        body: JSON.stringify({ prompt, steps })
      }
    );

    const data = await readJson(response);
    // REST API membungkus hasilnya: { result: { image: "<base64>" } }
    const base64 = typeof data.result === 'string' ? data.result : data.result?.image;

    if (!response.ok || data.success === false || !base64) {
      throw createError(
        `Cloudflare Workers AI error: ${describeProviderError(data, response)}`,
        'PROVIDER_ERROR'
      );
    }

    const buffer = Buffer.from(base64, 'base64');
    return { buffer, ...detectFormat(buffer), provider: 'cloudflare', model };
  },

  /**
   * Image-to-image: FLUX.2 [klein] menerima prompt + gambar acuan.
   * Endpoint ini WAJIB multipart/form-data (bahkan untuk prompt saja), dan
   * gambar input dikirim sebagai biner pada field input_image_0 (maks 4 gambar).
   */
  async edit({ prompt, imageBuffer, mimeType, size, guidance }) {
    const accountId = sanitizeSecret(process.env.CLOUDFLARE_ACCOUNT_ID);
    const model = process.env.CLOUDFLARE_EDIT_MODEL || DEFAULT_CLOUDFLARE_EDIT_MODEL;
    const { width, height } = parseSize(size);

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('width', String(width));
    form.append('height', String(height));
    form.append('seed', String(randomSeed()));

    if (Number.isFinite(Number(guidance))) {
      form.append('guidance', String(Number(guidance)));
    }

    form.append(
      'input_image_0',
      new Blob([imageBuffer], { type: mimeType || 'image/png' }),
      'input-image'
    );

    const response = await fetchWithTimeout(
      `${CLOUDFLARE_API_BASE}/${accountId}/ai/run/${model}`,
      {
        method: 'POST',
        // Content-Type sengaja tidak diisi manual: fetch menambahkan boundary
        // multipart yang benar. Menyetelnya sendiri membuat body tidak terbaca.
        headers: {
          Authorization: `Bearer ${sanitizeSecret(process.env.CLOUDFLARE_API_TOKEN)}`
        },
        body: form
      }
    );

    const base64 = await readCloudflareImage(response);
    const buffer = Buffer.from(base64, 'base64');

    if (!looksLikeImage(buffer)) {
      throw createError(
        'Cloudflare Workers AI returned data that is not a valid image',
        'PROVIDER_ERROR'
      );
    }

    return { buffer, ...detectFormat(buffer), provider: 'cloudflare', model };
  }
};

/**
 * Kumpulkan kandidat gambar dari balasan gateway.
 *
 * Bentuk balasan gateway tidak dijamin satu rupa: dokumentasi Agnes menunjukkan
 * `data[0].url` / `data[0].b64_json`, tapi gateway di depannya bisa membungkusnya
 * sebagai `images[0].url` atau sebagai bagian multimodal di `choices[].message`.
 * Menerima semuanya lebih murah daripada menebak satu bentuk lalu gagal tanpa
 * penjelasan saat provider mengganti bungkusnya.
 *
 * @returns {{urls: string[], base64: string[]}}
 */
const readGatewayImages = (data) => {
  const items = [];

  for (const key of ['data', 'images', 'output']) {
    if (Array.isArray(data?.[key])) items.push(...data[key]);
  }

  if (Array.isArray(data?.choices)) {
    for (const pilihan of data.choices) {
      const isi = pilihan?.message?.images ?? pilihan?.message?.content;
      if (Array.isArray(isi)) items.push(...isi);
    }
  }

  const urls = [];
  const base64 = [];

  for (const item of items) {
    if (typeof item === 'string') {
      // Data URI base64 ikut masuk ke sini, jadi dipisahkan dari URL biasa.
      if (item.startsWith('data:')) base64.push(item.slice(item.indexOf(',') + 1));
      // Gateway bisa membalas path relatif (".../download" tanpa host), jadi
      // string yang diawali "/" ikut dianggap URL dan dipecah hostnya nanti.
      else if (/^https?:\/\//i.test(item) || item.startsWith('/')) urls.push(item);
      continue;
    }

    if (typeof item?.b64_json === 'string') base64.push(item.b64_json);
    if (typeof item?.url === 'string') urls.push(item.url);
    if (typeof item?.image_url?.url === 'string') urls.push(item.image_url.url);
    if (typeof item?.image?.url === 'string') urls.push(item.image.url);
  }

  return { urls, base64 };
};

/**
 * Bynara Images (Agnes) — gambar dari prompt lewat gateway OpenAI-compatible.
 *
 * Balasannya bisa berupa URL atau base64; kalau URL, berkasnya diunduh di sini
 * supaya controller tetap menerima Buffer seperti provider lain (dan supaya URL
 * sementara milik gateway tidak ikut tersimpan sebagai hasil akhir).
 */
/**
 * URL gambar dari Bynara sering datang sebagai path relatif, dan host yang
 * melayaninya berbeda dari host generate. Fungsi ini mengubahnya menjadi daftar
 * URL absolut untuk dicoba berurutan: host unduhan lebih dulu, lalu host
 * generate sebagai cadangan.
 *
 * @param {string} raw nilai `url` dari balasan gateway
 * @returns {string[]} minimal satu URL absolut
 */
const bynaraDownloadCandidates = (raw) => {
  if (/^https?:\/\//i.test(raw)) return [raw];

  const path = raw.startsWith('/') ? raw : `/${raw}`;
  const hosts = [
    process.env.BYNARA_DOWNLOAD_BASE_URL || DEFAULT_BYNARA_DOWNLOAD_BASE_URL,
    process.env.BYNARA_BASE_URL || DEFAULT_BYNARA_BASE_URL
  ].map((host) => String(host).replace(/\/+$/, '').replace(/\/v1$/, ''));

  const kandidat = [];

  for (const host of hosts) {
    const url = `${host}${path}`;
    if (!kandidat.includes(url)) kandidat.push(url);
  }

  return kandidat;
};

const bynaraAuthHeader = () => ({
  Authorization: `Bearer ${sanitizeSecret(process.env.BYNARA_API_KEY)}`
});

const bynaraBaseUrl = () =>
  (process.env.BYNARA_BASE_URL || DEFAULT_BYNARA_BASE_URL).replace(/\/+$/, '');

const bynaraModel = () => process.env.BYNARA_IMAGE_MODEL || DEFAULT_BYNARA_MODEL;

/**
 * Balasan gateway — generate maupun edit — berbentuk sama: `data[]` yang setiap
 * itemnya memuat `url` atau `b64_json`. Fungsi ini mengubahnya menjadi Buffer
 * supaya controller menerima bentuk yang sama seperti provider lain.
 */
const readBynaraImage = async (data, model) => {
  const { urls, base64 } = readGatewayImages(data);

  if (!urls.length && !base64.length) {
    throw createError(
      `Bynara tidak mengembalikan gambar (kunci balasan: ${Object.keys(data).join(', ') || 'kosong'})`,
      'PROVIDER_ERROR'
    );
  }

  // Base64 dipakai lebih dulu: tidak perlu permintaan kedua, dan hasilnya tidak
  // bergantung pada masa berlaku URL milik gateway.
  let buffer;

  if (base64.length) {
    buffer = Buffer.from(base64[0], 'base64');
  } else {
    const kegagalan = [];

    for (const url of bynaraDownloadCandidates(urls[0])) {
      const unduhan = await fetchWithTimeout(url, { headers: bynaraAuthHeader() });

      if (unduhan.ok) {
        buffer = Buffer.from(await unduhan.arrayBuffer());
        break;
      }

      kegagalan.push(`${new URL(url).host} HTTP ${unduhan.status}`);
    }

    if (!buffer) {
      throw createError(
        `Bynara mengirim URL gambar yang tidak bisa diunduh (${kegagalan.join(', ')})`,
        'PROVIDER_ERROR'
      );
    }
  }

  if (!looksLikeImage(buffer)) {
    throw createError(
      'Bynara mengembalikan data yang bukan gambar yang valid',
      'PROVIDER_ERROR'
    );
  }

  return {
    buffer,
    ...detectFormat(buffer),
    provider: 'bynara',
    model,
    revisedPrompt: data?.data?.[0]?.revised_prompt || null
  };
};

const bynara = {
  name: 'bynara',
  label: 'Bynara Images (Agnes)',
  envVars: ['BYNARA_API_KEY'],
  supportedSizes: null,

  isConfigured: () => isSet(process.env.BYNARA_API_KEY),

  async generate({ prompt, size }) {
    const model = bynaraModel();

    const response = await fetchWithTimeout(`${bynaraBaseUrl()}/images/generations`, {
      method: 'POST',
      headers: { ...bynaraAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size })
    });

    const data = await readJson(response);

    if (!response.ok) {
      throw createError(
        `Bynara error (HTTP ${response.status}): ${describeProviderError(data, response)}`,
        'PROVIDER_ERROR'
      )
    }

    return readBynaraImage(data, model);
  },

  /**
   * Image-to-image memakai endpoint edit gateway yang sama-sama OpenAI-compatible.
   *
   * Bedanya: endpoint ini hanya menerima **multipart**, bukan JSON. Percobaan
   * dengan JSON — baik `image` berisi data URL maupun `image_b64` — dibalas
   * `400 {"type":"bad_request","message":"Invalid image edit request."}`,
   * sedangkan multipart dengan `image` sebagai berkas dilayani normal. Jadi
   * pengiriman berkasnya jangan diubah ke JSON.
   */
  async edit({ prompt, imageBuffer, mimeType, size }) {
    const model = bynaraModel();
    const tipe = mimeType || 'image/png';
    const form = new FormData();

    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append(
      'image',
      new Blob([imageBuffer], { type: tipe }),
      `input.${String(tipe).split('/')[1] || 'png'}`
    );

    const response = await fetchWithTimeout(`${bynaraBaseUrl()}/images/edits`, {
      method: 'POST',
      // Content-Type sengaja tidak diisi: fetch menambahkan boundary multipart
      // sendiri, dan nilai manual justru merusak berkas yang dikirim.
      headers: bynaraAuthHeader(),
      body: form
    });

    const data = await readJson(response);

    if (!response.ok) {
      throw createError(
        `Bynara error (HTTP ${response.status}): ${describeProviderError(data, response)}`,
        'PROVIDER_ERROR'
      );
    }

    return readBynaraImage(data, model);
  }
};

/**
 * Daftar model yang dicoba berurutan untuk satu permintaan Pollinations.
 *
 * Model pertama dari `POLLINATIONS_MODEL` (bawaan `flux`), lalu cadangannya.
 * `POLLINATIONS_FALLBACK_MODELS=none` mematikan rotasi; daftar juga dibatasi
 * `POLLINATIONS_ATTEMPTS` supaya jumlah percobaan tetap terkendali.
 *
 * @returns {string[]} minimal satu nama model
 */
const getPollinationsModels = () => {
  const utama = String(process.env.POLLINATIONS_MODEL || DEFAULT_POLLINATIONS_MODEL).trim();
  const cadanganMentah =
    process.env.POLLINATIONS_FALLBACK_MODELS === undefined
      ? DEFAULT_POLLINATIONS_FALLBACK_MODELS.join(',')
      : process.env.POLLINATIONS_FALLBACK_MODELS;

  const cadangan = String(cadanganMentah)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && item !== 'none');

  const maks = Number(process.env.POLLINATIONS_ATTEMPTS) || DEFAULT_POLLINATIONS_ATTEMPTS;

  return [utama, ...cadangan]
    .filter((item, index, semua) => semua.indexOf(item) === index)
    .slice(0, Math.max(1, maks));
};

/**
 * Satu permintaan gambar ke Pollinations untuk satu model.
 *
 * Dipisah dari provider supaya percobaan ke model berikutnya benar-benar
 * memakai seed baru, bukan mengulang URL yang sama.
 *
 * @returns {Promise<{buffer: Buffer, format: string, mimeType: string, provider: string, model: string}>}
 */
const requestPollinationsImage = async ({ baseUrl, prompt, model, width, height }) => {
  const url = new URL(`${baseUrl}/prompt/${encodeURIComponent(prompt)}`);
  url.searchParams.set('width', String(width));
  url.searchParams.set('height', String(height));
  url.searchParams.set('model', model);
  url.searchParams.set('nologo', 'true');
  url.searchParams.set('seed', String(randomSeed()));

  if (isSet(process.env.POLLINATIONS_TOKEN)) {
    url.searchParams.set('token', sanitizeSecret(process.env.POLLINATIONS_TOKEN));
  }

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw createError(
      `Pollinations error (HTTP ${response.status}): ${
        detail.slice(0, 200) || response.statusText
      }`,
      'PROVIDER_ERROR'
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length === 0) {
    throw createError('Pollinations returned an empty image', 'PROVIDER_ERROR');
  }

  return { buffer, ...detectFormat(buffer), provider: 'pollinations', model };
};

/**
 * Pollinations — FLUX publik, tanpa API key (fallback terakhir yang selalu ada).
 * Token bersifat opsional dan hanya menaikkan limit.
 */
const pollinations = {
  name: 'pollinations',
  label: 'Pollinations (FLUX, tanpa API key)',
  envVars: [],
  supportedSizes: null, // semua ukuran didukung lewat parameter width/height

  isConfigured: () => true,

  async generate({ prompt, size }) {
    const baseUrl = (process.env.POLLINATIONS_BASE_URL || DEFAULT_POLLINATIONS_BASE_URL)
      .replace(/\/+$/, '');
    const { width, height } = parseSize(size);
    const models = getPollinationsModels();
    const kegagalan = [];

    for (const model of models) {
      try {
        return await requestPollinationsImage({ baseUrl, prompt, model, width, height });
      } catch (error) {
        // Termasuk kuota model yang habis (HTTP 500/429 dari Pollinations):
        // model berikutnya punya jatah sendiri, jadi masih layak dicoba.
        kegagalan.push(`${model}: ${error.message}`);
      }
    }

    throw createError(
      `Pollinations gagal di ${models.length} model (${kegagalan.join('; ')})`,
      'PROVIDER_ERROR'
    );
  },

};

/**
 * OpenAI Images (DALL·E) — provider berbayar, dipakai kalau OPENAI_API_KEY diisi
 * dan IMAGE_PROVIDER diarahkan ke sini.
 */
const openai = {
  name: 'openai',
  label: 'OpenAI Images (DALL·E)',
  envVars: ['OPENAI_API_KEY'],
  supportedSizes: ['1024x1024', '1792x1024', '1024x1792'],

  isConfigured: () => isSet(process.env.OPENAI_API_KEY),

  async generate({ prompt, size, quality }) {
    const model = getImageModel();
    const params = { model, prompt, n: 1, size };

    // Parameter quality hanya dikenal model dall-e-*
    if (supportsResponseFormat(model)) {
      params.quality = quality;
      params.response_format = 'b64_json';
    }

    const response = await getOpenAIClient().images.generate(params);
    const image = response?.data?.[0];

    if (!image?.b64_json) {
      throw createError(
        'OpenAI did not return image data in base64 format',
        'PROVIDER_ERROR'
      );
    }

    const buffer = Buffer.from(image.b64_json, 'base64');
    return {
      buffer,
      ...detectFormat(buffer),
      provider: 'openai',
      model,
      revisedPrompt: image.revised_prompt || null
    };
  }
};

const PROVIDERS = { bynara, cloudflare, pollinations, openai };
const PROVIDER_NAMES = Object.keys(PROVIDERS);
// Provider yang bisa dipakai untuk image-to-image.
//
// Pollinations sengaja TIDAK ada di sini. Ia memang bisa menerima `image=` di
// URL-nya, tapi hasilnya sering hanya gambar baru dari prompt (mirip, bukan
// hasil edit yang mengikuti gambar input), dan kalau URL inputnya tidak
// terjangkau ia tetap membalas HTTP 200 seolah berhasil. Dua provider di bawah
// bekerja dari bytes gambar yang diunggah user, jadi hasilnya benar-benar
// bersandar pada gambar input.
const EDIT_PROVIDER_NAMES = PROVIDER_NAMES.filter((name) => typeof PROVIDERS[name].edit === 'function');
const DEFAULT_EDIT_FALLBACK_PROVIDER = 'cloudflare';

const normalizeName = (value) => String(value || '').trim().toLowerCase();

/**
 * Provider utama saat IMAGE_PROVIDER tidak diisi:
 * mana pun yang kredensialnya sudah tersedia, terakhir Pollinations.
 */
const resolveDefaultPrimary = () => {
  // Bynara didahulukan karena hanya dipasang sengaja lewat BYNARA_API_KEY;
  // provider lain punya kredensial yang bisa tertinggal dari percobaan lama.
  if (bynara.isConfigured()) return 'bynara';
  if (cloudflare.isConfigured()) return 'cloudflare';
  if (openai.isConfigured()) return 'openai';
  return 'pollinations';
};

/**
 * Urutan provider yang akan dicoba untuk satu request.
 * @returns {string[]}
 * @throws {Error} jika nama provider di env tidak dikenal
 */
const getProviderChain = () => {
  const primary =
    normalizeName(process.env.IMAGE_PROVIDER) || resolveDefaultPrimary();

  if (!PROVIDERS[primary]) {
    throw createError(
      `Unknown IMAGE_PROVIDER "${primary}". Available: ${PROVIDER_NAMES.join(', ')}.`,
      'INVALID_PROVIDER_CONFIG'
    );
  }

  const fallback =
    process.env.IMAGE_FALLBACK_PROVIDER === undefined
      ? DEFAULT_FALLBACK_PROVIDER
      : normalizeName(process.env.IMAGE_FALLBACK_PROVIDER);

  const chain = [primary];

  if (fallback && fallback !== 'none') {
    if (!PROVIDERS[fallback]) {
      throw createError(
        `Unknown IMAGE_FALLBACK_PROVIDER "${fallback}". Available: ${PROVIDER_NAMES.join(', ')}, none.`,
        'INVALID_PROVIDER_CONFIG'
      );
    }

    if (!chain.includes(fallback)) chain.push(fallback);
  }

  return chain;
};

/**
 * Generate gambar memakai provider pertama yang tersedia dan berhasil.
 *
 * Provider yang kredensialnya belum diisi, ukurannya tidak didukung, atau
 * sedang gagal akan dilewati — daftar percobaan dikembalikan di `attempts`
 * supaya bisa disimpan untuk debugging.
 *
 * @returns {Promise<{buffer: Buffer, format: string, mimeType: string, provider: string, model: string, attempts: Array}>}
 */
const generateImage = async ({ prompt, size, quality }) => {
  const chain = getProviderChain();
  const attempts = [];

  for (const name of chain) {
    const provider = PROVIDERS[name];

    if (!provider.isConfigured()) {
      attempts.push({ provider: name, reason: 'missing credentials' });
      continue;
    }

    if (Array.isArray(provider.supportedSizes) && !provider.supportedSizes.includes(size)) {
      attempts.push({ provider: name, reason: `size ${size} is not supported` });
      continue;
    }

    try {
      const result = await provider.generate({ prompt, size, quality });
      // Dimensi diambil dari gambar yang benar-benar diterima, bukan dari request.
      const dimensions = measureImage(result.buffer) || {};

      return { ...result, ...dimensions, attempts };
    } catch (error) {
      attempts.push({ provider: name, reason: error.message });
    }
  }

  const summary = attempts.map((item) => `${item.provider}: ${item.reason}`).join('; ');
  const nothingConfigured =
    chain.length > 0 && chain.every((name) => !PROVIDERS[name].isConfigured());

  throw createError(
    `All image providers failed (${summary}). Set BYNARA_API_KEY (Agnes) or ` +
      'CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (free), or IMAGE_PROVIDER=pollinations ' +
      '(no key required) in backend/.env.',
    nothingConfigured ? 'MISSING_CREDENTIALS' : 'PROVIDER_UNAVAILABLE'
  );
};

/**
 * Urutan provider untuk image-to-image (image edit).
 * Dipisah dari text-to-image karena kredensial & modelnya berbeda.
 *
 * Provider edit dipilih dari yang bisa bekerja tanpa mengambil gambar input
 * dari internet (semuanya menerima bytes hasil unggahan frontend), jadi rantai
 * ini tidak bergantung pada penyimpanan remote atau PUBLIC_BASE_URL.
 */
const getEditProviderChain = () => {
  const requested = normalizeName(process.env.IMAGE_EDIT_PROVIDER);

  if (requested && !EDIT_PROVIDER_NAMES.includes(requested)) {
    throw createError(
      `Unknown IMAGE_EDIT_PROVIDER "${requested}". Available: ${EDIT_PROVIDER_NAMES.join(', ')}.`,
      'INVALID_PROVIDER_CONFIG'
    );
  }

  // Bynara didahulukan lewat `resolveDefaultPrimary()` saat kuncinya ada; kalau
  // tidak, provider edit pertama yang tersedia (cloudflare) yang dipakai.
  const preferred = requested || resolveDefaultPrimary();
  const primary = EDIT_PROVIDER_NAMES.includes(preferred)
    ? preferred
    : EDIT_PROVIDER_NAMES[0] || null;
  const chain = primary ? [primary] : [];

  const fallbackRaw =
    process.env.IMAGE_EDIT_FALLBACK_PROVIDER === undefined
      ? DEFAULT_EDIT_FALLBACK_PROVIDER
      : normalizeName(process.env.IMAGE_EDIT_FALLBACK_PROVIDER);

  if (!fallbackRaw || fallbackRaw === 'none') return chain;

  if (!EDIT_PROVIDER_NAMES.includes(fallbackRaw)) {
    throw createError(
      `Unknown IMAGE_EDIT_FALLBACK_PROVIDER "${fallbackRaw}". Available: ` +
        `${EDIT_PROVIDER_NAMES.join(', ')}, none.`,
      'INVALID_PROVIDER_CONFIG'
    );
  }

  if (!chain.includes(fallbackRaw)) {
    chain.push(fallbackRaw);
  }

  return chain;
};

/**
 * Edit gambar (image-to-image) memakai provider pertama yang tersedia dan berhasil.
 *
 * @param {{prompt: string, imageBuffer: Buffer, mimeType: string, size: string,
 *          guidance?: number}} params
 * @returns {Promise<{buffer: Buffer, format: string, mimeType: string, provider: string, model: string, attempts: Array}>}
 */
const editImage = async ({ prompt, imageBuffer, mimeType, size, guidance }) => {
  const chain = getEditProviderChain();
  const attempts = [];

  // Tidak ada provider edit yang bisa dipakai: jelaskan sebabnya, jangan
  // mencoba apa pun.
  if (!chain.length) {
    throw createError(
      'No image edit provider is available. Set BYNARA_API_KEY (Agnes) atau ' +
        'CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (free, dipakai FLUX.2 [klein]) ' +
        'di backend/.env.',
      'MISSING_CREDENTIALS'
    );
  }

  for (const name of chain) {
    const provider = PROVIDERS[name];

    if (!provider.isConfigured()) {
      attempts.push({ provider: name, reason: 'missing credentials' });
      continue;
    }

    try {
      const result = await provider.edit({ prompt, imageBuffer, mimeType, size, guidance });
      const dimensions = measureImage(result.buffer) || {};

      return { ...result, ...dimensions, attempts };
    } catch (error) {
      attempts.push({ provider: name, reason: error.message });
      // Error konfigurasi (mis. provider salah tulis di env) tidak akan membaik
      // kalau dicoba provider lain.
      if (error.code === 'INVALID_PROVIDER_CONFIG') throw error;
    }
  }

  const summary = attempts.map((item) => `${item.provider}: ${item.reason}`).join('; ');
  const nothingConfigured =
    chain.length > 0 && chain.every((name) => !PROVIDERS[name].isConfigured());

  throw createError(
    `All image edit providers failed (${summary}). Set BYNARA_API_KEY (Agnes) atau ` +
      'CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (free, dipakai FLUX.2 [klein]) ' +
      'di backend/.env.',
    nothingConfigured ? 'MISSING_CREDENTIALS' : 'PROVIDER_UNAVAILABLE'
  );
};

/**
 * Ringkasan konfigurasi provider, dipakai oleh endpoint /health.
 */
const getProviderStatus = () => {
  const status = {};
  for (const [name, provider] of Object.entries(PROVIDERS)) {
    status[name] = provider.isConfigured() ? 'configured' : 'missing';
  }

  let chain = [];
  try {
    chain = getProviderChain();
  } catch {
    chain = [];
  }

  let editChain = [];
  try {
    editChain = getEditProviderChain();
  } catch {
    editChain = [];
  }

  return {
    chain,
    status,
    defaultPrimary: resolveDefaultPrimary(),
    editChain,
    editCapabilities: Object.fromEntries(
      PROVIDER_NAMES.map((name) => [name, typeof PROVIDERS[name].edit === 'function'])
    ),
    // Apakah image-to-image benar-benar bisa dijalankan sekarang? Berguna untuk
    // menjawab "kenapa fitur ini gagal" hanya dari /health.
    editReady: editChain.some((name) => PROVIDERS[name].isConfigured())
  };
};

module.exports = {
  generateImage,
  editImage,
  getProviderChain,
  getEditProviderChain,
  getProviderStatus,
  resolveDefaultPrimary,
  parseSize,
  detectFormat,
  measureImage,
  looksLikeImage,
  PROVIDERS,
  PROVIDER_NAMES,
  EDIT_PROVIDER_NAMES,
  DEFAULT_FALLBACK_PROVIDER,
  DEFAULT_EDIT_FALLBACK_PROVIDER,
  DEFAULT_CLOUDFLARE_EDIT_MODEL,
  MAX_EDIT_INPUT_EDGE
};
