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
const { getAllowedOrigins } = require('./config/cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/member');
const adminRoutes = require('./routes/admin');
const mediaRoutes = require('./routes/media');
const { getProviderStatus } = require('./config/imageProviders');
const { getChatProviderStatus } = require('./config/chatProviders');
const { preferEnvFile } = require('./config/envFile');

// Di development, kredensial AI diambil dari .env walau variabel shell berisi
// nilai lain (mis. sisa `export GROQ_API_KEY=...` yang rusak di ~/.bashrc).
// Di production tidak dijalankan: variabel dari platform tetap menang.
if (process.env.NODE_ENV !== 'production') {
  const overridden = preferEnvFile({});
  if (overridden.length) {
    console.log(
      `Config: ${overridden.join(', ')} diambil dari .env (mengabaikan nilai shell yang berbeda)`
    );
  }
}

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
  origin: getAllowedOrigins(),
  credentials: true
}));

// Di produksi backend berjalan di belakang proxy platform (Railway/Vercel).
// Tanpa ini req.ip berisi IP proxy, sehingga SEMUA pengunjung berbagi satu
// hitungan rate limit dan aplikasi akan menolak diri sendiri dengan 429.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
// Morgan sengaja dipasang SEBELUM limiter: kalau limiter lebih dulu, request
// yang ditolak tidak pernah tercatat dan 429 jadi tidak terlihat saat debugging.
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
// Batas ini adalah jaring pengaman terhadap penyalahgunaan, bukan pembatas
// per fitur. Nilainya harus longgar: satu kali buka dashboard frontend saja
// sudah memanggil beberapa endpoint, dan kuota per user (chat/gambar) yang
// membatasi pemakaian sebenarnya.
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 1000;

const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Health check (monitoring) dan file statis (tag <img>) tidak dihitung.
  skip: (req) => req.path === '/health' || req.path.startsWith('/uploads'),
  // Balas JSON, bukan teks polos. Tanpa ini frontend hanya menerima pesan
  // axios mentah "Request failed with status code 429" karena response tidak
  // punya field message.
  handler: (req, res) => {
    const resetTime = req.rateLimit && req.rateLimit.resetTime;
    const retryAfter = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);

    res.status(429).json({
      success: false,
      message:
        `Too many requests from this address (limit ${RATE_LIMIT_MAX} per ` +
        `${Math.round(RATE_LIMIT_WINDOW_MS / 60000)} minutes). ` +
        `Please try again in ${retryAfter} seconds.`,
      retryAfter
    });
  }
});
app.use(limiter);

// File hasil generate media (lihat mediaController).
// Saat scale-up, pindahkan ke object storage dan ganti mount ini.
const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '7d',
    setHeaders: (res) => {
      // `helmet()` di atas menyetel Cross-Origin-Resource-Policy: same-origin
      // untuk semua respons. Untuk berkas media itu justru mematikan fiturnya:
      // frontend (domain Vercel) memuat gambar lewat tag <img> dari domain
      // backend, dan browser menolaknya dengan
      // ERR_BLOCKED_BY_RESPONSE.NotSameOrigin — gambar tampil rusak (yang
      // terlihat hanya teks `alt`) padahal berkasnya ada dan curl menerima 200.
      // Di lokal kekeliruan ini tidak terlihat karena Vite mem-proxy /uploads,
      // sehingga halaman dan gambarnya satu origin.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
  })
);

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
    // Provider gambar & chat yang aktif, supaya error fitur AI bisa langsung
    // dicocokkan dengan konfigurasi yang sebenarnya.
    const image = getProviderStatus();
    const chat = getChatProviderStatus();

    payload.services = {
      firebase: isFirebaseConfigured() ? 'configured' : 'missing',
      openai: isConfigured(process.env.OPENAI_API_KEY) ? 'configured' : 'missing',
      chatProvider: chat.chain[0] || 'none',
      chatProviders: chat.status,
      imageProvider: image.chain[0] || 'none',
      imageFallback: image.chain[1] || 'none',
      imageProviders: image.status,
      // image-to-image bisa memakai provider berbeda dari text-to-image
      // (mis. Cloudflare FLUX.2 [klein] untuk edit, Pollinations untuk generate).
      imageEditProvider: image.editChain[0] || 'none',
      imageEditFallback: image.editChain[1] || 'none',
      imageEditReady: image.editReady,
      imageEditCapabilities: image.editCapabilities,
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