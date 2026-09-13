/**
 * Routes: Member API
 * Akses fitur AI hanya untuk member yang sudah disetujui
 */

const express = require('express');
const router = express.Router();
const { requireMember, checkQuota } = require('../middleware/auth');
const {
  getChatSessions,
  createChatSession,
  sendMessage,
  getChatSession,
  deleteChatSession
} = require('../controllers/chatController');

// Semua route di sini membutuhkan member yang sudah disetujui
router.use(requireMember);

// Chat routes
router.get('/chat/sessions', getChatSessions);
router.post('/chat/sessions', createChatSession);
router.post('/chat/sessions/:sessionId/message', checkQuota('chat'), sendMessage);
router.get('/chat/sessions/:sessionId', getChatSession);
router.delete('/chat/sessions/:sessionId', deleteChatSession);

// Media routes (akan ditambah nanti)
// router.post('/media/text-to-image', checkQuota('imageGeneration'), ...);
// router.post('/media/image-to-image', ...);
// router.post('/media/text-to-video', checkQuota('videoGeneration'), ...);
// router.post('/media/image-to-video', ...);
// router.post('/media/text-to-sound', ...);
// router.post('/media/sound-to-text', ...);

// Get member profile
router.get('/profile', (req, res) => {
  res.json({
    success: true,
    user: req.member
  });
});

// Get quota info
router.get('/quota', (req, res) => {
  res.json({
    success: true,
    quota: req.member.quota
  });
});

module.exports = router;