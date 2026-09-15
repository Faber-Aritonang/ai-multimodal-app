/**
 * Routes: Member API
 * Akses fitur AI hanya untuk member yang sudah disetujui
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireMember, checkQuota } = require('../middleware/auth');
const {
  getChatSessions,
  createChatSession,
  sendMessage,
  getChatSession,
  deleteChatSession
} = require('../controllers/chatController');
const MemberController = require('../controllers/memberController');

// Semua route member butuh akun yang sudah disetujui admin.
// authenticate wajib lebih dulu: requireMember membaca req.user yang diisi di sana.
router.use(authenticate);
router.use(requireMember);

// Chat routes
router.get('/chat/sessions', getChatSessions);
router.post('/chat/sessions', createChatSession);
router.post('/chat/sessions/:sessionId/message', checkQuota('chat'), sendMessage);
router.get('/chat/sessions/:sessionId', getChatSession);
router.delete('/chat/sessions/:sessionId', deleteChatSession);

// Member & referral routes
router.get('/members', MemberController.getApprovedMembers);
router.get('/members/:referralCode', MemberController.getMemberByReferralCode);
router.get('/referral-stats', MemberController.getReferralStats);

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
