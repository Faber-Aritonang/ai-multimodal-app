#!/usr/bin/env node
/**
 * Penjaga berkas rahasia.
 *
 * Kegunaan: menggagalkan commit / CI kalau ada berkas yang bentuknya seperti
 * kredensial ikut masuk ke repo. Latar belakangnya nyata: `backend/.env.save.1`
 * sempat ter-track berisi JWT_SECRET, GROQ_API_KEY, GEMINI_API_KEY, dan
 * CLOUDFLARE_API_TOKEN. Aturan `.gitignore` saja tidak cukup: ia tidak berlaku
 * pada berkas yang sudah ter-track, dan tidak menahan `git add -f`.
 *
 * Nilai yang cocok SENGAJA TIDAK PERNAH dicetak, hanya nama aturan dan lokasi.
 * Log CI repo ini publik (lihat catatan di .github/workflows/deploy.yml), jadi
 * mencetak potongan nilainya justru memindahkan kebocoran ke tempat baru.
 *
 * Pemakaian:
 *   node scripts/check-no-secrets.js            # semua berkas yang ter-track
 *   node scripts/check-no-secrets.js --staged   # hanya yang masuk staging
 *
 * Keluar dengan kode 1 kalau ada temuan.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Batas ukuran untuk pemeriksaan isi. Berkas yang lebih besar dilewati supaya
// pemeriksaan tetap cepat; aset besar juga bukan tempat kredensial disimpan.
const MAX_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Aturan 1: nama berkas yang tidak pernah boleh ada di repo.
// ---------------------------------------------------------------------------
const NAME_RULES = [
  {
    nama: 'berkas .env (kecuali .env.example)',
    cocok: (p) => {
      const dasar = path.basename(p);
      return dasar.startsWith('.env') && !dasar.endsWith('.env.example');
    }
  },
  {
    nama: 'kunci privat / sertifikat',
    cocok: (p) => /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i.test(p) || /(^|\/)id_rsa/i.test(p)
  },
  {
    nama: 'kredensial service account',
    cocok: (p) =>
      /(service-account|firebase-adminsdk|client_secret|credentials).*\.json$/i.test(p)
  },
  {
    nama: 'berkas token',
    cocok: (p) => /(^|\/)\.?railway-token/i.test(p)
  }
];

// ---------------------------------------------------------------------------
// Aturan 2: pola rahasia di dalam isi berkas.
//
// Semua pola dikalibrasi supaya contoh/placeholder di dokumentasi dan fixture
// test tidak ikut tertangkap. Kalau menambah pola baru, jalankan pemeriksaan ini
// pada repo yang bersih dulu: pola yang berisik akan dimatikan orang, dan
// pemeriksaan yang dimatikan tidak menjaga apa pun.
// ---------------------------------------------------------------------------
const CONTENT_RULES = [
  {
    nama: 'Groq API key',
    // Bentuk nyata: gsk_ + 52 karakter. Ambang 30 sudah cukup spesifik.
    pola: /gsk_[A-Za-z0-9]{30,}/
  },
  {
    nama: 'OpenRouter API key',
    pola: /sk-or-v1-[0-9a-f]{32,}/
  },
  {
    // `(?!or-v1)` supaya kunci OpenRouter di atas tidak dua kali dilaporkan
    // dengan label yang salah.
    nama: 'OpenAI API key',
    pola: /sk-(?!or-v1)(proj-)?[A-Za-z0-9_-]{32,}/
  },
  {
    nama: 'Anthropic API key',
    pola: /sk-ant-[A-Za-z0-9_-]{20,}/
  },
  {
    nama: 'Google API key',
    pola: /AIza[0-9A-Za-z_-]{35}/
  },
  {
    nama: 'AWS access key ID',
    pola: /AKIA[0-9A-Z]{16}/
  },
  {
    // Isi base64 minimal 100 karakter setelah penanda: fixture test yang memakai
    // kunci palsu pendek (mis. 'abc') tidak ikut tertangkap, sedangkan kunci
    // privat asli panjangnya ribuan karakter.
    nama: 'kunci privat (badan base64)',
    pola: /-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=\s]{100,}-----END/
  },
  {
    nama: 'JWT',
    pola: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/
  },
  {
    nama: 'MongoDB URI berisi user:password',
    pola: /mongodb(\+srv)?:\/\/[^:@\s/]+:([^@\s/]+)@/g,
    // Dokumentasi dan .env.example sengaja memuat contoh seperti
    // `mongodb+srv://appuser:PASSWORD@cluster0…`. Password contoh dibedakan
    // dari password asli lewat daftar di bawah.
    abaikan: (cocok) => {
      const sandi = cocok[2];
      // Kata yang mengandung "password/pass/sandi/rahasia" diperlakukan sebagai
      // contoh, sehingga dokumentasi seperti
      // `mongodb+srv://appuser:PASSWORD_ANDA@cluster0…` tidak ikut tertangkap.
      // Password Atlas yang asli berupa acak alfanumerik, jadi tidak bertabrakan
      // dengan daftar ini.
      return /^([a-z0-9_]*(password|passwd|pass|pwd|sandi|rahasia|secret)[a-z0-9_]*|changeme|user|username|appuser|xxx+|\*+|\.\.\.|…|<[^>]*>|\$\{[^}]*\})$/i.test(
        sandi
      );
    }
  }
];

// ---------------------------------------------------------------------------
// Pengumpulan berkas
// ---------------------------------------------------------------------------
function daftarBerkas( hanyaStaged ) {
  const argumen = hanyaStaged
    ? [ 'diff', '--cached', '--name-only', '--diff-filter=ACMR' ]
    : [ 'ls-files' ];

  return execFileSync('git', argumen, { encoding: 'utf8' })
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);
}

function biner( isi ) {
  return isi.subarray(0, 8000).includes(0);
}

// ---------------------------------------------------------------------------
// Pemeriksaan
// ---------------------------------------------------------------------------
function periksa( berkas ) {
  const temuan = [];

  for (const aturan of NAME_RULES) {
    if (aturan.cocok(berkas)) {
      temuan.push({ baris: 1, aturan: aturan.nama, jenis: 'nama' });
    }
  }

  let isi;
  try {
    const stat = fs.statSync(berkas);
    if (stat.size > MAX_BYTES || !stat.isFile()) return temuan;
    isi = fs.readFileSync(berkas);
  } catch {
    return temuan; // berkas sudah tidak ada (mis. dihapus di commit ini)
  }

  if (biner(isi)) return temuan;

  const teks = isi.toString('utf8');
  const barisBaris = teks.split('\n');

  for (const aturan of CONTENT_RULES) {
    if (!aturan.pola.global) aturan.pola.lastIndex = 0;
    let cocok;
    while ((cocok = aturan.pola.exec(teks)) !== null) {
      if (aturan.abaikan && aturan.abaikan(cocok)) {
        if (!aturan.pola.global) break;
        continue;
      }
      const sebelum = teks.slice(0, cocok.index);
      const baris = sebelum.split('\n').length;
      temuan.push({ baris, aturan: aturan.nama, jenis: 'isi' });
      if (!aturan.pola.global) break;
    }
  }

  return temuan;
}

// ---------------------------------------------------------------------------
function main() {
  const hanyaStaged = process.argv.includes('--staged');
  const berkas = daftarBerkas(hanyaStaged);

  const hasil = [];
  for (const b of berkas) {
    for (const t of periksa(b)) {
      hasil.push({ berkas: b, ...t });
    }
  }

  const tujuan = hanyaStaged ? 'staging area' : 'berkas yang ter-track';
  console.log(`Memeriksa ${berkas.length} berkas (${tujuan})…`);

  if (hasil.length === 0) {
    console.log('Aman: tidak ada berkas atau pola yang menyerupai kredensial.');
    return 0;
  }

  console.error('');
  console.error('Ditemukan berkas atau pola yang menyerupai kredensial:');
  console.error('');
  for (const h of hasil) {
    const label = h.jenis === 'nama' ? 'nama berkas' : `baris ${h.baris}`;
    console.error(`  ${h.berkas}  (${label})  ->  ${h.aturan}`);
  }
  console.error('');
  console.error('Nilai yang cocok tidak dicetak (log bisa publik).');
  console.error('');
  console.error('Yang harus dilakukan:');
  console.error('  1. Jangan lanjutkan commit/push ini.');
  console.error('  2. Pindahkan nilainya ke variabel lingkungan.');
  console.error('  3. Kalau kredensial sudah pernah ter-push, ia harus DIGANTI di');
  console.error('     provider — menghapus berkasnya di commit berikutnya tidak');
  console.error('     menghilangkannya dari riwayat. Lihat docs/rotasi-kredensial.md.');
  console.error('  4. Kalau ini positif palsu, kirim pengecualian yang sempit lewat');
  console.error('     perubahan pada scripts/check-no-secrets.js — jangan matikan');
  console.error('     pemeriksaannya.');
  console.error('');
  return 1;
}

process.exit(main());
