#!/usr/bin/env node
/**
 * Penjaga registri spec browser.
 *
 * Latar belakangnya nyata: uji browser (`frontend/tests/browser`) dijalankan
 * manual, tidak di CI (alasannya di README, bagian pengujian). Konsekuensi dari
 * "manual" adalah spec yang tidak pernah didaftarkan di `run.cjs` TIDAK PERNAH
 * dijalankan oleh siapa pun — berkasnya ada, tampak seperti pengujian, dan
 * memberi rasa aman yang salah. Persis itu yang terjadi pada `history.spec.cjs`
 * sebelum ia didaftarkan.
 *
 * Penjaga ini menutup celah itu dengan biaya mendekati nol: ia tidak perlu
 * browser, server, maupun database — hanya membaca daftar berkas dan isi
 * `run.cjs`. Karena itu ia bisa jalan di job `quality` CI untuk setiap PR, di
 * tempat yang memang murah.
 *
 * Aturan yang diperiksa:
 *   1. setiap `specs/*.spec.cjs` terdaftar (di-`require`) di `run.cjs`;
 *   2. setiap `require('./specs/…')` di `run.cjs` menunjuk berkas yang ada;
 *   3. setiap spec mengekspor `{ name, run }` — bentuk yang dipakai runner —
 *      dan namanya unik (`TEST_SPECS` memfilter berdasarkan nama, jadi nama
 *      ganda membuat satu spec mustahil dipilih);
 *   4. tidak ada berkas `*.spec.js` / `*.spec.mjs`: suite ini CommonJS
 *      (`.cjs`), sehingga berkas dengan ekstensi lain akan dilewati tanpa
 *      pesan apa pun saat runner mencari spec.
 *
 * Pemakaian:
 *   node scripts/check-browser-specs.js
 *
 * Keluar dengan kode 1 kalau ada temuan.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const AKAR_DEFAULT = path.resolve(__dirname, '..');
const SPEC_DIR = 'frontend/tests/browser/specs';
const RUNNER = 'frontend/tests/browser/run.cjs';
const AKHIRAN_SPEC = '.spec.cjs';
const EKSTENSI_SALAH = ['.spec.js', '.spec.mjs', '.spec.ts'];

// `require('./specs/nama.spec.cjs')` — jalur relatif terhadap run.cjs.
const POLA_REQUIRE = /require\(\s*['"](\.\/specs\/[^'"]+)['"]\s*\)/g;

/** Jalur spec yang di-require `run.cjs`, dalam urutan penulisannya. */
const daftarRequireRunner = (isi) =>
  [...String(isi || '').matchAll(POLA_REQUIRE)].map((cocok) => cocok[1]);

/**
 * Periksa konsistensi registri spec.
 *
 * @param {{akar?: string}} [opsi] `akar` = akar repo (bisa diganti test)
 * @returns {Array<{jenis: string, berkas: string, pesan: string}>} temuan
 */
const periksaRegistri = ({ akar = AKAR_DEFAULT } = {}) => {
  const temuan = [];
  const berkasRunner = path.join(akar, RUNNER);
  const direktorSpec = path.join(akar, SPEC_DIR);

  if (!fs.existsSync(berkasRunner)) {
    return [
      {
        jenis: 'runner-hilang',
        berkas: RUNNER,
        pesan: `runner uji browser tidak ditemukan di ${RUNNER}`
      }
    ];
  }

  if (!fs.existsSync(direktorSpec)) {
    return [
      {
        jenis: 'folder-hilang',
        berkas: SPEC_DIR,
        pesan: `folder spec tidak ditemukan di ${SPEC_DIR}`
      }
    ];
  }

  // Dinormalkan tanpa awalan `./` supaya perbandingannya dengan nama berkas di
  // direktori spec tidak bergantung pada cara penulisannya di run.cjs.
  const terdaftar = daftarRequireRunner(fs.readFileSync(berkasRunner, 'utf8')).map((jalur) =>
    jalur.replace(/^\.\//, '')
  );
  const isiDirektori = fs.readdirSync(direktorSpec);
  const berkasSpec = isiDirektori.filter((nama) => nama.endsWith(AKHIRAN_SPEC)).sort();

  // 1. Spec yang tidak pernah dijalankan.
  for (const nama of berkasSpec) {
    if (!terdaftar.includes(`specs/${nama}`)) {
      temuan.push({
        jenis: 'tidak-terdaftar',
        berkas: `${SPEC_DIR}/${nama}`,
        pesan:
          `spec "${nama}" tidak di-require di ${RUNNER}, sehingga tidak pernah dijalankan. ` +
          'Tambahkan require-nya ke daftar ALL_SPECS.'
      });
    }
  }

  // 2. Require yang menunjuk berkas tidak ada (mis. spec yang di-rename).
  for (const jalur of terdaftar) {
    const berkas = path.join(path.dirname(berkasRunner), jalur);
    if (!fs.existsSync(berkas)) {
      temuan.push({
        jenis: 'berkas-hilang',
        berkas: `${path.dirname(RUNNER)}/${jalur}`,
        pesan: `${RUNNER} me-require "${jalur}" tetapi berkasnya tidak ada`
      });
    }
  }

  // 4. Ekstensi yang tidak akan pernah dibaca runner.
  for (const nama of isiDirektori) {
    if (EKSTENSI_SALAH.some((ekstensi) => nama.endsWith(ekstensi))) {
      temuan.push({
        jenis: 'ekstensi-salah',
        berkas: `${SPEC_DIR}/${nama}`,
        pesan:
          `spec "${nama}" memakai ekstensi yang tidak dikenali runner ` +
          `(suite ini CommonJS; pakai ${AKHIRAN_SPEC})`
      });
    }
  }

  // 3. Bentuk ekspor & nama unik.
  const namaTerpakai = new Map();

  for (const nama of berkasSpec) {
    let modul;

    try {
      modul = require(path.join(direktorSpec, nama));
    } catch (error) {
      temuan.push({
        jenis: 'gagal-dimuat',
        berkas: `${SPEC_DIR}/${nama}`,
        pesan: `spec "${nama}" gagal di-require: ${error.message}`
      });
      continue;
    }

    if (
      !modul ||
      typeof modul.name !== 'string' ||
      !modul.name.trim() ||
      typeof modul.run !== 'function'
    ) {
      temuan.push({
        jenis: 'bentuk-salah',
        berkas: `${SPEC_DIR}/${nama}`,
        pesan: `spec "${nama}" harus mengekspor { name: string, run: function }`
      });
      continue;
    }

    if (namaTerpakai.has(modul.name)) {
      temuan.push({
        jenis: 'nama-ganda',
        berkas: `${SPEC_DIR}/${nama}`,
        pesan:
          `nama spec "${modul.name}" sudah dipakai ${namaTerpakai.get(modul.name)} — ` +
          'TEST_SPECS memfilter berdasarkan nama, jadi salah satunya tidak bisa dijalankan sendiri'
      });
      continue;
    }

    namaTerpakai.set(modul.name, nama);
  }

  return temuan;
};

const main = () => {
  const temuan = periksaRegistri();

  if (!temuan.length) {
    const jumlah = fs.readdirSync(path.join(AKAR_DEFAULT, SPEC_DIR)).filter((nama) =>
      nama.endsWith(AKHIRAN_SPEC)
    ).length;

    console.log(`Registri spec browser sehat: ${jumlah} spec terdaftar dan bisa dimuat.`);
    return 0;
  }

  console.error('Ada masalah pada registri spec browser:');
  temuan.forEach((item) => console.error(`  - ${item.berkas}: ${item.pesan}`));
  return 1;
};

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  periksaRegistri,
  daftarRequireRunner,
  main,
  AKAR_DEFAULT,
  SPEC_DIR,
  RUNNER,
  AKHIRAN_SPEC
};
