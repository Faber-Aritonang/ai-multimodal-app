/**
 * Routes: Media API
 * Fitur AI multimodal berbasis gambar.
 *
 * Sudah tersedia : text-to-image
 * Rencana        : image-to-image, text-to-video, image-to-video,
 *                  text-to-sound, sound-to-text
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireMember, checkQuota } = require('../middleware/auth');
const {
  textToImage,
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
      'GET /api/v1/media/history',
      'DELETE /api/v1/media/:contentId'
    ],
    comingSoonEndpoints: [
      'POST /api/v1/media/image-to-image',
      'POST /api/v1/media/text-to-video',
      'POST /api/v1/media/image-to-video',
      'POST /api/v1/media/text-to-sound',
      'POST /api/v1/media/sound-to-text'
    ]
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

// Riwayat & hapus media milik user
router.get('/history', authenticate, requireMember, getMediaHistory);
router.delete('/:contentId', authenticate, requireMember, deleteMedia);

module.exports = router;
