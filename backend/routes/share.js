/**
 * Routes: tautan baca-saja (publik).
 *
 * Dipisah dari `routes/media.js` karena aturan aksesnya berbeda: seluruh rute di
 * sana menuntut login dan kepemilikan record, sedangkan rute di sini justru harus
 * bisa dibuka orang yang belum punya akun — itulah gunanya membagikan tautan.
 * Memisahkannya membuat perbedaan itu terlihat dari struktur berkas, bukan dari
 * membaca satu per satu pemasangan middleware.
 *
 * Yang menjaga bukan autentikasi, melainkan TOKEN-nya: 192 bit acak yang hanya
 * ada di tautan yang dibagikan pemiliknya, dan bisa dicabut kapan saja
 * (`DELETE /api/v1/media/:contentId/share`). Handler-nya hanya mengirim bidang
 * tampilan (lihat `publicMediaView`), tidak pernah `userId`, `outputFile`, atau
 * pesan galat internal.
 */

const express = require('express');
const router = express.Router();
const { getSharedMedia } = require('../controllers/mediaController');

// Tanpa auth: lihat catatan di atas. Limiter global di server.js tetap berlaku,
// jadi endpoint ini tidak bisa dipakai untuk menyisir token satu per satu dalam
// jumlah besar.
router.get('/:token', getSharedMedia);

module.exports = router;
