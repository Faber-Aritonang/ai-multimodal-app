/**
 * Logger terstruktur.
 *
 * Sebelum ini satu-satunya jejak kejadian di server adalah `morgan('dev')` untuk
 * akses HTTP dan `console.log`/`console.error` berisi kalimat bebas. Dua
 * masalahnya nyata dan sudah pernah menyulitkan:
 *
 *   1. Di produksi (Railway) log dibaca sebagai baris JSON oleh panel log.
 *      Kalimat bebas tidak punya kolom, jadi "error dari user mana, endpoint
 *      mana, pada request yang mana" hanya bisa dicocokkan dengan mata.
 *   2. Tidak ada penghubung antara satu request dan galat yang ditimbulkannya.
 *      Galat dari provider (pesan mentah) tercetak lewat `console.error`, dan
 *      satu-satunya cara tahu request mana yang menyebabkannya adalah menebak
 *      dari urutan baris — tebakan itu salah begitu ada dua user bersamaan.
 *
 * Karena itu setiap kejadian ditulis lewat sini, dengan `requestId` dari
 * middleware/requestContext yang ikut di SETIAP baris log sebuah request
 * (`req.log` adalah child logger yang sudah membawa id tersebut).
 *
 * Bentuk keluaran:
 *   - `text` — enak dibaca saat mengembangkan di laptop (bawaan bila
 *     NODE_ENV != production).
 *   - `json` — satu objek JSON per baris, dengan kolom tetap
 *     `time`, `level`, `service`, `message` (bawaan di production).
 *
 * Dipilih lewat env (`lihat .env.example`):
 *   LOG_LEVEL   debug | info | warn | error  (bawaan: debug di luar production,
 *                                            info di production)
 *   LOG_FORMAT  text | json                  (bawaan: text di luar production,
 *                                            json di production)
 *
 * Nilai env dibaca ULANG setiap kali menulis, bukan disimpan saat modul di-load.
 * Alasannya praktis: test bisa mengubah LOG_LEVEL tanpa me-require ulang modul,
 * dan satu proses yang mengubah level saat berjalan (mis. saat mendiagnosis
 * produksi) tidak perlu restart.
 *
 * Logger tidak pernah melempar. Kegagalan menulis log (mis. `process.stdout`
 * sudah ditutup saat proses dimatikan) tidak boleh menggagalkan request yang
 * sedang dilayani — sebuah log yang gagal jauh lebih ringan akibatnya daripada
 * respons 500 yang disebabkan oleh logger itu sendiri.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Nama service ikut di tiap baris supaya log dari beberapa service (mis.
// backend Railway + job lain) bisa dibedakan setelah dikumpulkan jadi satu.
const SERVICE = String(process.env.SERVICE_NAME || '').trim() || 'ai-multimodal-backend';

// Batas panjang untuk nilai yang bisa datang dari luar (pesan galat dari
// provider, stack trace). Tanpa batas, satu galat besar bisa membanjiri log
// berbayar per GB.
const MAX_NILAI = 2000;
const MAX_MESSAGE = 500;

/** Level minimum yang ditulis. `LOG_LEVEL` yang tidak dikenal diabaikan. */
const ambilBatas = () => {
  const diminta = String(process.env.LOG_LEVEL || '').trim().toLowerCase();

  if (LEVELS[diminta]) return LEVELS[diminta];

  return process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug;
};

/** Bentuk keluaran yang dipakai saat ini. */
const ambilFormat = () => {
  const diminta = String(process.env.LOG_FORMAT || '').trim().toLowerCase();

  if (diminta === 'json' || diminta === 'text') return diminta;

  return process.env.NODE_ENV === 'production' ? 'json' : 'text';
};

const potong = (teks, batas) =>
  teks.length > batas ? `${teks.slice(0, batas)}… (${teks.length} karakter)` : teks;

/**
 * Ubah satu nilai menjadi bentuk yang aman diserialisasi.
 *
 * `Error` diperlakukan khusus karena inilah satu-satunya cara stack trace ikut
 * tercatat: `JSON.stringify(new Error('x'))` menghasilkan `{}` — kejadiannya
 * hilang, dan itu persis informasi yang dibutuhkan saat menelusuri kegagalan.
 */
const rapikanNilai = (nilai) => {
  if (nilai instanceof Error) {
    return {
      name: nilai.name,
      message: potong(String(nilai.message || ''), MAX_MESSAGE),
      stack: nilai.stack ? potong(String(nilai.stack), MAX_NILAI) : undefined
    };
  }

  if (typeof nilai === 'bigint') return String(nilai);

  // String panjang dari mana pun (pesan provider, potongan payload, daftar
  // besar) dipotong dengan batas yang sama: satu nilai besar tidak boleh
  // membuat satu baris log memuat puluhan kilobyte.
  if (typeof nilai === 'string') return potong(nilai, MAX_NILAI);

  // Objek yang tidak bisa diserialisasi (melingkar, mis. `req` atau `res` yang
  // ikut terkirim sebagai kolom) diganti penanda SEBELUM barisnya disusun.
  // Kalau tidak, satu kolom seperti itu menggagalkan serialisasi SELURUH baris
  // dan pesannya ikut hilang — kejadian yang justru sedang dicari.
  if (nilai && typeof nilai === 'object') {
    try {
      JSON.stringify(nilai);
    } catch {
      return '[tidak bisa diserialisasi]';
    }
  }

  return nilai;
};

const rapikanFields = (fields) => {
  const hasil = {};

  for (const [kunci, nilai] of Object.entries(fields || {})) {
    // `undefined` dibuang supaya kolom yang tidak berlaku tidak muncul sebagai
    // `null` di log — bedanya penting saat memfilter di panel log.
    if (nilai === undefined) continue;
    hasil[kunci] = rapikanNilai(nilai);
  }

  return hasil;
};

/** Stringify yang tidak melempar walau nilainya melingkar (circular). */
const amanStringify = (nilai) => {
  try {
    return JSON.stringify(nilai);
  } catch {
    return '"[tidak bisa diserialisasi]"';
  }
};

// Stack trace dari nilai mana pun: `fields.error` maupun `fields.stack`.
const ambilStack = (fields) => {
  const dariStack = typeof fields.stack === 'string' ? fields.stack : null;
  if (dariStack) return dariStack;

  for (const nilai of Object.values(fields)) {
    if (nilai && typeof nilai === 'object' && typeof nilai.stack === 'string') {
      return nilai.stack;
    }
  }

  return null;
};

const barisTeks = (level, pesan, fields) => {
  const bagian = Object.entries(fields)
    .filter(([kunci]) => kunci !== 'stack')
    .map(([kunci, nilai]) => {
      if (nilai && typeof nilai === 'object') {
        return `${kunci}=${typeof nilai.message === 'string' ? nilai.message : amanStringify(nilai)}`;
      }
      return `${kunci}=${nilai}`;
    })
    .join(' ');

  const stack = ambilStack(fields);

  return (
    `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${pesan}` +
    (bagian ? ` ${bagian}` : '') +
    (stack ? `\n${stack}` : '')
  );
};

const barisJson = (level, pesan, fields) => {
  const dasar = {
    time: new Date().toISOString(),
    level,
    service: SERVICE,
    message: potong(String(pesan), MAX_MESSAGE)
  };

  try {
    return JSON.stringify({ ...dasar, ...fields });
  } catch {
    // Jaring pengaman terakhir: dua kolom bisa saling menunjuk sehingga gabungan
    // keduanya baru melingkar. Pesannya tetap dipertahankan.
    return JSON.stringify({ ...dasar, fields: '[tidak bisa diserialisasi]' });
  }
};

const tulis = (level, pesan, fields) => {
  try {
    if (LEVELS[level] < ambilBatas()) return;

    const rapi = rapikanFields(fields);
    const baris = ambilFormat() === 'json' ? barisJson(level, pesan, rapi) : barisTeks(level, pesan, rapi);

    // Galat ke stderr, sisanya ke stdout. Pemisahan ini yang membuat peringatan
    // di panel log platform bisa dibedakan dari arus request biasa tanpa harus
    // mem-parsing isinya.
    const aliran = level === 'error' ? process.stderr : process.stdout;
    if (aliran && typeof aliran.write === 'function') aliran.write(`${baris}\n`);
  } catch {
    // Sengaja diam: lihat catatan di atas modul.
  }
};

/**
 * Buat logger. `base` (mis. `{ requestId, uid }`) ikut di setiap baris.
 *
 * @param {object} [base]
 */
const buat = (base = {}) => ({
  debug: (pesan, fields) => tulis('debug', pesan, { ...base, ...fields }),
  info: (pesan, fields) => tulis('info', pesan, { ...base, ...fields }),
  warn: (pesan, fields) => tulis('warn', pesan, { ...base, ...fields }),
  error: (pesan, fields) => tulis('error', pesan, { ...base, ...fields }),
  /** Logger baru dengan kolom tambahan yang menempel (mis. uid setelah auth). */
  child: (tambahan) => buat({ ...base, ...tambahan })
});

const logger = buat();

module.exports = {
  logger,
  LEVELS,
  SERVICE,
  ambilBatas,
  ambilFormat,
  // Diekspos untuk test: perilaku pemotongan panjang adalah bagian dari janji
  // modul ini ("satu galat besar tidak boleh membanjiri log").
  MAX_MESSAGE,
  MAX_NILAI
};
