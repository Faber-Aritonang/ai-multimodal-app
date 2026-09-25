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
const { featureRateLimit } = require('../middleware/featureRateLimit');
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
  deleteMedia,
  getMediaById,
  shareMedia,
  unshareMedia
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
      'GET /api/v1/media/history?type=&status=&q=&page=&limit=',
      'GET /api/v1/media/:contentId',
      'POST /api/v1/media/:contentId/share',
      'DELETE /api/v1/media/:contentId/share',
      'GET /api/v1/share/:token',
      'DELETE /api/v1/media/:contentId'
    ],
    // Tidak ada fitur media yang tersisa sebagai rencana: seluruh kartu di
    // Dashboard sudah benar-benar aktif.
    comingSoonEndpoints: []
  });
});

// Urutan middleware semua endpoint generate:
//   authenticate -> requireMember -> featureRateLimit -> checkQuota -> handler
//
// `featureRateLimit` sengaja dipasang SEBELUM `checkQuota`: permintaan yang
// ditolak karena terlalu sering tidak pernah sampai ke provider, jadi kuota user
// tidak ikut terpakai. Batasnya dihitung per user (lihat middleware/featureRateLimit.js)
// dan dilonggarkan lewat env FEATURE_RATE_LIMIT_* bila perlu.

// text-to-image: butuh member terverifikasi + quota gambar
router.post(
  '/text-to-image',
  authenticate,
  requireMember,
  featureRateLimit('image'),
  checkQuota('imageGeneration'),
  textToImage
);

// image-to-image: quota yang sama dengan text-to-image (satu kuota per gambar hasil)
router.post(
  '/image-to-image',
  authenticate,
  requireMember,
  featureRateLimit('image'),
  checkQuota('imageGeneration'),
  imageToImage
);

// text-to-sound: kuota audio. Sebelumnya audio & video berbagi satu jatah
// (`videoGeneration`) sehingga suara bisa menghabiskan kuota video dan
// sebaliknya; sekarang keduanya punya kuota sendiri.
router.post(
  '/text-to-sound',
  authenticate,
  requireMember,
  featureRateLimit('audio'),
  checkQuota('audioGeneration'),
  textToSound
);

// sound-to-text: satu keluarga dengan text-to-sound, jadi kuota audionya sama
// (satu kuota per berkas yang diproses).
router.post(
  '/sound-to-text',
  authenticate,
  requireMember,
  featureRateLimit('audio'),
  checkQuota('audioGeneration'),
  soundToText
);

// text-to-video & image-to-video: memakai kuota videoGeneration yang memang
// diperuntukkan bagi video.
// Keduanya membalas 202 dan menyelesaikan pekerjaannya di latar belakang —
// lihat catatan panjang di mediaController.
router.post(
  '/text-to-video',
  authenticate,
  requireMember,
  featureRateLimit('video'),
  checkQuota('videoGeneration'),
  textToVideo
);

router.post(
  '/image-to-video',
  authenticate,
  requireMember,
  featureRateLimit('video'),
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

// Satu hasil milik user. Dipakai frontend untuk memantau pekerjaan latar
// belakang (video 1-5 menit) dari halaman mana pun tanpa mengunduh riwayat.
//
// Didaftarkan SETELAH endpoint statis di atas: Express mencocokkan rute sesuai
// urutan pendaftaran, jadi kalau rute ini lebih dulu, permintaan
// `GET /media/history` akan dijawab handler ini dengan `:contentId` = "history".
router.get('/:contentId', authenticate, requireMember, getMediaById);

router.delete('/:contentId', authenticate, requireMember, deleteMedia);

// Tautan baca-saja: satu untuk membuat/mengaktifkan, satu untuk mencabut.
// Yang membaca tautannya sendiri ada di routes/share.js (publik, tanpa auth).
router.post('/:contentId/share', authenticate, requireMember, shareMedia);
router.delete('/:contentId/share', authenticate, requireMember, unshareMedia);

module.exports = router;
