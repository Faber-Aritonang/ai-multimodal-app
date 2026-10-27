/**
 * Sidik isi kode backend.
 *
 * Kenapa ada: job deploy harus bisa membuktikan bahwa kode yang live di
 * produksi adalah kode yang baru di-push, bukan sekadar "perintah deploy-nya
 * selesai". Cara yang dipakai sebelumnya adalah membandingkan commit yang
 * dilaporkan platform (`RENDER_GIT_COMMIT`) — dan cara itu bergantung pada
 * metadata yang tidak selalu ada. Kegagalan nyatanya: `/health` produksi
 * melaporkan `commit: null` karena Render tidak mengisi variabel itu pada
 * container yang sedang berjalan, sehingga job deploy tidak punya pembanding
 * dan merah terus walau kode barunya benar-benar sudah live.
 *
 * Sidik ini menjawab pertanyaan yang sama tanpa meminta bantuan platform: SHA-256
 * dari isi berkas-berkas di `backend/` (path relatif + isi tiap berkas), dihitung
 * dengan aturan yang sama di checkout CI dan di container produksi. Kalau
 * nilainya sama, isi kodenya identik — itu bukti yang lebih kuat daripada nomor
 * commit, karena tidak bisa "benar" untuk kode yang sudah basi.
 *
 * Yang TIDAK ikut dihitung adalah berkas yang wajar berbeda antara dua
 * lingkungan: `node_modules` (hasil `npm ci`, bisa berbeda versi minor),
 * `package-lock.json` (sebagian builder menulisnya ulang), `uploads/` (berkas
 * user), `.env*` (rahasia, tidak ada di CI), `build-meta.json` (ditulis job
 * lama), serta `coverage/`, `tmp/`, dan `*.log` yang isinya berubah tanpa
 * perubahan kode.
 *
 * Hitungannya di-cache: `/health` bisa dipanggil berulang kali (monitor, job
 * deploy), sedangkan isi berkas tidak berubah selama proses hidup.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');

const ABAIKAN_DIR = new Set(['node_modules', '.git', 'uploads', 'coverage', 'tmp', '.cache', 'dist']);

// `package-lock.json` sengaja dilewati: sebagian builder menjalankan
// `npm install` (bukan `npm ci`) sehingga berkas itu bisa ditulis ulang —
// `resolved`/`integrity` ditambahkan, urutan berubah — tanpa satu baris kode
// aplikasi ikut berubah. Sidik ini menjawab "kode versi apa yang live", bukan
// "apakah pohon dependency-nya identik"; versi dependency sudah dikunci
// `package.json` + lock dan dipasang `npm ci` di CI. Menghitung lock di sini
// hanya menghasilkan kemerahan yang tidak bisa diperbaiki dari repo.
const ABAIKAN_BERKAS = new Set(['build-meta.json', '.DS_Store', 'package-lock.json']);

// `.env`, `.env.local`, `.env.example`, …: semuanya dilewati. Berkas contoh
// isinya sama di kedua sisi, tetapi aturan "tidak ada berkas .env yang dihitung"
// lebih mudah dipercaya daripada pengecualian per nama.
const POLA_ENV = /^\.env(\..*)?$/;
const POLA_LOG = /\.log$/i;

// Perbandingan byte-wise, bukan `localeCompare`: hasilnya tidak boleh bergantung
// pada locale proses (LC_ALL berbeda antara runner CI dan container Render).
const urutkan = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

const kumpulkan = (dir, akar, baris) => {
  for (const entri of fs.readdirSync(dir, { withFileTypes: true }).sort(urutkan)) {
    const jalur = path.join(dir, entri.name);

    if (entri.isDirectory()) {
      if (!ABAIKAN_DIR.has(entri.name)) kumpulkan(jalur, akar, baris);
      continue;
    }

    if (!entri.isFile()) continue;
    if (ABAIKAN_BERKAS.has(entri.name)) continue;
    if (POLA_ENV.test(entri.name) || POLA_LOG.test(entri.name)) continue;

    // Selalu relatif terhadap akar dan selalu dengan `/`, supaya path di Windows
    // tidak menghasilkan sidik yang berbeda dari Linux.
    const relatif = path.relative(akar, jalur).split(path.sep).join('/');
    const isi = crypto.createHash('sha256').update(fs.readFileSync(jalur)).digest('hex');

    // Pemisah NUL memisahkan path dari isi sehingga dua berkas berbeda tidak
    // bisa menghasilkan teks gabungan yang sama.
    baris.push(`${relatif}\0${isi}\n`);
  }

  return baris;
};

/**
 * Hitung sidik untuk satu direktori backend.
 *
 * @param {string} [akar] direktori yang dihitung (default: `backend/`); dipakai
 *   test supaya tidak bergantung pada isi repo yang sedang berubah.
 * @returns {string} SHA-256 heksadesimal 64 karakter
 */
const hitungSourceHash = (akar = AKAR) =>
  crypto.createHash('sha256').update(kumpulkan(akar, akar, []).join('')).digest('hex');

let tersimpan = null;

/**
 * Sidik kode yang sedang berjalan, dihitung sekali per proses.
 *
 * Tidak pernah melempar: `/health` tidak boleh mati hanya karena direktori kode
 * tidak terbaca. Kegagalan menghasilkan `null`, yang membuat job deploy merah
 * dengan pesan "tidak ada bukti", bukan hijau.
 *
 * @returns {string|null}
 */
const getSourceHash = () => {
  if (tersimpan) return tersimpan;

  try {
    tersimpan = hitungSourceHash();
  } catch {
    tersimpan = null;
  }

  return tersimpan;
};

module.exports = { getSourceHash, hitungSourceHash, AKAR };
