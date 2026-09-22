/**
 * Controller: Media
 * Fitur AI multimodal berbasis gambar.
 *
 * text-to-image:
 *   1. validasi prompt & ukuran
 *   2. buat record MediaContent (status: processing)
 *   3. minta gambar dari provider yang aktif (lihat config/imageProviders.js)
 *   4. simpan gambar ke penyimpanan media (object storage bila dikonfigurasi,
 *      kalau tidak ke folder uploads/) dan update record (status: completed)
 *   5. kurangi quota user (hanya jika berhasil)
 *
 * image-to-image:
 *   1. validasi prompt + gambar input (base64 data URL dari browser)
 *   2. simpan gambar input ke uploads/ agar riwayat bisa menampilkan sebelum/sesudah
 *   3. minta provider melakukan edit (FLUX.2 [klein] di Cloudflare)
 *   4. simpan hasil & update record, lalu kurangi quota user
 *
 * Provider gambar bisa ditukar lewat env IMAGE_PROVIDER / IMAGE_FALLBACK_PROVIDER,
 * jadi controller ini tidak bergantung pada satu vendor saja.
 */

const MediaContent = require('../models/MediaContent');
const {
  putObject,
  removeByReference,
  removeByUrl,
  isRemoteStorage,
  isStorageConfigError
} = require('../config/storage');
const {
  generateImage,
  editImage,
  detectFormat,
  measureImage,
  looksLikeImage,
  MAX_EDIT_INPUT_EDGE
} = require('../config/imageProviders');

// Ukuran yang didukung frontend. Provider yang tidak sanggup memenuhi ukuran
// tertentu akan dilewati otomatis (lihat supportedSizes di imageProviders.js).
const ALLOWED_SIZES = ['1024x1024', '1792x1024', '1024x1792'];
const DEFAULT_SIZE = '1024x1024';
const ALLOWED_QUALITIES = ['standard', 'hd'];
const MAX_PROMPT_LENGTH = 1000;

// Kode galat provider gambar yang berarti masalah konfigurasi server, bukan
// masalah sesaat. Kegagalan penyimpanan ditambahkan terpisah lewat
// isStorageConfigError(), karena kredensial penyimpanan yang ditolak juga tidak
// akan membaik dengan mengulang permintaan.
const CONFIG_ERROR_CODES = ['MISSING_CREDENTIALS', 'INVALID_PROVIDER_CONFIG'];
const EDIT_CONFIG_ERROR_CODES = [...CONFIG_ERROR_CODES, 'PROVIDER_UNSUPPORTED'];

/**
 * Pesan untuk kegagalan yang berasal dari konfigurasi penyimpanan server.
 *
 * Sengaja TIDAK memakai pesan mentah providernya: pesan Cloudinary menyebut
 * nama cloud, dan bagi user itu tidak bisa ditindaklanjuti. Rinciannya tetap
 * masuk ke log server, sedangkan user diberi tahu dengan jujur bahwa mencoba
 * lagi tidak akan menolong — supaya tidak menekan tombol yang sama berulang kali.
 */
const storageConfigMessage = (error) => {
  const sebab =
    {
      STORAGE_NOT_CONFIGURED: 'kredensialnya belum diisi',
      STORAGE_CREDENTIALS_REJECTED: 'kredensial server ditolak oleh penyimpanan',
      STORAGE_BUCKET_NOT_FOUND: 'bucket atau nama cloud-nya tidak ditemukan'
    }[error.code] || 'konfigurasinya tidak valid';

  return (
    `Media storage is not configured correctly on the server (${sebab}). ` +
    'Retrying will not help — please contact the administrator.'
  );
};

/**
 * Susun status HTTP + body untuk satu kegagalan.
 *
 * Bedanya penting: masalah konfigurasi server dijawab 503 dan diveritahukan apa
 * adanya, sedangkan kegagalan provider yang bersifat sementara tetap 502 dengan
 * ajakan mencoba lagi.
 */
const buildFailureResponse = (error, { configCodes, defaultMessage }) => {
  const penyimpanan = isStorageConfigError(error);
  const isConfigError = penyimpanan || configCodes.includes(error.code);

  return {
    status: isConfigError ? 503 : 502,
    body: {
      success: false,
      message: penyimpanan
        ? storageConfigMessage(error)
        : isConfigError
          ? error.message
          : defaultMessage,
      error: error.message
    }
  };
};

const parseSize = (size) => {
  const [width, height] = String(size).split('x').map(Number);
  return { width, height };
};

/**
 * Validasi body request text-to-image.
 * @returns {{error: string}|{prompt: string, size: string, quality: string}}
 */
const parseImageRequest = (body = {}) => {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';

  if (!prompt) {
    return { error: 'Prompt is required' };
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { error: `Prompt is too long (max ${MAX_PROMPT_LENGTH} characters)` };
  }

  const size = body.size || DEFAULT_SIZE;
  if (!ALLOWED_SIZES.includes(size)) {
    return { error: `Invalid size. Allowed values: ${ALLOWED_SIZES.join(', ')}` };
  }

  const quality = body.quality || 'standard';
  if (!ALLOWED_QUALITIES.includes(quality)) {
    return { error: `Invalid quality. Allowed values: ${ALLOWED_QUALITIES.join(', ')}` };
  }

  return { prompt, size, quality };
};

/**
 * @POST /api/v1/media/text-to-image
 * Generate gambar dari prompt teks.
 */
exports.textToImage = async (req, res) => {
  const parsed = parseImageRequest(req.body);
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error });
  }

  let media = null;

  try {
    // Catat permintaan lebih dulu agar riwayat & analytics tetap lengkap,
    // termasuk saat proses generate gagal.
    media = await MediaContent.create({
      userId: req.member.uid,
      type: 'text-to-image',
      prompt: parsed.prompt,
      status: 'processing'
    });

    const result = await generateImage({
      prompt: parsed.prompt,
      size: parsed.size,
      quality: parsed.quality
    });

    // Catat bila provider utama gagal dan permintaan dilayani provider cadangan.
    // Tanpa baris ini, penurunan kualitas (mis. gambar lebih kecil dari provider
    // publik) hanya terlihat dari metadata — bukan dari log server.
    if (result.attempts && result.attempts.length) {
      console.warn(
        `Text-to-image dilayani ${result.provider} (provider utama gagal): ` +
          result.attempts.map((item) => `${item.provider}: ${item.reason}`).join('; ')
      );
    }

    // Ekstensi mengikuti format asli dari provider (FLUX/Pollinations -> jpeg).
    const format = result.format || 'png';
    const fileName = `${media.contentId}.${format}`;
    const saved = await putObject({
      key: fileName,
      buffer: result.buffer,
      contentType: `image/${format === 'jpg' ? 'jpeg' : format}`
    });

    // Dimensi asli dari provider dipakai bila ada; kalau header gambar tidak
    // terbaca, jatuh kembali ke ukuran yang diminta.
    const requested = parseSize(parsed.size);
    const width = result.width || requested.width;
    const height = result.height || requested.height;

    media.outputFile = saved.reference;
    media.outputUrl = saved.url;
    media.status = 'completed';
    media.completedAt = new Date();
    media.metadata = {
      width,
      height,
      resolution: `${width}x${height}`,
      requestedResolution: parsed.size,
      format,
      provider: result.provider,
      model: result.model
    };
    await media.save();

    // Quota dikurangi hanya setelah gambar benar-benar berhasil dibuat
    req.member.quota.imageGeneration -= 1;
    await req.member.save();

    return res.status(201).json({
      success: true,
      media,
      quota: req.member.quota,
      provider: result.provider,
      revisedPrompt: result.revisedPrompt || null
    });
  } catch (error) {
    console.error('Text-to-image error:', error.message);

    if (media) {
      media.status = 'failed';
      media.error = { message: error.message };
      try {
        await media.save();
      } catch (saveError) {
        console.error('Failed to update media status:', saveError.message);
      }
    }

    // Bedakan masalah konfigurasi server (503) dengan kegagalan dari provider (502)
    const { status, body } = buildFailureResponse(error, {
      configCodes: CONFIG_ERROR_CODES,
      defaultMessage: 'Image generation failed. Please try again.'
    });

    return res.status(status).json(body);
  }
};

/**
 * Batas ukuran gambar input setelah didekode (bukan ukuran base64-nya).
 * Frontend sudah memperkecil gambar ke <= 512px, jadi 6 MB lebih dari cukup
 * dan mencegah body raksasa masuk ke memori.
 */
const MAX_INPUT_BYTES = 6 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;

/**
 * Ubah gambar input dari body menjadi Buffer, sekaligus memastikan isinya
 * benar-benar gambar (dicek dari magic bytes, bukan dari header yang dikirim).
 *
 * @param {string} value data URL (`data:image/png;base64,...`) atau base64 polos
 * @returns {{error: string}|{buffer: Buffer, format: string, mimeType: string, width: number, height: number}}
 */
const parseInputImage = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';

  if (!raw) {
    return { error: 'Input image is required' };
  }

  const base64 = raw.replace(DATA_URL_PATTERN, '');

  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
    return { error: 'Input image must be base64 or a data URL' };
  }

  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length === 0) {
    return { error: 'Input image is empty' };
  }

  if (buffer.length > MAX_INPUT_BYTES) {
    return {
      error: `Input image is too large (${Math.round(buffer.length / 1024)} KB). ` +
        `Limit is ${MAX_INPUT_BYTES / (1024 * 1024)} MB.`
    };
  }

  if (!looksLikeImage(buffer)) {
    return { error: 'Input image is not a valid PNG, JPEG, or WEBP file' };
  }

  const { format, mimeType } = detectFormat(buffer);
  const dimensions = measureImage(buffer);

  if (!dimensions) {
    return { error: 'Failed to read input image dimensions' };
  }

  // Provider (FLUX.2 [klein]) menolak gambar input >= 512x512. Frontend
  // memperkecilnya lewat canvas; kalau batas ini tembus, permintaan datang dari
  // klien lain, jadi lebih baik ditolak dengan pesan jelas daripada gagal di
  // provider dengan error yang sulit dipahami.
  if (dimensions.width > MAX_EDIT_INPUT_EDGE || dimensions.height > MAX_EDIT_INPUT_EDGE) {
    return {
      error: `Input image must be at most ${MAX_EDIT_INPUT_EDGE}x${MAX_EDIT_INPUT_EDGE} pixels ` +
        `(received ${dimensions.width}x${dimensions.height}). Resize it first.`
    };
  }

  return { buffer, format, mimeType, ...dimensions };
};

/**
 * Validasi body request image-to-image.
 * @returns {{error: string}|{prompt: string, size: string, guidance: number|null}}
 */
const parseImageEditRequest = (body = {}) => {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';

  if (!prompt) {
    return { error: 'Prompt is required' };
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { error: `Prompt is too long (max ${MAX_PROMPT_LENGTH} characters)` };
  }

  const size = body.size || DEFAULT_SIZE;
  if (!ALLOWED_SIZES.includes(size)) {
    return { error: `Invalid size. Allowed values: ${ALLOWED_SIZES.join(', ')}` };
  }

  let guidance = null;
  if (body.guidance !== undefined && body.guidance !== null && body.guidance !== '') {
    guidance = Number(body.guidance);
    if (!Number.isFinite(guidance) || guidance < 1 || guidance > 20) {
      return { error: 'Invalid guidance. Allowed range: 1 - 20' };
    }
  }

  return { prompt, size, guidance };
};

/**
 * URL publik gambar input untuk provider yang mengambil gambar lewat URL
 * (Pollinations). Hanya dari PUBLIC_BASE_URL — sengaja TIDAK diambil dari host
 * request, karena host lokal (localhost) tetap "terlihat valid" bagi aplikasi
 * padahal provider tidak bisa mengambilnya. Pollinations akan tetap membalas 200
 * dengan gambar dari prompt saja kalau URL-nya tidak terjangkau, jadi lebih baik
 * tidak memberi URL sama sekali daripada memberi URL yang menyesatkan.
 */
const getPublicUploadUrl = (fileName) => {
  const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/uploads/${fileName}` : null;
};

/**
 * @POST /api/v1/media/image-to-image
 * Transformasi gambar input sesuai prompt.
 */
exports.imageToImage = async (req, res) => {
  const parsedRequest = parseImageEditRequest(req.body);
  if (parsedRequest.error) {
    return res.status(400).json({ success: false, message: parsedRequest.error });
  }

  const parsedImage = parseInputImage(req.body.image);
  if (parsedImage.error) {
    return res.status(400).json({ success: false, message: parsedImage.error });
  }

  let media = null;

  try {
    media = await MediaContent.create({
      userId: req.member.uid,
      type: 'image-to-image',
      prompt: parsedRequest.prompt,
      status: 'processing'
    });

    // Gambar input ikut disimpan supaya riwayat bisa menampilkan sebelum/sesudah
    // dan supaya provider berbasis URL bisa mengambilnya.
    const inputFileName = `${media.contentId}_input.${parsedImage.format}`;
    const savedInput = await putObject({
      key: inputFileName,
      buffer: parsedImage.buffer,
      contentType: parsedImage.mimeType
    });
    media.inputFile = savedInput.url;

    // Dengan penyimpanan remote (Cloudinary/S3), URL publiknya memang terjangkau
    // dari internet. Mode lokal tetap memakai PUBLIC_BASE_URL seperti sebelumnya —
    // sengaja TIDAK diambil dari host request, karena host lokal (localhost) tetap
    // "terlihat valid" bagi aplikasi padahal provider tidak bisa mengambilnya.
    const inputPublicUrl = isRemoteStorage()
      ? savedInput.url
      : getPublicUploadUrl(inputFileName);

    const result = await editImage({
      prompt: parsedRequest.prompt,
      imageBuffer: parsedImage.buffer,
      mimeType: parsedImage.mimeType,
      size: parsedRequest.size,
      guidance: parsedRequest.guidance,
      inputPublicUrl
    });

    if (result.attempts && result.attempts.length) {
      console.warn(
        `Image-to-image dilayani ${result.provider} (provider utama gagal): ` +
          result.attempts.map((item) => `${item.provider}: ${item.reason}`).join('; ')
      );
    }

    const format = result.format || 'png';
    const outputFileName = `${media.contentId}.${format}`;
    const savedOutput = await putObject({
      key: outputFileName,
      buffer: result.buffer,
      contentType: `image/${format === 'jpg' ? 'jpeg' : format}`
    });

    const requested = parseSize(parsedRequest.size);
    const width = result.width || requested.width;
    const height = result.height || requested.height;

    media.outputFile = savedOutput.reference;
    media.outputUrl = savedOutput.url;
    media.status = 'completed';
    media.completedAt = new Date();
    media.metadata = {
      width,
      height,
      resolution: `${width}x${height}`,
      requestedResolution: parsedRequest.size,
      inputResolution: `${parsedImage.width}x${parsedImage.height}`,
      format,
      provider: result.provider,
      model: result.model
    };
    await media.save();

    req.member.quota.imageGeneration -= 1;
    await req.member.save();

    return res.status(201).json({
      success: true,
      media,
      quota: req.member.quota,
      provider: result.provider
    });
  } catch (error) {
    console.error('Image-to-image error:', error.message);

    if (media) {
      media.status = 'failed';
      media.error = { message: error.message };
      try {
        await media.save();
      } catch (saveError) {
        console.error('Failed to update media status:', saveError.message);
      }
    }

    const { status, body } = buildFailureResponse(error, {
      configCodes: EDIT_CONFIG_ERROR_CODES,
      defaultMessage: 'Image transformation failed. Please try again.'
    });

    return res.status(status).json(body);
  }
};

/**
 * @GET /api/v1/media/history
 * Riwayat media milik user yang sedang login.
 */
exports.getMediaHistory = async (req, res) => {
  try {
    const filter = { userId: req.member.uid };

    if (req.query.type) {
      filter.type = req.query.type;
    }

    const media = await MediaContent.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(req.query.limit, 10) || 24, 100));

    res.json({
      success: true,
      count: media.length,
      media
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch media history',
      error: error.message
    });
  }
};

/**
 * @DELETE /api/v1/media/:contentId
 * Hapus satu media milik user (record + file di disk).
 */
exports.deleteMedia = async (req, res) => {
  try {
    const media = await MediaContent.findOneAndDelete({
      contentId: req.params.contentId,
      userId: req.member.uid
    });

    if (!media) {
      return res.status(404).json({
        success: false,
        message: 'Media not found'
      });
    }

    // outputFile menyimpan referensi penyimpanan (`s3://bucket/key` atau path
    // lokal), sedangkan inputFile menyimpan URL publik. Keduanya ditangani
    // supaya record lama (yang semuanya menunjuk folder uploads/) tetap bisa
    // dihapus setelah penyimpanan pindah ke object storage.
    if (media.outputFile) {
      await removeByReference(media.outputFile);
    }

    if (media.inputFile) {
      await removeByUrl(media.inputFile);
    }

    res.json({
      success: true,
      message: 'Media deleted'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete media',
      error: error.message
    });
  }
};
