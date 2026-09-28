/**
 * Routes: Member API
 * Akses fitur AI hanya untuk member yang sudah disetujui
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireMember, checkQuota } = require('../middleware/auth');
const { featureRateLimit } = require('../middleware/featureRateLimit');
const { connectorActionRateLimit } = require('../middleware/connectorActionRateLimit');
const {
  getChatSessions,
  createChatSession,
  sendMessage,
  getChatSession,
  deleteChatSession
} = require('../controllers/chatController');
const MemberController = require('../controllers/memberController');
const connectorController = require('../controllers/connectorController');

// Semua route member butuh akun yang sudah disetujui admin.
// authenticate wajib lebih dulu: requireMember membaca req.user yang diisi di sana.
router.use(authenticate);
router.use(requireMember);

// Chat routes
router.get('/chat/sessions', getChatSessions);
router.post('/chat/sessions', createChatSession);
// Limiter lebih dulu daripada kuota: pesan yang ditolak karena terlalu sering
// tidak pernah sampai ke provider LLM dan tidak memakai kuota user.
router.post(
  '/chat/sessions/:sessionId/message',
  featureRateLimit('chat'),
  checkQuota('chat'),
  sendMessage
);
router.get('/chat/sessions/:sessionId', getChatSession);
router.delete('/chat/sessions/:sessionId', deleteChatSession);

// Google Workspace connectors (Composio)
router.get('/connectors', connectorController.getStatus);
router.post('/connectors/:toolkit/connect', connectorActionRateLimit, connectorController.connect);
router.get('/chat/sessions/:sessionId/connector-actions', connectorController.getPendingActions);
router.post('/chat/sessions/:sessionId/connector-actions', connectorActionRateLimit, connectorController.createPendingAction);
router.post('/connector-actions/:actionId/confirm', connectorActionRateLimit, connectorController.confirmPendingAction);
router.delete('/connector-actions/:actionId', connectorActionRateLimit, connectorController.cancelPendingAction);

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

// Update profil sendiri (nama tampilan, bio, foto). Field wewenang admin
// (email/role/quota/isApproved) diabaikan controller — lihat updateProfile.
router.put('/profile', MemberController.updateProfile);

// Get quota info
router.get('/quota', (req, res) => {
  res.json({
    success: true,
    quota: req.member.quota
  });
});

module.exports = router;
