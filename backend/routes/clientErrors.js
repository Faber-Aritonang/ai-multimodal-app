/**
 * Routes: laporan galat dari frontend.
 *
 * Galat yang terjadi di browser (error boundary React, promise yang tidak
 * ditangani, permintaan API yang gagal) sebelumnya hanya muncul di console
 * DevTools milik user itu sendiri — jadi satu-satunya cara mengetahuinya adalah
 * user melapor, dan laporannya hampir selalu kehilangan konteks (versi kode,
 * endpoint, id request).
 *
 * Endpoint ini menerimanya dan menaruhnya di tempat yang sama dengan galat
 * server: log terstruktur + daftar galat admin (lihat config/errorLog.js).
 * Dengan begitu satu penyebab — misalnya endpoint yang berubah nama — terlihat
 * dari dua sisi sekaligus.
 *
 * Endpoint ini PUBLIK (tanpa auth) karena kegagalan di halaman login dan
 * halaman menunggu persetujuan tidak boleh luput hanya karena user belum punya
 * token. Karena publik, ia dibatasi ketat per alamat IP: satu tab yang
 * berulang-ulang gagal bisa mengirim puluhan laporan per menit, dan tanpa batas
 * itu ia menjadi cara gratis untuk membanjiri log (log repo ini publik dan
 * berbayar per volume).
 *
 * Isi yang dikirim sengaja TIDAK divalidasi ketat: yang dilaporkan adalah
 * pesan galat, dan pesan galat apa pun tetap berguna. Yang dijaga hanya
 * bentuknya (harus string) dan panjangnya, lalu disimpan sebagai data — bukan
 * dijalankan, bukan digabungkan ke query.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { recordError } = require('../config/errorLog');

const router = express.Router();

const MAX_MESSAGE = 500;
const MAX_STACK = 2000;
const MAX_URL = 300;
const MAX_KIND = 40;

// Batas bawaan: 30 laporan / menit / IP. Cukup untuk tab yang sedang bermasalah
// (yang mengirim sekali per galat, bukan per render), tetapi jauh dari cukup
// untuk dijadikan alat membanjiri log.
const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX = 30;

const resolveWindowMs = () => {
  const parsed = parseInt(process.env.CLIENT_ERROR_WINDOW_MS, 10);
  return parsed > 0 ? parsed : DEFAULT_WINDOW_MS;
};

const resolveMax = () => {
  const parsed = parseInt(process.env.CLIENT_ERROR_LIMIT_MAX, 10);
  return parsed > 0 ? parsed : DEFAULT_MAX;
};

const laporkanLimiter = rateLimit({
  windowMs: resolveWindowMs(),
  max: resolveMax(),
  standardHeaders: true,
  legacyHeaders: false,
  // Balas JSON seperti limiter lain: frontend yang gagal melapor tidak boleh
  // menampilkan pesan axios mentah "Request failed with status code 429".
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many error reports. Slow down.',
      retryAfter: DEFAULT_WINDOW_MS / 1000
    });
  }
});

const teks = (nilai, batas) => {
  if (typeof nilai !== 'string') return undefined;
  const rapi = nilai.trim();
  if (!rapi) return undefined;
  return rapi.length > batas ? rapi.slice(0, batas) : rapi;
};

/**
 * @POST /api/v1/client-errors
 *
 * Body (semua kecuali `message` bersifat opsional):
 *   message        pesan galat (wajib)
 *   kind           'error' | 'unhandledrejection' | 'boundary' | 'api'
 *   stack          stack trace bila ada
 *   componentStack stack komponen React (dari error boundary)
 *   url            halaman tempat kejadian
 *   requestId      id request backend yang gagal, bila galatnya dari API
 *
 * Membalas 202: laporannya diterima untuk dicatat, bukan diproses lebih lanjut.
 */
router.post('/', laporkanLimiter, (req, res) => {
  const body = req.body || {};
  const pesan = teks(body.message, MAX_MESSAGE);

  if (!pesan) {
    return res.status(400).json({
      success: false,
      message: 'message is required'
    });
  }

  const entri = {
    source: 'client',
    message: pesan,
    kind: teks(body.kind, MAX_KIND),
    // Stack dari boundary digabung supaya satu laporan tetap terbaca sebagai
    // satu kejadian; kolomnya dipisah agar tetap jelas asalnya.
    stack: [teks(body.stack, MAX_STACK), teks(body.componentStack, MAX_STACK)]
      .filter(Boolean)
      .join('\n--- component stack ---\n') || undefined,
    path: teks(body.url, MAX_URL),
    requestId: teks(body.requestId, 100),
    uid: req.user && req.user.uid
  };

  req.log.warn('client_error', {
    kind: entri.kind,
    path: entri.path,
    message: entri.message,
    requestIdBackend: entri.requestId
  });

  recordError(entri);

  return res.status(202).json({ success: true, message: 'Error report received' });
});

module.exports = router;
