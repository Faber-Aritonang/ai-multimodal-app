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
  logout 
} = require('../controllers/authController');
const { authenticate, optionalAuth, requireGuest } = require('../middleware/auth');

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

module.exports = router;