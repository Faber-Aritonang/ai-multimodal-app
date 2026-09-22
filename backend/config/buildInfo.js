/**
 * Identitas build yang sedang berjalan.
 *
 * Dipakai langkah verifikasi job deploy untuk MEMBUKTIKAN bahwa kode yang live di
 * produksi benar-benar commit yang baru di-push. Sebelumnya job deploy hanya tahu
 * "perintah deploy-nya selesai" — itu tidak membedakan "kode baru sudah live" dari
 * "deploy gagal, prosesnya keluar 0, dan kode lama masih melayani user". Kelas
 * kegagalan itu sudah pernah terjadi di repo ini (kredensial penyimpanan yang
 * tidak berlaku, lihat catatan di workflow), jadi penanda ini menjawab pertanyaan
 * yang berbeda: bukan "apakah kredensialnya benar", melainkan "kode VERSI APA yang
 * sedang dipakai".
 *
 * Dua sumber, dengan urutan yang jelas:
 *   1. `RAILWAY_GIT_COMMIT_SHA` — diisi Railway sendiri untuk deployment yang
 *      berasal dari integrasi GitHub, yaitu setiap push ke `main`.
 *   2. `build-meta.json` — ditulis job CI tepat sebelum `railway up`. Jalur itu
 *      mengunggah direktori lokal dan tidak membawa metadata git, sehingga Railway
 *      tidak mengisi `RAILWAY_GIT_COMMIT_SHA` untuk deployment hasil CLI.
 *
 * Berkas penanda itu sengaja TIDAK masuk `.gitignore`: `railway up` menghormati
 * `.gitignore` (lihat flag `--no-gitignore` di CLI-nya), jadi berkas yang
 * di-ignore justru akan hilang dari unggahan. Job-nya menghapusnya kembali setelah
 * unggahan selesai, sehingga tidak pernah ikut ter-commit.
 *
 * Fungsi di sini tidak pernah melempar: berkas yang tidak ada, tidak bisa dibaca,
 * atau isinya bukan SHA menghasilkan `commit: null`. `/health` tidak boleh mati
 * hanya karena penanda build-nya rusak.
 *
 * Env:
 *   RAILWAY_GIT_COMMIT_SHA   diisi platform (jalur integrasi GitHub)
 *   BUILD_META_PATH          lokasi berkas penanda (default: build-meta.json di
 *                            akar `backend/`); dipakai test supaya tidak menulis
 *                            ke berkas milik repo
 */

const fs = require('fs');
const path = require('path');

const GIT_COMMIT_ENV = 'RAILWAY_GIT_COMMIT_SHA';
const BUILD_META_FILE = 'build-meta.json';

// SHA git: 7 karakter (singkatan terpendek yang lazim) sampai 64 (SHA-256).
// Apapun di luar bentuk ini bukan commit — mis. nilai placeholder atau berkas
// yang isinya salah tulis — dan lebih berguna dilaporkan sebagai "tidak diketahui"
// daripada diteruskan apa adanya ke sisi yang membandingkannya.
const POLA_SHA = /^[0-9a-f]{7,64}$/i;

const normalisasi = (nilai) => {
  const teks = String(nilai || '').trim().toLowerCase();
  return POLA_SHA.test(teks) ? teks : null;
};

const berkasPenanda = () =>
  String(process.env.BUILD_META_PATH || '').trim() ||
  path.join(__dirname, '..', BUILD_META_FILE);

/**
 * Baca penanda yang ditulis job CI (`{ "commit": "...", "builtAt": "..." }`).
 * Berkas yang tidak ada / bukan JSON / isinya bukan SHA semuanya berarti `null`.
 */
const bacaPenanda = () => {
  try {
    const isi = JSON.parse(fs.readFileSync(berkasPenanda(), 'utf8'));
    return normalisasi(typeof isi === 'string' ? isi : isi?.commit);
  } catch {
    return null;
  }
};

/**
 * @returns {{ commit: string|null, source: 'railway-git'|'build-meta'|null }}
 *   `source` dibedakan karena dua jalur deployment itu berperilaku sama saat
 *   benar tetapi berbeda saat salah — persis alasan `storageCredentialSource`
 *   ada: "kenapa penandanya tidak terbaca" hanya bisa dijawab kalau jalurnya
 *   diketahui.
 */
const getBuildInfo = () => {
  const dariPlatform = normalisasi(process.env[GIT_COMMIT_ENV]);
  if (dariPlatform) return { commit: dariPlatform, source: 'railway-git' };

  const dariPenanda = bacaPenanda();
  if (dariPenanda) return { commit: dariPenanda, source: 'build-meta' };

  return { commit: null, source: null };
};

module.exports = { getBuildInfo, GIT_COMMIT_ENV, BUILD_META_FILE, berkasPenanda };
