/**
 * Middleware: identitas satu request.
 *
 * Tugasnya satu, tetapi dua hal bergantung padanya:
 *
 *   1. `req.id` + header `X-Request-Id` pada respons. Inilah yang membuat
 *      laporan dari user bisa ditelusuri: user menyebut id dari respons/UI,
 *      lalu satu pencarian di log menemukan seluruh baris request itu. Tanpa
 *      id, laporan "gagal waktu generate gambar" hanya bisa dicocokkan dengan
 *      waktu kejadian — dan itu tidak cukup begitu ada dua user bersamaan.
 *
 *   2. `req.log`, logger anak (config/logger.js) yang sudah membawa id itu.
 *      Setiap pemanggil di bawahnya cukup memakai `req.log.warn(...)` dan
 *      barisnya otomatis bisa dihubungkan ke request-nya.
 *
 * Id dari klien DITERIMA (header `X-Request-Id`), bukan selalu dibuat ulang.
 * Alasannya: frontend mengirim id yang sama untuk semua permintaan satu alur
 * (lihat frontend/src/utils/errorReporter.js), sehingga kegagalan di browser
 * dan kegagalan di server untuk alur yang sama punya satu id.
 *
 * Nilai dari klien tetap disaring: hanya huruf/angka/`.`/`_`/`-`, maksimal 128
 * karakter. Tanpa penyaringan ini, header bisa dipakai untuk menyisipkan baris
 * palsu ke log (log injection) atau membuat header respons panjang tak terbatas
 * — dan keduanya merusak justru alat yang sedang dibangun di sini.
 */

const crypto = require('crypto');
const { logger } = require('../config/logger');

const HEADER_REQUEST_ID = 'x-request-id';
const MAKS_PANJANG = 128;
const POLA_AMAN = /^[A-Za-z0-9._-]+$/;

/**
 * Pakai id dari klien hanya kalau bentuknya wajar.
 * @returns {string|null}
 */
const idDariKlien = (nilai) => {
  const teks = String(nilai || '').trim();

  if (!teks || teks.length > MAKS_PANJANG || !POLA_AMAN.test(teks)) return null;

  return teks;
};

const requestContext = (req, res, next) => {
  req.id = idDariKlien(req.headers && req.headers[HEADER_REQUEST_ID]) || crypto.randomUUID();

  // Dikirim balik supaya bisa dilihat di DevTools dan disalin ke laporan.
  if (typeof res.setHeader === 'function') res.setHeader('X-Request-Id', req.id);

  req.log = logger.child({ requestId: req.id });

  next();
};

module.exports = { requestContext, HEADER_REQUEST_ID, MAKS_PANJANG, POLA_AMAN };
