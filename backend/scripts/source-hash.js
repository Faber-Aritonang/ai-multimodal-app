#!/usr/bin/env node

/**
 * Cetak sidik isi kode backend (`config/sourceHash`).
 *
 * Dipakai job deploy: nilai yang dicetak di sini dibandingkan dengan `sourceHash`
 * di `/health` produksi. Karena keduanya dihitung oleh kode yang sama, angka
 * yang sama berarti berkas backend di container identik dengan yang di-push —
 * tanpa bergantung pada commit yang dilaporkan platform.
 *
 * Pemakaian:
 *   node backend/scripts/source-hash.js
 */

const { hitungSourceHash, AKAR } = require('../config/sourceHash');

const sidik = hitungSourceHash(AKAR);

// Hanya nilai sidiknya yang ke stdout: skrip ini dipakai lewat `$(...)` di CI,
// jadi baris tambahan apa pun akan ikut terbaca sebagai nilai.
console.log(sidik);

if (!process.env.GITHUB_ACTIONS) {
  console.error(`(sidik ${AKAR})`);
}
