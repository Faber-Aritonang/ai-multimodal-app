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
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/member');
const adminRoutes = require('./routes/admin');
const mediaRoutes = require('./routes/media');
const shareRoutes = require('./routes/share');
const clientErrorRoutes = require('./routes/clientErrors');
const { getProviderStatus } = require('./config/imageProviders');
const {
  describeStorage,
  getStorageMode,
  isRemoteStorage,
  getStorageCheck,
  startStorageCheck,
  cloudinaryCredentialSource
} = require('./config/storage');
const { getChatProviderStatus } = require('./config/chatProviders');
const { getSpeechProviderStatus } = require('./config/soundProviders');
const { getVideoProviderStatus } = require('./config/videoProviders');
const { getSpeechToTextStatus } = require('./config/speechToTextProviders');
const { preferEnvFile } = require('./config/envFile');
const { getBuildInfo } = require('./config/buildInfo');
const { logger } = require('./config/logger');
const { requestContext } = require('./middleware/requestContext');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');

// Di development, kredensial AI diambil dari .env walau variabel shell berisi
// nilai lain (mis. sisa `export GROQ_API_KEY=...` yang rusak di ~/.bashrc).
// Di production tidak dijalankan: variabel dari platform tetap menang.
if (process.env.NODE_ENV !== 'production') {
  const overridden = preferEnvFile({});
  if (overridden.length) {
    logger.info(
      `Config: ${overridden.join(', ')} diambil dari .env (mengabaikan nilai shell yang berbeda)`,
      { variables: overridden }
    );
  }
}

const app = express();

// Paling awal, sebelum helmet/CORS: identitas request harus ada bahkan untuk
// permintaan yang ditolak middleware berikutnya. Tanpa ini, penolakan CORS atau
// permintaan yang terlalu besar tidak bisa dihubungkan ke satu request tertentu.
app.use(requestContext);

// Domain produksi utama dan domain custom aplikasi. Keduanya harus bisa
// mengakses API karena Vercel memakai deployment yang sama untuk dua hostname.
// Tetap gunakan FRONTEND_URL untuk domain tambahan milik deployment lain.
const BUILT_IN_PRODUCTION_ORIGINS = [
  'https://ai-multimodal-app.vercel.app',
  'https://www.maubuatapa.my.id',
  'https://maubuatapa.my.id'
];
// Whitelist domain aplikasi selalu aktif, bukan hanya saat NODE_ENV tepat
// bernilai `production`. Jika variabel NODE_ENV lupa diisi di Railway, domain
// custom tetap harus bisa login; keamanan tetap terjaga karena hanya hostname
// milik aplikasi yang ditambahkan, bukan wildcard.
const allowedOrigins = [...new Set([
  ...getAllowedOrigins(),
  ...BUILT_IN_PRODUCTION_ORIGINS
])];

// CORS `origin` menerima daftar string. Whitelist bawaan ini mencegah error
// jaringan meskipun FRONTEND_URL di Railway masih hanya berisi domain lama.

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
  origin: allowedOrigins,
  credentials: true
}));

// Di produksi backend berjalan di belakang proxy platform (Railway/Vercel).
// Tanpa ini req.ip berisi IP proxy, sehingga SEMUA pengunjung berbagi satu
// hitungan rate limit dan aplikasi akan menolak diri sendiri dengan 429.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
// Logger akses sengaja dipasang SEBELUM limiter: kalau limiter lebih dulu,
// request yang ditolak tidak pernah tercatat dan 429 jadi tidak terlihat saat
// debugging. Penggantinya `requestLogger` (lihat middleware/requestLogger.js)
// yang mencatat level per status, bukan `morgan('dev')`.
app.use(requestLogger);
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
// Tautan baca-saja: publik (tanpa auth) karena memang untuk dibagikan ke orang
// lain. Lihat catatan panjang di routes/share.js.
app.use('/api/v1/share', shareRoutes);
// Laporan galat dari frontend (publik, dibatasi ketat per IP). Lihat catatan
// panjang di routes/clientErrors.js.
app.use('/api/v1/client-errors', clientErrorRoutes);

// Health check
app.get('/health', (req, res) => {
  const hasilPenyimpanan = getStorageCheck();
  const build = getBuildInfo();

  const payload = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    // Commit yang sedang berjalan. Dilaporkan SELALU, termasuk di produksi,
    // karena inilah satu-satunya cara membuktikan dari luar bahwa kode yang live
    // adalah commit yang baru di-push. Tanpa kolom ini, langkah verifikasi deploy
    // hanya bisa tahu "proses deploy-nya selesai" — dan itu tetap terlihat hijau
    // walau kode lama yang melayani user. Bentuknya SHA git, yang sudah publik
    // (repo ini publik), jadi tidak ada apa pun yang dibocorkan. `null` berarti
    // penandanya tidak terbaca, bukan berarti gagal.
    commit: build.commit,
    // Dibedakan karena dua jalur deployment berperilaku sama saat benar tetapi
    // berbeda saat salah: `railway-git` berarti Railway mengisinya untuk
    // deployment dari integrasi GitHub, `build-meta` berarti dari penanda yang
    // ditulis job CI sebelum `railway up`. Hanya dikirim saat nilainya ada, sama
    // seperti `storageCredentialSource`.
    ...(build.source ? { commitSource: build.source } : {}),
    // Mode penyimpanan dilaporkan SELALU, termasuk di production.
    // Alasannya konkret: kalau nilainya `local` di produksi, setiap deploy akan
    // menghapus gambar user — dan itu satu-satunya fakta operasional penting yang
    // tidak bisa dilihat dari kode maupun dari UI. Blok `services` di bawah tetap
    // hanya untuk non-production (isinya detail infrastruktur), sedangkan satu
    // kata ini tidak membocorkan apa pun.
    storageMode: getStorageMode(),
    // Dari mana kredensial Cloudinary dibaca: 'url' (CLOUDINARY_URL) atau 'vars'
    // (tiga variabel CLOUDINARY_*). Isinya NAMA variabel, bukan nilainya — dan
    // kedua nama itu sudah tercantum di dokumentasi publik
    // (docs/setup-kredensial.md bagian 3d) — tetapi inilah yang membedakan dua
    // konfigurasi yang berperilaku sama saat benar dan berbeda saat salah. Tanpa
    // kolom ini, kegagalan yang penyebabnya "nilainya dibaca dari tempat yang
    // berbeda" hanya bisa ditelusuri dari dalam dashboard.
    ...(getStorageMode() === 'cloudinary'
      ? { storageCredentialSource: cloudinaryCredentialSource() }
      : {}),
    // Hasil verifikasi kredensial penyimpanan: 'pending' | 'ok' | 'failed' |
    // 'skipped'. Alasan dilaporkannya sama dengan `storageMode`, tetapi untuk
    // masalah yang berbeda: `storageMode` menjawab "mode apa yang dipakai",
    // sedangkan kolom ini menjawab "apakah kredensialnya benar-benar berlaku".
    // Keduanya bisa berbeda — nilai yang salah tulis tetap membuat mode terbaca
    // `cloudinary` (pemeriksaannya hanya "tidak kosong"), dan dulu itu baru
    // ketahuan saat user pertama kali men-generate gambar. Satu kata, tidak
    // membocorkan nilai maupun detail infrastruktur.
    storageCheck: hasilPenyimpanan.state,
    // Penyebab kegagalan, muncul HANYA saat verifikasi gagal. Isinya kode —
    // `HTTP 401`, `HTTP 403`, `timeout` — bukan pesan dari provider: pesan
    // aslinya memuat endpoint dan nama bucket, sedangkan kolom ini tampil di
    // `/health` publik dan di log CI repo publik.
    //
    // Kolom ini ada karena `failed` saja tidak bisa ditindaklanjuti: `HTTP 401`
    // berarti nilai kredensialnya salah, `timeout` berarti providernya tidak
    // menjawab, dan keduanya butuh tindakan yang berbeda. Sebelumnya penyebabnya
    // hanya terbaca dari log server, yang berarti satu-satunya cara mengetahui
    // kenapa deploy merah adalah membuka dashboard Railway.
    ...(hasilPenyimpanan.alasan ? { storageCheckReason: hasilPenyimpanan.alasan } : {})
  };

  // Status konfigurasi layanan pihak ketiga, berguna untuk debugging lokal.
  // Tidak diekspos di production supaya tidak membocorkan info infrastruktur.
  if (process.env.NODE_ENV !== 'production') {
    // Provider gambar & chat yang aktif, supaya error fitur AI bisa langsung
    // dicocokkan dengan konfigurasi yang sebenarnya.
    const image = getProviderStatus();
    const chat = getChatProviderStatus();
    const speech = getSpeechProviderStatus();
    const transcribe = getSpeechToTextStatus();
    const video = getVideoProviderStatus();

    payload.services = {
      firebase: isFirebaseConfigured() ? 'configured' : 'missing',
      openai: isConfigured(process.env.OPENAI_API_KEY) ? 'configured' : 'missing',
      chatProvider: chat.chain[0] || 'none',
      chatProviders: chat.status,
      imageProvider: image.chain[0] || 'none',
      imageFallback: image.chain[1] || 'none',
      imageProviders: image.status,
      // image-to-image bisa memakai provider berbeda dari text-to-image
      // (mis. Bynara/Agnes untuk generate, Cloudflare FLUX.2 [klein] untuk edit).
      imageEditProvider: image.editChain[0] || 'none',
      imageEditFallback: image.editChain[1] || 'none',
      imageEditReady: image.editReady,
      imageEditCapabilities: image.editCapabilities,
      // Provider text-to-sound (Gemini untuk suara Indonesia yang logatnya bisa
      // diarahkan, ElevenLabs free tier sebagai cadangan, Edge tanpa kunci).
      // `soundReady` menentukan apakah halaman /tools/text-to-sound bisa
      // benar-benar menghasilkan audio, dan spec browser memakainya untuk
      // memilih antara menguji alur lengkap atau menguji pesan kegagalan yang
      // jelas — sama seperti imageEditReady. Dengan Edge di rantai, nilainya
      // true bahkan tanpa kredensial apa pun.
      soundProvider: speech.chain[0] || 'none',
      soundFallback: speech.chain[1] || 'none',
      soundProviders: speech.status,
      soundVoices: speech.voices,
      soundReady: speech.ready,
      // Provider sound-to-text (transkripsi). `speechToTextReady` menentukan
      // apakah halaman /tools/sound-to-text bisa menghasilkan transkrip, dan
      // spec browser memakainya untuk memilih antara menguji alur lengkap atau
      // menguji pesan kegagalan yang jelas. Berbeda dari `soundReady`, nilainya
      // TIDAK selalu true: tidak ada provider transkripsi yang bisa dipakai
      // tanpa kredensial sama sekali.
      speechToTextProvider: transcribe.chain[0] || 'none',
      speechToTextFallback: transcribe.chain[1] || 'none',
      speechToTextProviders: transcribe.status,
      speechToTextModels: transcribe.models,
      speechToTextReady: transcribe.ready,
      // Provider video (text-to-video & image-to-video). Sama seperti
      // sound-to-text, `videoReady` TIDAK selalu true: tidak ada provider video
      // yang bisa dipakai tanpa kredensial sama sekali (Cloudflare tidak punya
      // model video, Pollinations video semuanya berbayar), sehingga nilainya
      // benar-benar bisa false — dan itulah yang membedakan "kunci belum sampai
      // ke container" dari "providernya sedang bermasalah".
      videoProvider: video.chain[0] || 'none',
      videoFallback: video.chain[1] || 'none',
      videoProviders: video.status,
      videoModels: video.models,
      videoReady: video.ready,
      // Di produksi nilainya harus `cloudinary` atau `s3`; kalau `local`, gambar
      // akan hilang pada setiap deploy (filesystem container sementara).
      storage: describeStorage(),
      devLogin: 'enabled'
    };
  }

  res.status(200).json(payload);
});

// Error handling middleware.
// Terpusat di middleware/errorHandler.js: ia mencatat galatnya ke log + daftar
// galat admin (dengan requestId), menerjemahkan galat bawaan body-parser, dan
// tidak meneruskan pesan internal ke klien di produksi.
app.use(errorHandler);

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('MongoDB Connected');
  } catch (error) {
    // `error` dikirim utuh supaya stack trace-nya ikut tercatat — pesan saja
    // tidak cukup untuk membedakan kredensial salah dari cluster tidak bisa
    // dijangkau.
    logger.error('Database connection error', { error });
    process.exit(1);
  }
};

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  await connectDB();
  // Bind explicitly to all interfaces. Railway's proxy cannot reach a server
    // bound only to the container loopback interface.
    app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on port ${PORT}`, { port: Number(PORT) });
    // Dicatat sekali saat boot supaya mode penyimpanan terlihat langsung di log
    // platform (Railway), bukan harus ditebak dari perilaku aplikasi. Sumber
    // kredensialnya ikut dicatat karena "dibaca dari CLOUDINARY_URL" dan
    // "dibaca dari tiga variabel terpisah" adalah dua konfigurasi berbeda yang
    // berperilaku identik saat sudah benar — jadi hanya saat salah baris inilah
    // yang membedakannya.
    const modePenyimpanan = getStorageMode();
    const sumberKredensial =
      modePenyimpanan === 'cloudinary'
        ? `, kredensial dari ${
            cloudinaryCredentialSource() === 'url'
              ? 'CLOUDINARY_URL'
              : 'tiga variabel CLOUDINARY_*'
          }`
        : '';
    logger.info(`Penyimpanan media: mode=${modePenyimpanan}${sumberKredensial}`, {
      storageMode: modePenyimpanan,
      // Hanya berlaku untuk Cloudinary; undefined dibuang oleh logger.
      credentialSource:
        modePenyimpanan === 'cloudinary' ? cloudinaryCredentialSource() : undefined
    });
    // Dijalankan tanpa di-await: hasilnya menyusul di /health dan di log
    // ("Verifikasi penyimpanan: ..."). Server tidak boleh tertahan atau gagal
    // naik hanya karena penyimpanan sedang tidak bisa dihubungi.
    startStorageCheck();
    // Rantai provider chat dicatat di sini dengan alasan yang sama: `/health`
    // sengaja menyembunyikan blok `services` di production, sehingga tanpa baris
    // ini satu-satunya cara tahu apakah OpenRouter (atau provider lain) benar
    // aktif adalah membuka env di dashboard platform — dan itu yang berulang
    // kali membuat "sudah saya isi key-nya" tidak cocok dengan perilaku aplikasi.
    // Isinya hanya nama provider + ada/tidaknya key, tidak ada nilainya.
    const chat = getChatProviderStatus();
    const chatStatus = Object.entries(chat.status)
      .map(([name, state]) => `${name}=${state}`)
      .join(' ');
    logger.info(`Provider chat: ${chat.chain.join(' > ') || 'none'} (${chatStatus})`, {
      chain: chat.chain,
      status: chat.status
    });

    // Hal yang sama untuk provider gambar: tanpa baris ini, "text-to-image
    // gagal" tidak bisa dibedakan antara kredensial yang belum sampai ke
    // container dan provider yang memang sedang bermasalah.
    const image = getProviderStatus();
    const imageStatus = Object.entries(image.status)
      .map(([name, state]) => `${name}=${state}`)
      .join(' ');
    logger.info(`Provider gambar: ${image.chain.join(' > ') || 'none'} (${imageStatus})`, {
      chain: image.chain,
      status: image.status
    });
    // Rantai image-to-image dipisah: providernya berbeda, dan inilah satu-satunya
    // tempat melihatnya di production.
    logger.info(
      `Provider edit: ${image.editChain.join(' > ') || 'none'} (editReady=${image.editReady})`,
      { chain: image.editChain, editReady: image.editReady }
    );
    // Text-to-sound: tanpa baris ini, "audio gagal" tidak bisa dibedakan antara
    // GEMINI_API_KEY yang belum sampai ke container dan provider yang memang
    // bermasalah — dan provider yang dipakai ikut terlihat.
    const speech = getSpeechProviderStatus();
    const speechStatus = Object.entries(speech.status)
      .map(([name, state]) => `${name}=${state}`)
      .join(' ');
    logger.info(`Provider suara: ${speech.chain.join(' > ') || 'none'} (${speechStatus})`, {
      chain: speech.chain,
      status: speech.status
    });
    // Sound-to-text: fitur ini BISA tidak siap sama sekali (tidak ada provider
    // transkripsi tanpa kredensial), jadi baris ini yang membedakan "kunci belum
    // sampai ke container" dari "providernya sedang bermasalah".
    const transcribe = getSpeechToTextStatus();
    const transcribeStatus = Object.entries(transcribe.status)
      .map(([name, state]) => `${name}=${state}`)
      .join(' ');
    logger.info(
      `Provider transkripsi: ${transcribe.chain.join(' > ') || 'none'} ` +
        `(ready=${transcribe.ready} ${transcribeStatus})`,
      { chain: transcribe.chain, ready: transcribe.ready, status: transcribe.status }
    );
    // Video: fitur ini juga bisa tidak siap sama sekali (tidak ada provider
    // video tanpa kredensial), jadi baris ini yang membedakan "BYNARA_API_KEY
    // belum sampai ke container" dari "providernya sedang bermasalah".
    const video = getVideoProviderStatus();
    const videoStatus = Object.entries(video.status)
      .map(([name, state]) => `${name}=${state}`)
      .join(' ');
    logger.info(
      `Provider video: ${video.chain.join(' > ') || 'none'} ` +
        `(ready=${video.ready} ${videoStatus})`,
      { chain: video.chain, ready: video.ready, status: video.status }
    );
  });
};

// Jalankan server hanya jika file ini dieksekusi langsung (`node server.js`).
// Saat di-require (mis. oleh test), app di-export tanpa membuka koneksi DB.
if (require.main === module) {
  startServer();
}

module.exports = { app, connectDB, startServer };