/**
 * Server Configuration
 * AI Multimodal Application Backend
 * 
 * Tech Stack:
 * - Express.js API Server
 * - MongoDB Atlas (Free Tier)
 * - Firebase Auth Integration
 * - JWT Authentication
 * - Rate Limiting & Security
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/member');
const adminRoutes = require('./routes/admin');
const mediaRoutes = require('./routes/media');

const app = express();

// Nilai placeholder dari .env.example yang tidak boleh dianggap "sudah dikonfigurasi".
const PLACEHOLDER_VALUES = new Set([
  'sk-your-openai-key-here',
  'your-elevenlabs-key-here',
  'hf-your-huggingface-key-here',
  'your-super-secret-jwt-key-change-in-production'
]);

const isConfigured = (value) => {
  if (!value) return false;
  const trimmed = String(value).trim();
  return trimmed !== '' && !PLACEHOLDER_VALUES.has(trimmed);
};

/**
 * Firebase dianggap siap hanya jika isinya benar-benar bisa dipakai:
 * JSON service account, atau path file yang ada di disk.
 * Ini menangkap kasus paling membingungkan: env sudah diisi tapi isinya
 * path default yang filenya belum pernah di-download.
 */
const isFirebaseConfigured = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!isConfigured(raw)) return false;

  const trimmed = String(raw).trim();
  if (trimmed.startsWith('{')) return true;

  return fs.existsSync(path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed));
};

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100
});
app.use(limiter);

// Middleware
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// File hasil generate media (lihat mediaController).
// Saat scale-up, pindahkan ke object storage dan ganti mount ini.
const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/member', memberRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/media', mediaRoutes);

// Health check
app.get('/health', (req, res) => {
  const payload = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  };

  // Status konfigurasi layanan pihak ketiga, berguna untuk debugging lokal.
  // Tidak diekspos di production supaya tidak membocorkan info infrastruktur.
  if (process.env.NODE_ENV !== 'production') {
    payload.services = {
      firebase: isFirebaseConfigured() ? 'configured' : 'missing',
      openai: isConfigured(process.env.OPENAI_API_KEY) ? 'configured' : 'missing',
      devLogin: 'enabled'
    };
  }

  res.status(200).json(payload);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');
  } catch (error) {
    console.error('Database connection error:', error.message);
    process.exit(1);
  }
};

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

// Jalankan server hanya jika file ini dieksekusi langsung (`node server.js`).
// Saat di-require (mis. oleh test), app di-export tanpa membuka koneksi DB.
if (require.main === module) {
  startServer();
}

module.exports = { app, connectDB, startServer };