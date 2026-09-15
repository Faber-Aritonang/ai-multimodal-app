/**
 * Routes: Admin API
 * Manage members, approval, and analytics
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  getPendingMembers,
  getApprovedMembers,
  approveMember,
  rejectMember,
  getAnalytics
} = require('../controllers/adminController');

// Semua route ini membutuhkan akses admin.
// authenticate wajib lebih dulu: requireAdmin membaca req.user yang diisi di sana.
router.use(authenticate);
router.use(requireAdmin);

// Member management
router.get('/pending-members', getPendingMembers);
router.get('/approved-members', getApprovedMembers);
router.put('/approve-member/:uid', approveMember);
router.delete('/reject-member/:uid', rejectMember);

// Analytics
router.get('/analytics', getAnalytics);

module.exports = router;