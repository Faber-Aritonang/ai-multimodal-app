/**
 * Authentication Middleware
 * Memverifikasi token JWT dan/atau Firebase ID Token
 */

const jwt = require('jsonwebtoken');
const { getFirebaseAdmin } = require('../config/firebase');
// Aturan kuota (sisa, reservasi, dan pengembaliannya) tinggal di satu tempat
// supaya middleware dan controller tidak bisa berbeda pendapat.
const { remainingQuota, reserveQuota, refundQuota } = require('../config/quota');
const { logger } = require('../config/logger');
const User = require('../models/User');
const Admin = require('../models/Admin');

// Firebase Admin diinisialisasi secara lazy via config/firebase
// (getFirebaseAdmin) saat pertama kali dibutuhkan.

/**
 * Middleware untuk verifikasi JWT atau Firebase Token
 */
exports.authenticate = async (req, res, next) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }
    
    // Verifikasi JWT
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (jwtError) {
      // Jika JWT invalid, coba verifikasi Firebase token
      try {
        const decodedToken = await getFirebaseAdmin().auth().verifyIdToken(token);
        req.user = { uid: decodedToken.uid, email: decodedToken.email };
        return next();
      } catch (firebaseError) {
        throw new Error('Invalid token');
      }
    }
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

/**
 * Middleware untuk verifikasi token secara opsional
 * Tidak menolak request jika token tidak ada
 */
exports.optionalAuth = async (req, res, next) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (jwtError) {
      try {
        const decodedToken = await getFirebaseAdmin().auth().verifyIdToken(token);
        req.user = { uid: decodedToken.uid, email: decodedToken.email };
        return next();
      } catch (firebaseError) {
        req.user = null;
        return next();
      }
    }
  } catch (error) {
    req.user = null;
    return next();
  }
};

/**
 * Middleware untuk member (user yang sudah disetujui)
 */
exports.requireMember = async (req, res, next) => {
  try {
    // Pastikan user terautentikasi
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    // Cari user di database
    const user = await User.findOne({ uid: req.user.uid });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Cek apakah user sudah disetujui
    if (!user.isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending approval. Please wait for admin approval.',
        role: 'pending'
      });
    }
    
    if (user.role !== 'member') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Member role required.',
        role: user.role
      });
    }
    
    req.member = user;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

/**
 * Middleware untuk admin
 */
exports.requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const adminUser = await Admin.findOne({ uid: req.user.uid });
    
    if (!adminUser) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    req.admin = adminUser;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

/**
 * Middleware untuk guest (user yang belum daftar)
 */
exports.requireGuest = async (req, res, next) => {
  if (req.user && req.user.uid) {
    return res.status(400).json({
      success: false,
      message: 'Already authenticated'
    });
  }
  next();
};

/**
 * Ambil (reservasi) kuota untuk satu permintaan, lalu kembalikan bila gagal.
 *
 * Urutannya disengaja:
 *   1. tolak cepat dari angka yang sudah dibaca `requireMember` (tanpa tulis DB),
 *   2. reservasi ATOMIK sebelum handler menyentuh provider — inilah yang menutup
 *      celah "sisa 1 tapi 20 permintaan paralel semuanya lolos", dan
 *   3. kembalikan jatahnya bila respons akhirnya gagal (4xx/5xx), ditunggu
 *      SEBELUM respons dikirim supaya angka kuota yang dilihat klien final.
 *
 * Pengembalian dipasang di sini, bukan di tiap `catch` controller, karena jalur
 * gagal di controller bermacam-macam (validasi 400, provider 502, konfigurasi
 * 503, 500) dan satu yang terlewat berarti user kehilangan kuotanya.
 *
 * Pekerjaan yang berjalan SETELAH respons (video 202) tidak ditangani di sini:
 * statusnya 2xx, jadi reservasinya memang dipakai, dan `runVideoJob` sendiri
 * yang mengembalikannya bila pekerjaannya gagal.
 */
exports.checkQuota = (type) => {
  return async (req, res, next) => {
    try {
      if (!req.member) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const remaining = remainingQuota(req.member.quota, type);

      if (remaining === undefined || remaining <= 0) {
        return res.status(403).json({
          success: false,
          message: `Quota for ${type} exhausted. Please upgrade your plan.`
        });
      }

      const reservasi = await reserveQuota(req.member.uid, type);

      // Kalah balapan: permintaan lain mengambil sisa terakhir setelah
      // `requireMember` membaca dokumennya. Jawabannya sama dengan kuota habis.
      if (!reservasi) {
        return res.status(403).json({
          success: false,
          message: `Quota for ${type} exhausted. Please upgrade your plan.`
        });
      }

      req.quota = {
        type,
        // Kunci yang benar-benar dipotong (akun lama: audio -> videoGeneration).
        key: reservasi.key,
        quota: reservasi.quota,
        remaining: remainingQuota(reservasi.quota, type)
      };

      // Bungkus `res.json` supaya pengembalian selesai sebelum respons gagal
      // dikirim: klien tidak pernah menerima angka kuota yang masih "dipakai"
      // padahal permintaannya gagal. Jalur sukses tidak disentuh.
      const kirimJson = res.json.bind(res);
      let sudahDikembalikan = false;

      res.json = (body) => {
        if (sudahDikembalikan || res.statusCode < 400) return kirimJson(body);

        sudahDikembalikan = true;

        return refundQuota(req.member.uid, reservasi.key)
          .catch((error) => {
            // User kehilangan jatahnya kalau ini gagal; catat, tapi jangan
            // gagalkan respons yang sudah jadi.
            const log = req.log || logger;
            log.error('quota_refund_failed', {
              uid: req.member.uid,
              key: reservasi.key,
              error
            });
          })
          .then(() => {
            try {
              kirimJson(body);
            } catch (error) {
              // Respons sudah tidak bisa dikirim (mis. handler memanggil
              // res.json dua kali). Jangan biarkan rejection tanpa penangan
              // menjatuhkan proses hanya karena respons galat.
              const log = req.log || logger;
              log.error('response_send_failed', { error });
            }
          });
      };

      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Server error',
      });
    }
  };
};