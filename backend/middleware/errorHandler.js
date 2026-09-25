/**
 * Middleware: penangan galat terpusat (paling akhir).
 *
 * Sebelum ini isinya hanya `console.error(err.stack)` lalu mengirim
 * `err.message` apa adanya. Dua akibatnya:
 *
 *   1. Galat yang lolos ke sini hampir selalu berarti BUG atau kegagalan
 *      infrastruktur, tetapi tidak punya `requestId` — jadi tidak bisa
 *      dihubungkan dengan request yang memicunya.
 *   2. Pesan internal dikirim ke klien. Pesan MongoDB, pesan provider, dan nama
 *      variabel lingkungan adalah contoh yang pernah muncul; bagi user itu tidak
 *      bisa ditindaklanjuti, dan bagi siapa pun di luar itu ia memberi tahu
 *      bentuk dalam sistem. Karena itu pesan hanya diteruskan apa adanya di luar
 *      production (saat itulah isinya berguna), sedangkan di production user
 *      menerima pesan umum + `requestId` untuk dilaporkan. Detail lengkapnya
 *      tetap ada di log dan di daftar galat admin.
 *
 * Galat bawaan Express/body-parser diterjemahkan lebih dulu, karena beberapa di
 * antaranya memang pesan yang bisa ditindaklanjuti user (body terlalu besar,
 * JSON rusak) dan bukan kegagalan server.
 */

const { logger } = require('../config/logger');
const { recordError } = require('../config/errorLog');

const PESAN_BODY_TERLALU_BESAR =
  'Request body is too large. Reduce the size (for image/audio input, resize it first) and try again.';
const PESAN_JSON_RUSAK = 'Invalid JSON body.';
const PESAN_UMUM = 'Internal Server Error';

/** Status HTTP yang sah; nilai aneh dari galat pihak ketiga dinormalkan ke 500. */
const normalisasiStatus = (nilai) => {
  const angka = Number(nilai);
  return Number.isInteger(angka) && angka >= 400 && angka <= 599 ? angka : 500;
};

/**
 * Terjemahkan galat bawaan body-parser/Express menjadi pesan yang bisa
 * ditindaklanjuti. `null` berarti tidak ada padanan khusus.
 */
const pesanBawaan = (err) => {
  const tipe = err && err.type;

  if (tipe === 'entity.too.large') return PESAN_BODY_TERLALU_BESAR;
  if (tipe === 'entity.parse.failed') return PESAN_JSON_RUSAK;

  return null;
};

const errorHandler = (err, req, res, next) => {
  // Respons sudah terkirim setengah jalan (mis. galat saat streaming): satu-
  // satunya tindakan yang benar adalah menyerahkan ke penangan bawaan Express,
  // karena header dan status sudah tidak bisa diubah lagi.
  if (res.headersSent) return next(err);

  const status = normalisasiStatus(err && (err.status || err.statusCode));
  const diProduction = process.env.NODE_ENV === 'production';
  const log = req.log || logger;

  const konteks = {
    status,
    code: err && err.code,
    method: req.method,
    path: (req.originalUrl || req.url || '').split('?')[0],
    uid: (req.user && req.user.uid) || (req.member && req.member.uid) || undefined,
    error: err
  };

  // 5xx = aplikasi gagal melayani; itulah yang perlu dilihat cepat, jadi
  // dicatat sebagai error. 4xx yang sampai ke sini (mis. body terlalu besar)
  // tetap dicatat, tetapi sebagai warn supaya tidak ikut membangunkan alarm.
  const level = status >= 500 ? 'error' : 'warn';
  log[level]('request_failed', konteks);

  recordError({
    source: 'server',
    message: (err && err.message) || PESAN_UMUM,
    status,
    method: konteks.method,
    path: konteks.path,
    code: konteks.code,
    stack: err && err.stack,
    requestId: req.id,
    uid: konteks.uid
  });

  const pesan =
    pesanBawaan(err) || (status >= 500 && diProduction ? PESAN_UMUM : (err && err.message) || PESAN_UMUM);

  return res.status(status).json({
    success: false,
    message: pesan,
    // Id ini yang membuat laporan user bisa dicari di log. Dikirim juga saat
    // sukses (lihat requestContext), tetapi di sini ia paling dibutuhkan.
    ...(req.id ? { requestId: req.id } : {}),
    // Di luar production, pesan aslinya ikut dikirim untuk memudahkan debugging;
    // di production kolom ini sengaja tidak ada.
    ...(status >= 500 && !diProduction && err ? { error: err.message } : {})
  });
};

module.exports = {
  errorHandler,
  normalisasiStatus,
  pesanBawaan,
  PESAN_BODY_TERLALU_BESAR,
  PESAN_JSON_RUSAK,
  PESAN_UMUM
};
