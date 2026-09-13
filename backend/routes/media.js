/**
 * Routes: Media API
 * Untuk fitur AI multimodal (akan diperluas di iterasi selanjutnya)
 * - text-to-image
 * - image-to-image
 * - text-to-video
 * - image-to-video
 * - text-to-sound
 * - sound-to-text
 */

const express = require('express');
const router = express.Router();
const { requireMember } = require('../middleware/auth');

// TODO: Implement media generation endpoints
// router.post('/text-to-image', requireMember, checkQuota('imageGeneration'), textToImage);
// router.post('/image-to-image', requireMember, imageToImage);
// router.post('/text-to-video', requireMember, checkQuota('videoGeneration'), textToVideo);
// router.post('/image-to-video', requireMember, imageToVideo);
// router.post('/text-to-sound', requireMember, textToSound);
// router.post('/sound-to-text', requireMember, soundToText);

router.get('/status', (req, res) => {
  res.json({
    success: true,
    message: 'Media API is ready. Endpoints coming soon.',
    availableEndpoints: [
      'POST /api/v1/media/text-to-image',
      'POST /api/v1/media/image-to-image',
      'POST /api/v1/media/text-to-video',
      'POST /api/v1/media/image-to-video',
      'POST /api/v1/media/text-to-sound',
      'POST /api/v1/media/sound-to-text'
    ]
  });
});

module.exports = router;