/**
 * Backup & restore database (bagian logika murni).
 *
 * Latar belakangnya konkret: MongoDB Atlas free tier TIDAK punya point-in-time
 * recovery otomatis. Yang tersedia hanya snapshot manual, dan itu pun tidak ada
 * jadwalnya. Artinya satu perintah yang salah (mis. `deleteMany` tanpa filter)
 * menghapus riwayat gambar/percakapan seluruh user secara permanen — dan tidak
 * ada satu pun berkas di repo ini yang bisa memulihkannya.
 *
 * Modul ini menyimpan isi logika yang bisa diuji tanpa MongoDB: cara menulis
 * dokumen ke berkas, cara membacanya kembali, dan cara membuktikan bahwa berkas
 * backup memang utuh. Skrip yang memakainya (`scripts/backupDb.js` dan
 * `scripts/restoreDb.js`) hanya mengurus I/O dan koneksi.
 *
 * Bentuk berkasnya dipilih karena alatnya tidak selalu tersedia:
 *   - `mongodump`/`mongorestore` adalah cara lazim, tetapi biner-nya tidak ada
 *     di mesin developer maupun di CI, dan memasangnya di Railway tidak masuk
 *     akal. Pendekatan berbasis Node bisa dijalankan di mana saja repo ini bisa
 *     dijalankan (dan di job GitHub Actions mana pun), tanpa memasang apa pun.
 *   - Satu berkas NDJSON per koleksi (satu dokumen per baris) supaya bisa
 *     diproses baris demi baris: `diff` tetap terbaca manusia, restore bisa
 *     berhenti di tengah tanpa merusak berkasnya, dan baris yang rusak tidak
 *     menggagalkan seluruh berkas.
 *
 * Nilai BSON yang tidak ada padanannya di JSON (ObjectId, Date, Buffer) ditulis
 * sebagai objek bertanda `$oid` / `$date` / `$binary` dan dikembalikan ke bentuk
 * aslinya saat restore. Tanpa ini, restore akan mengembalikan _id dan tanggal
 * sebagai string — dan dokumen yang tampak benar itu akan gagal cocok dengan
 * relasi maupun filter tanggal.
 *
 * Repository ini memakai `mongoose`, jadi `ObjectId` diambil dari sana, bukan
 * dari paket `mongodb` (yang hanya dependensi tidak langsung dari mongoose).
 */

const crypto = require('crypto');
const { Types } = require('mongoose');

const FORMAT = 'ai-multimodal-backup';
const VERSI = 1;
const EKSTENSI = '.ndjson';
const NAMA_MANIFEST = 'manifest.json';

// Nama koleksi MongoDB: huruf, angka, garis bawah, dan tanda hubung. Divalidasi
// karena namanya dipakai sebagai NAMA BERKAS — koleksi bernama `../../.env` akan
// menulis di luar folder backup, dan itu satu-satunya cara modul ini bisa
// merusak hal lain.
const POLA_NAMA_KOLEKSI = /^[A-Za-z0-9_-]{1,120}$/;

/** @returns {string} nama berkas untuk satu koleksi */
const namaBerkasKoleksi = (nama) => {
  if (!POLA_NAMA_KOLEKSI.test(String(nama || ''))) {
    throw new Error(`Nama koleksi tidak wajar: "${nama}"`);
  }

  return `${nama}${EKSTENSI}`;
};

/** Nama koleksi dari nama berkasnya. `null` kalau bukan berkas koleksi. */
const koleksiDariBerkas = (namaBerkas) => {
  const nama = String(namaBerkas || '');
  if (!nama.endsWith(EKSTENSI)) return null;

  const tanpaEkstensi = nama.slice(0, -EKSTENSI.length);
  if (!POLA_NAMA_KOLEKSI.test(tanpaEkstensi)) return null;

  return tanpaEkstensi;
};

// ---------------------------------------------------------------------------
// Serialisasi dokumen
// ---------------------------------------------------------------------------

/**
 * Ubah satu dokumen menjadi satu baris JSON.
 *
 * `JSON.stringify` biasa kehilangan jenis-jenis ini: `ObjectId` menjadi string,
 * `Date` menjadi string, dan `Buffer` menjadi `{ type: 'Buffer', data: [...] }`
 * yang saat dibaca kembali BUKAN Buffer. Semuanya ditandai eksplisit di sini.
 */
const serializeDoc = (dokumen) =>
  // `this[kunci]` dibaca, bukan argumen `nilai`-nya saja: `JSON.stringify`
  // memanggil `toJSON()` lebih dulu, sehingga `Date` sudah menjadi string dan
  // `Buffer` sudah menjadi `{type:'Buffer',...}` saat replacer-nya dijalankan.
  // Tanpa `this[kunci]`, keduanya tetap kehilangan jenisnya — dan itu justru
  // nilai yang paling sering ada di skema aplikasi ini (createdAt, _id).
  JSON.stringify(dokumen, function (_kunci, nilai) {
    const asli = this === undefined || _kunci === undefined ? nilai : this[_kunci];

    if (!asli || typeof asli !== 'object') return nilai;

    const tipe = asli._bsontype;

    if (tipe === 'ObjectId') {
      return { $oid: asli.toHexString ? asli.toHexString() : String(asli) };
    }
    if (tipe === 'Long') return { $numberLong: String(asli) };
    if (tipe === 'Decimal128') return { $numberDecimal: String(asli) };
    if (tipe === 'Binary') {
      return { $binary: Buffer.from(asli.buffer || asli.value()).toString('base64') };
    }
    if (asli instanceof Date) return { $date: asli.toISOString() };
    if (Buffer.isBuffer(asli)) return { $binary: asli.toString('base64') };

    return nilai;
  });

/** Kebalikan dari serializeDoc: satu baris JSON menjadi dokumen. */
const parseDoc = (baris) =>
  JSON.parse(baris, (_kunci, nilai) => {
    if (!nilai || typeof nilai !== 'object' || Array.isArray(nilai)) return nilai;

    if (typeof nilai.$oid === 'string') {
      try {
        return new Types.ObjectId(nilai.$oid);
      } catch {
        // ObjectId yang tidak sah dibiarkan sebagai objek penanda: barisnya
        // masih bisa diperiksa manusia, dan restore akan melaporkannya sebagai
        // kegagalan yang jelas alih-alih menyimpan nilai yang salah.
        return nilai;
      }
    }
    if (typeof nilai.$date === 'string') return new Date(nilai.$date);
    if (typeof nilai.$binary === 'string') return Buffer.from(nilai.$binary, 'base64');

    return nilai;
  });

/**
 * Seluruh isi berkas NDJSON menjadi daftar dokumen.
 *
 * Baris kosong dilewati (berkas selalu diakhiri baris baru). Baris yang bukan
 * JSON dilempar beserta nomornya: itu tanda berkasnya rusak, dan restore yang
 * diam-diam melewatkannya justru lebih berbahaya daripada restore yang berhenti.
 */
const parseNdjson = (isi) => {
  const dokumen = [];
  const baris = String(isi || '').split('\n');

  baris.forEach((satu, indeks) => {
    const rapi = satu.trim();
    if (!rapi) return;

    try {
      dokumen.push(parseDoc(rapi));
    } catch (error) {
      throw new Error(`Baris ${indeks + 1} bukan JSON yang sah: ${error.message}`);
    }
  });

  return dokumen;
};

const toNdjson = (daftar) => daftar.map((dokumen) => serializeDoc(dokumen)).join('\n');

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const sha256 = (isi) => crypto.createHash('sha256').update(isi).digest('hex');

/**
 * Tujuan koneksi yang AMAN dilaporkan.
 *
 * URI MongoDB memuat user dan password. Manifest adalah berkas yang paling
 * mungkin ikut dibagikan (untuk diperiksa, atau disimpan di tempat lain), dan
 * repo ini publik — jadi yang diambil hanya host dan nama database-nya.
 * `null` kalau bentuknya tidak dikenali.
 */
const bacaTujuan = (uri) => {
  const teks = String(uri || '').trim();
  if (!teks) return null;

  // mongodb://user:pass@host:27017/nama-db?opsi
  const cocok = teks.match(/^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)\/([^?]*)/i);
  if (!cocok) return null;

  return {
    host: cocok[2],
    database: cocok[3] || null
  };
};

/**
 * Satu entri manifest dari angka yang SUDAH dihitung saat menulis berkasnya.
 *
 * Skrip backup menghitung jumlah dokumen, ukuran, dan checksum sambil menulis
 * berkasnya (lihat scripts/backupDb.js) — koleksi tidak pernah ditahan di memori
 * utuh, dan yang dicatat adalah keadaan berkas yang benar-benar terbentuk.
 */
const buatEntriKoleksi = ({ nama, documents, bytes, sha256: checksum }) => ({
  name: nama,
  file: namaBerkasKoleksi(nama),
  documents,
  bytes,
  sha256: checksum
});

/** Entri manifest dari isi berkas yang sudah ada di memori (dipakai test). */
const buatEntriDariIsi = ({ nama, isi }) =>
  buatEntriKoleksi({
    nama,
    documents: parseNdjson(isi).length,
    // Ukuran byte, bukan jumlah karakter: berkas non-ASCII (prompt berbahasa
    // Indonesia, emoji) memiliki keduanya yang berbeda.
    bytes: Buffer.byteLength(isi, 'utf8'),
    sha256: sha256(isi)
  });

/**
 * Susun manifest dari entri koleksi.
 *
 * @param {object} param
 * @param {string} param.host
 * @param {string|null} param.database
 * @param {Array<object>} param.koleksi entri dari buatEntriKoleksi/buatEntriDariIsi
 * @param {string} [param.createdAt]
 */
const buatManifest = ({ host, database, koleksi, createdAt }) => ({
  format: FORMAT,
  version: VERSI,
  createdAt: createdAt || new Date().toISOString(),
  host: host || null,
  database: database || null,
  collections: koleksi
});

/**
 * Periksa bentuk manifest sebelum dipakai. Restore yang berjalan dengan manifest
 * dari format lain (atau berkas yang salah pilih) harus berhenti di sini, bukan
 * setelah menghapus koleksi.
 *
 * @returns {{ok: boolean, alasan?: string, manifest?: object}}
 */
const periksaManifest = (isi) => {
  let manifest;

  try {
    manifest = typeof isi === 'string' ? JSON.parse(isi) : isi;
  } catch (error) {
    return { ok: false, alasan: `bukan JSON yang sah (${error.message})` };
  }

  if (!manifest || typeof manifest !== 'object') return { ok: false, alasan: 'bukan objek' };
  if (manifest.format !== FORMAT) {
    return { ok: false, alasan: `formatnya "${manifest.format}" (diharapkan "${FORMAT}")` };
  }
  if (Number(manifest.version) > VERSI) {
    return {
      ok: false,
      alasan: `versi ${manifest.version} lebih baru dari yang dimengerti skrip ini (${VERSI})`
    };
  }
  if (!Array.isArray(manifest.collections)) return { ok: false, alasan: 'kolom collections tidak ada' };

  for (const entri of manifest.collections) {
    if (!entri || typeof entri.name !== 'string') return { ok: false, alasan: 'ada entri tanpa nama koleksi' };
    if (!POLA_NAMA_KOLEKSI.test(entri.name)) {
      return { ok: false, alasan: `nama koleksi tidak wajar: "${entri.name}"` };
    }
  }

  return { ok: true, manifest };
};

/**
 * Bandingkan berkas dengan catatan di manifest.
 *
 * Ukuran diperiksa lebih dulu karena pesannya jauh lebih jelas untuk kasus yang
 * paling mungkin: berkas terpotong saat proses dimatikan di tengah jalan.
 *
 * @returns {{ok: boolean, alasan?: string}}
 */
const verifikasiEntri = (entri, isi) => {
  const bytes = Buffer.byteLength(isi, 'utf8');

  if (Number.isFinite(entri.bytes) && bytes !== entri.bytes) {
    return { ok: false, alasan: `ukurannya ${bytes} byte, manifest mencatat ${entri.bytes}` };
  }

  if (entri.sha256 && sha256(isi) !== entri.sha256) {
    return { ok: false, alasan: 'checksum sha256 tidak cocok (isi berkas berubah)' };
  }

  return { ok: true };
};

module.exports = {
  FORMAT,
  VERSI,
  EKSTENSI,
  NAMA_MANIFEST,
  POLA_NAMA_KOLEKSI,
  namaBerkasKoleksi,
  koleksiDariBerkas,
  serializeDoc,
  parseDoc,
  parseNdjson,
  toNdjson,
  sha256,
  bacaTujuan,
  buatEntriKoleksi,
  buatEntriDariIsi,
  buatManifest,
  periksaManifest,
  verifikasiEntri
};
