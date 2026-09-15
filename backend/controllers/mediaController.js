/**
 * Controller: Media
 * Fitur AI multimodal berbasis gambar.
 *
 * text-to-image:
 *   1. validasi prompt & ukuran
 *   2. buat record MediaContent (status: processing)
 *   3. panggil OpenAI Images API (base64)
 *   4. simpan gambar ke folder uploads/ dan update record (status: completed)
 *   5. kurangi quota user (hanya jika berhasil)
 */

const fs = require('fs/promises');
const path = require('path');
const MediaContent = require('../models/MediaContent');
const {
  getOpenAIClient,
  getImageModel,
  supportsResponseFormat
} = require('../config/openai');

// Ukuran yang didukung DALL-E 3
const ALLOWED_SIZES = ['1024x1024', '1792x1024', '1024x1792'];
const DEFAULT_SIZE = '1024x1024';
const ALLOWED_QUALITIES = ['standard', 'hd'];
const MAX_PROMPT_LENGTH = 1000;

/**
 * Folder penyimpanan hasil generate. Dibaca dari env agar mudah dipindah
 * (mis. ke volume persisten saat deploy) dan supaya test bisa memakai temp dir.
 */
const getUploadDir = () =>
  path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');

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

    const model = getImageModel();
    const params = {
      model,
      prompt: parsed.prompt,
      n: 1,
      size: parsed.size
    };

    // Parameter quality hanya dikenal model dall-e-*
    if (supportsResponseFormat(model)) {
      params.quality = parsed.quality;
      params.response_format = 'b64_json';
    }

    const response = await getOpenAIClient().images.generate(params);
    const image = response?.data?.[0];
    const base64 = image?.b64_json;

    if (!base64) {
      throw new Error('OpenAI did not return image data in base64 format');
    }

    const uploadDir = getUploadDir();
    await fs.mkdir(uploadDir, { recursive: true });

    const fileName = `${media.contentId}.png`;
    const filePath = path.join(uploadDir, fileName);
    await fs.writeFile(filePath, Buffer.from(base64, 'base64'));

    media.outputFile = filePath;
    media.outputUrl = `/uploads/${fileName}`;
    media.status = 'completed';
    media.completedAt = new Date();
    media.metadata = {
      ...parseSize(parsed.size),
      resolution: parsed.size,
      format: 'png'
    };
    await media.save();

    // Quota dikurangi hanya setelah gambar benar-benar berhasil dibuat
    req.member.quota.imageGeneration -= 1;
    await req.member.save();

    return res.status(201).json({
      success: true,
      media,
      quota: req.member.quota,
      revisedPrompt: image.revised_prompt || null
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

    // Bedakan masalah konfigurasi server dengan kegagalan dari provider
    const isConfigError = error.message.includes('OPENAI_API_KEY');

    return res.status(isConfigError ? 503 : 502).json({
      success: false,
      message: isConfigError
        ? error.message
        : 'Image generation failed. Please try again.',
      error: error.message
    });
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

    // Hapus file hanya jika memang berada di folder upload
    if (media.outputFile) {
      const uploadDir = getUploadDir();
      if (path.resolve(media.outputFile).startsWith(uploadDir)) {
        await fs.rm(media.outputFile, { force: true });
      }
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
