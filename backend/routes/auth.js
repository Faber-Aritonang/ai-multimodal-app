/**
 * Routes: Authentication
 * Registrasi, login, logout, status
 */

const express = require('express');
const router = express.Router();
const { 
  register, 
  login, 
  getAuthStatus, 
  logout,
  devLogin,
  isDevLoginEnabled
} = require('../controllers/authController');
const { authenticate, optionalAuth, requireGuest } = require('../middleware/auth');
const MemberController = require('../controllers/memberController');

// POST /api/v1/auth/register
// Registrasi akun baru
router.post('/register', requireGuest, register);

// POST /api/v1/auth/login
// Login dengan Firebase token
router.post('/login', requireGuest, login);

// GET /api/v1/auth/status
// Cek status autentikasi (token opsional - bisa diakses tanpa login)
router.get('/status', optionalAuth, getAuthStatus);

// POST /api/v1/auth/logout
// Logout dan bersihkan token
router.post('/logout', logout);

// GET /api/v1/auth/referral/:referralCode
// Info pemilik kode referral (publik, dipakai halaman /register?ref=CODE)
router.get('/referral/:referralCode', MemberController.getMemberByReferralCode);

// POST /api/v1/auth/dev-login
// Login tanpa Firebase untuk pengembangan lokal.
// Route ini TIDAK dipasang saat NODE_ENV=production.
if (isDevLoginEnabled()) {
  router.post('/dev-login', devLogin);
}

module.exports = router;