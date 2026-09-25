/**
 * Middleware: batas permintaan per fitur.
 *
 * Limiter global di server.js adalah jaring pengaman terhadap penyalahgunaan,
 * bukan pembatas per fitur: batasnya sengaja longgar (1000 permintaan / 15
 * menit) karena satu kali membuka dashboard sudah memanggil beberapa endpoint.
 * Akibatnya endpoint MAHAL tidak punya pembatas sama sekali — satu permintaan
 * video bisa memakan 1-5 menit pekerjaan provider berbayar, dan satu akun bisa
 * mengirim puluhan permintaan beruntun tanpa pernah menyentuh batas global.
 *
 * Limiter ini menghitung per USER (uid dari token), bukan per IP. Satu kantor
 * atau sekolah bisa keluar lewat satu IP yang sama, jadi hitungan per IP akan
 * membuat satu orang yang membanjiri endpoint ikut mengunci rekan-rekannya.
 *
 * Pemasangannya: setelah `authenticate` + `requireMember` (uid harus sudah ada)
 * dan SEBELUM `checkQuota`. Dengan begitu permintaan yang ditolak karena terlalu
 * sering tidak pernah sampai ke provider, jadi kuota user tidak ikut terpakai —
 * sama seperti pemeriksaan kuota yang juga berjalan sebelum handler.
 *
 * Batas bisa disesuaikan lewat env (lihat .env.example):
 *   FEATURE_RATE_LIMIT_WINDOW_MS
 *   FEATURE_RATE_LIMIT_CHAT_MAX
 *   FEATURE_RATE_LIMIT_IMAGE_MAX
 *   FEATURE_RATE_LIMIT_AUDIO_MAX
 *   FEATURE_RATE_LIMIT_VIDEO_MAX
 */

const rateLimit = require('express-rate-limit');

const DEFAULT_WINDOW_MS = 60 * 1000;

// Batas bawaan dipilih dari berapa lama satu permintaan benar-benar selesai:
// chat beberapa detik, gambar 20-60 detik, audio puluhan detik, video 1-5 menit.
// Angkanya lebih tinggi dari jumlah permintaan wajar dalam satu menit, tetapi
// jauh lebih rendah dari jumlah yang dibutuhkan skrip untuk membebani provider.
// Chat paling longgar karena satu percakapan wajar mengirim beberapa pesan
// pendek berurutan — yang ditahan bukan itu, melainkan penembakan beruntun.
const FEATURES = {
  chat: {
    envVar: 'FEATURE_RATE_LIMIT_CHAT_MAX',
    fallback: 60,
    label: 'chat'
  },
  image: {
    envVar: 'FEATURE_RATE_LIMIT_IMAGE_MAX',
    fallback: 30,
    label: 'image generation'
  },
  audio: {
    envVar: 'FEATURE_RATE_LIMIT_AUDIO_MAX',
    fallback: 30,
    label: 'audio generation'
  },
  video: {
    envVar: 'FEATURE_RATE_LIMIT_VIDEO_MAX',
    fallback: 20,
    label: 'video generation'
  }
};

/** Jendela waktu limiter per fitur. Nilai env yang tidak masuk akal diabaikan. */
const resolveWindowMs = () => {
  const parsed = parseInt(process.env.FEATURE_RATE_LIMIT_WINDOW_MS, 10);
  return parsed > 0 ? parsed : DEFAULT_WINDOW_MS;
};

/** Batas permintaan untuk satu fitur. */
const resolveMax = (feature) => {
  const parsed = parseInt(process.env[FEATURES[feature].envVar], 10);
  return parsed > 0 ? parsed : FEATURES[feature].fallback;
};

/**
 * Factory middleware untuk satu fitur ('chat' | 'image' | 'audio' | 'video').
 *
 * @param {'chat'|'image'|'audio'|'video'} feature
 */
exports.featureRateLimit = (feature) => {
  const config = FEATURES[feature];

  if (!config) {
    throw new Error(`Unknown feature rate limit: ${feature}`);
  }

  const windowMs = resolveWindowMs();
  const max = resolveMax(feature);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Route pemasangnya sudah melewati `authenticate`, jadi uid selalu ada.
    // 'anonymous' hanya jaring pengaman supaya middleware ini tidak pernah
    // menggabungkan semua permintaan tanpa identitas ke dalam satu hitungan.
    keyGenerator: (req) => req.user?.uid || 'anonymous',
    // Balas JSON seperti limiter global: tanpa `message`, frontend hanya
    // menampilkan pesan axios mentah "Request failed with status code 429".
    handler: (req, res) => {
      const resetTime = req.rateLimit && req.rateLimit.resetTime;
      const retryAfter = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);

      const windowSeconds = Math.max(1, Math.round(windowMs / 1000));

      res.status(429).json({
        success: false,
        message:
          `Too many ${config.label} requests (limit ${max} per ` +
          `${windowSeconds} seconds). Please try again in ${retryAfter} seconds.`,
        retryAfter
      });
    }
  });
};
