/**
 * Routes: Media API
 * Fitur AI multimodal berbasis gambar.
 *
 * Sudah tersedia : text-to-image, image-to-image, text-to-sound, sound-to-text,
 *                  text-to-video, image-to-video
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireMember, checkQuota } = require('../middleware/auth');
const {
  textToImage,
  imageToImage,
  textToSound,
  soundToText,
  getSoundVoices,
  getTranscribeOptions,
  getVideoOptions,
  textToVideo,
  imageToVideo,
  getMediaHistory,
  deleteMedia
} = require('../controllers/mediaController');

// Info endpoint yang tersedia (publik, tanpa auth)
router.get('/status', (req, res) => {
  res.json({
    success: true,
    message: 'Media API is ready.',
    availableEndpoints: [
      'POST /api/v1/media/text-to-image',
      'POST /api/v1/media/image-to-image',
      'POST /api/v1/media/text-to-sound',
      'GET /api/v1/media/sound-voices',
      'POST /api/v1/media/sound-to-text',
      'GET /api/v1/media/transcribe-options',
      'POST /api/v1/media/text-to-video',
      'POST /api/v1/media/image-to-video',
      'GET /api/v1/media/video-options',
      'GET /api/v1/media/history',
      'DELETE /api/v1/media/:contentId'
    ],
    // Tidak ada fitur media yang tersisa sebagai rencana: seluruh kartu di
    // Dashboard sudah benar-benar aktif.
    comingSoonEndpoints: []
  });
});

// text-to-image: butuh member terverifikasi + quota gambar
router.post(
  '/text-to-image',
  authenticate,
  requireMember,
  checkQuota('imageGeneration'),
  textToImage
);

// image-to-image: quota yang sama dengan text-to-image (satu kuota per gambar hasil)
router.post(
  '/image-to-image',
  authenticate,
  requireMember,
  checkQuota('imageGeneration'),
  imageToImage
);

// text-to-sound: memakai kuota videoGeneration (lihat catatan di mediaController).
router.post(
  '/text-to-sound',
  authenticate,
  requireMember,
  checkQuota('videoGeneration'),
  textToSound
);

// sound-to-text: memakai kuota yang sama dengan text-to-sound (audio & video
// berbagi satu jatah media non-gambar — lihat catatan di mediaController).
router.post(
  '/sound-to-text',
  authenticate,
  requireMember,
  checkQuota('videoGeneration'),
  soundToText
);

// text-to-video & image-to-video: memakai kuota videoGeneration yang memang
// diperuntukkan bagi video (aturan yang sama juga dipakai middleware).
// Keduanya membalas 202 dan menyelesaikan pekerjaannya di latar belakang —
// lihat catatan panjang di mediaController.
router.post(
  '/text-to-video',
  authenticate,
  requireMember,
  checkQuota('videoGeneration'),
  textToVideo
);

router.post(
  '/image-to-video',
  authenticate,
  requireMember,
  checkQuota('videoGeneration'),
  imageToVideo
);

// Mode, resolusi, durasi & batas yang diterima endpoint video (halaman video)
router.get('/video-options', authenticate, requireMember, getVideoOptions);

// Voice TTS yang sah untuk provider yang aktif (dropdown halaman text-to-sound)
router.get('/sound-voices', authenticate, requireMember, getSoundVoices);

// Bahasa & format yang diterima endpoint sound-to-text (halaman sound-to-text)
router.get('/transcribe-options', authenticate, requireMember, getTranscribeOptions);

// Riwayat & hapus media milik user
router.get('/history', authenticate, requireMember, getMediaHistory);
router.delete('/:contentId', authenticate, requireMember, deleteMedia);

module.exports = router;
