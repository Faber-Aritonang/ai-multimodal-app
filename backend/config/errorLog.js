/**
 * Penyimpan galat terakhir (error tracking).
 *
 * Repo ini tidak memakai layanan pelacak galat berbayar, jadi "error tracking"
 * di sini berarti sesuatu yang bisa dioperasikan sendiri:
 *
 *   1. setiap galat tercatat di log terstruktur (lihat config/logger.js) dengan
 *      `requestId`-nya, sehingga jejaknya bisa dicari di panel log platform; dan
 *   2. beberapa galat terakhir disimpan di memori proses ini supaya bisa dilihat
 *      SEKARANG, tanpa membuka panel log, lewat GET /api/v1/admin/errors.
 *
 * Kenapa perlu nomor 2 kalau log sudah ada: log Railway hanya menyimpan riwayat
 * dan tidak bisa ditanyai "galat apa saja yang terjadi sejak deploy terakhir".
 * Pertanyaan itu yang paling sering muncul saat deploy baru terlihat bermasalah,
 * dan jawabannya harus bisa dibaca dalam hitungan detik.
 *
 * Batas yang disengaja:
 *   - Hanya di memori. Restart/deploy mengosongkannya, dan itu memang benar:
 *     daftar ini menjawab "kondisi proses yang sedang berjalan", bukan arsip.
 *   - Jumlahnya dibatasi (`ERROR_LOG_SIZE`, bawaan 50) supaya proses tidak
 *     tumbuh tanpa batas saat ada galat beruntun.
 *   - Galat yang sama dihitung (`count`), bukan diulang: lonjakan 10.000 galat
 *     identik harus terbaca sebagai satu baris berisi angka 10.000, bukan
 *     menendang keluar galat lain yang justru berbeda.
 *
 * Tidak ada nilai rahasia yang disimpan di sini: yang masuk hanya pesan galat,
 * stack, dan metadata request (metode, path, status, uid). Nilai kredensial
 * tidak pernah ikut karena pemanggilnya tidak mengirimkannya — dan itu perlu
 * dijaga saat menambah pemanggil baru.
 */

// Signature yang sama = galat yang sama. Disusun dari sumber + pesan + lokasi,
// bukan dari stack penuh, karena nomor baris di dalam stack bisa berbeda untuk
// galat yang sama (mis. dibungkus promise dengan urutan berbeda).
const SIGNATURE_FIELDS = ['source', 'status', 'method', 'path', 'message'];

// `kind` sengaja tidak ikut jadi bagian signature: galat yang sama di halaman
// yang sama tetap satu kejadian walau dilaporkan lewat jalur berbeda (mis. satu
// kali dari boundary, sekali lagi dari promise).

const MAX_MESSAGE = 500;
const MAX_STACK = 2000;
const MAX_PANJANG_PATH = 200;
// Jenis galat dari frontend (boundary React, promise tanpa catch, permintaan
// API). Disimpan supaya penyebabnya bisa dibedakan tanpa membaca stack.
const MAX_KIND = 40;

const entries = [];
let total = 0;

const ambilBatas = () => {
  const diminta = parseInt(process.env.ERROR_LOG_SIZE, 10);
  return diminta > 0 ? diminta : 50;
};

const potong = (nilai, batas) => {
  const teks = String(nilai === undefined || nilai === null ? '' : nilai);
  return teks.length > batas ? `${teks.slice(0, batas)}…` : teks;
};

const bersihkan = (nilai) => {
  if (nilai === undefined || nilai === null || nilai === '') return undefined;
  return potong(nilai, MAX_PANJANG_PATH);
};

const signature = (entri) => SIGNATURE_FIELDS.map((kunci) => entri[kunci] ?? '').join('\u0000');

/**
 * Catat satu galat. Entri yang sama dengan yang sudah tercatat hanya menambah
 * `count` dan memperbarui `lastAt`.
 *
 * @param {object} entri
 * @param {'server'|'client'} entri.source dari mana galatnya dilaporkan
 * @param {string} entri.message pesan yang bisa dibaca manusia
 * @param {number} [entri.status] status HTTP
 * @param {string} [entri.method]
 * @param {string} [entri.path]
 * @param {string} [entri.stack]
 * @param {string} [entri.code] kode galat internal (mis. ECONNRESET)
 * @param {string} [entri.requestId]
 * @param {string} [entri.uid]
 * @returns {object} entri yang tersimpan (salinannya)
 */
const recordError = (entri = {}) => {
  const waktu = new Date().toISOString();

  const baru = {
    source: entri.source === 'client' ? 'client' : 'server',
    message: potong(entri.message, MAX_MESSAGE) || 'Unknown error',
    kind: entri.kind ? potong(entri.kind, MAX_KIND) : undefined,
    status: Number.isFinite(entri.status) ? entri.status : undefined,
    method: bersihkan(entri.method),
    path: bersihkan(entri.path),
    code: bersihkan(entri.code),
    stack: entri.stack ? potong(entri.stack, MAX_STACK) : undefined,
    requestId: bersihkan(entri.requestId),
    uid: bersihkan(entri.uid),
    at: waktu,
    count: 1
  };

  total += 1;

  const kunci = signature(baru);
  const sudahAda = entries.find((item) => signature(item) === kunci);

  if (sudahAda) {
    sudahAda.count += 1;
    sudahAda.lastAt = waktu;
    // Id request TERBARU yang menabrak galat yang sama: itu yang paling berguna
    // saat mencari jejaknya di log.
    sudahAda.requestId = baru.requestId || sudahAda.requestId;
    return { ...sudahAda };
  }

  entries.unshift(baru);

  const batas = ambilBatas();
  if (entries.length > batas) entries.length = batas;

  return { ...baru };
};

/**
 * Galat terakhir, terbaru lebih dulu.
 * @returns {Array<object>} salinan, supaya pemanggil tidak bisa mengubah isinya
 */
const getRecentErrors = () => entries.map((entri) => ({ ...entri }));

/** Ringkasan untuk endpoint admin / diagnostik. */
const getErrorStats = () => ({
  total,
  // Panjang daftar saat ini (galat yang sama tidak menambah panjangnya).
  tracked: entries.length,
  capacity: ambilBatas()
});

/** Kosongkan daftar. Dipakai test; berguna juga saat admin ingin mulai dari nol. */
const clearErrors = () => {
  entries.length = 0;
  total = 0;
};

module.exports = { recordError, getRecentErrors, getErrorStats, clearErrors };
