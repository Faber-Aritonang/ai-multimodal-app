/**
 * Middleware: log akses HTTP.
 *
 * Menggantikan `morgan('dev')`. Bentuknya sengaja dibuat sendiri karena morgan
 * tidak bisa menaikkan LEVEL baris berdasarkan status: seluruh keluarannya satu
 * jenis. Padahal justru itu yang dibutuhkan saat mencari masalah — request 500
 * harus bisa disaring dari ribuan request normal tanpa membaca semuanya.
 *
 * Pencatatan dilakukan saat respons SELESAI (`finish`), bukan saat masuk:
 * hanya di situ status dan durasinya sudah pasti. Artinya satu request hanya
 * menghasilkan satu baris log, sama seperti morgan.
 *
 * Level:
 *   5xx -> error   (server gagal melayani)
 *   4xx -> warn    (klien salah atau dibatasi; 429 termasuk di sini, dan sengaja
 *                   tetap terlihat karena itulah gejala paling awal saat ada
 *                   penyalahgunaan atau batas yang terlalu ketat)
 *   lain -> info
 *
 * Berkas statis `/uploads` tidak dicatat. Isinya hanya gambar/audio/video milik
 * satu halaman, bisa puluhan berkas sekali buka, dan tidak satu pun menjelaskan
 * kegagalan aplikasi — kalau dicatat, baris yang penting justru tenggelam.
 */

const { logger } = require('../config/logger');

/** Path yang tidak pernah dicatat (alasan di catatan atas modul). */
const DILEWATI = ['/uploads'];

const dilewati = (req) => {
  const path = req.path || (req.originalUrl || '').split('?')[0] || '';
  return DILEWATI.some((awalan) => path.startsWith(awalan));
};

const levelUntuk = (status) => {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
};

const requestLogger = (req, res, next) => {
  if (dilewati(req)) return next();

  const mulai = process.hrtime.bigint();

  res.on('finish', () => {
    const durasiMs = Number(process.hrtime.bigint() - mulai) / 1e6;
    const status = res.statusCode;

    // Query string tidak dicatat: nilainya bisa memuat kata kunci pencarian
    // riwayat milik user, dan untuk menelusuri masalah nilainya tidak pernah
    // diperlukan (path sudah cukup untuk membedakan endpoint).
    const path = (req.originalUrl || req.url || '').split('?')[0];

    (req.log || logger)[levelUntuk(status)]('request', {
      method: req.method,
      path,
      status,
      durationMs: Math.round(durasiMs * 10) / 10,
      uid: (req.user && req.user.uid) || (req.member && req.member.uid) || null,
      // Ukuran respons hanya berguna untuk kasus lambat/berat (media).
      bytes: res.getHeader && res.getHeader('content-length')
        ? Number(res.getHeader('content-length'))
        : undefined
    });
  });

  next();
};

module.exports = { requestLogger, DILEWATI, levelUntuk };
