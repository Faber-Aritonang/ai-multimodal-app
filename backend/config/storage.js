/**
 * Penyimpanan berkas media (gambar hasil generate).
 *
 * Container Railway bersifat sementara: setiap deploy mengganti container dan
 * menghapus seluruh isi `/app/uploads`, sehingga gambar yang sudah tersimpan ikut
 * hilang — record-nya tetap ada di database dan muncul di UI sebagai gambar
 * rusak. Berkasnya tidak bisa dipulihkan.
 *
 * Tiga mode penyimpanan:
 * - `cloudinary` : gambar dikirim ke Upload API Cloudinary dan dilayani CDN-nya.
 *   Plan gratisnya tidak meminta kartu kredit. Cloudinary BUKAN S3, jadi mode ini
 *   punya jalur sendiri (lihat catatan `cloudinary://` di bawah).
 * - `s3`         : object storage S3-compatible (Cloudflare R2, Supabase Storage,
 *   Backblaze B2, MinIO) — semuanya memakai API S3 yang sama.
 * - `local`      : folder `uploads/`, dipakai dev dan test tanpa kredensial apa pun.
 *
 * Dev tetap jalan tanpa kredensial apa pun; produksi dibuat permanen hanya dengan
 * mengisi variabel lingkungan.
 *
 * Env:
 *   STORAGE_PROVIDER         local | s3 | cloudinary (default: cloudinary bila
 *                            kredensialnya lengkap, lalu s3, lalu local)
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *   S3_ENDPOINT              mis. https://<account>.r2.cloudflarestorage.com
 *   S3_REGION                default 'auto'
 *   S3_BUCKET
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_PUBLIC_BASE_URL       basis URL publik bucket (mis. https://pub-xxx.r2.dev)
 *   S3_FORCE_PATH_STYLE      'true' untuk MinIO/B2 yang memerlukan path-style
 */

const fs = require('fs/promises');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand
} = require('@aws-sdk/client-s3');
const cloudinary = require('cloudinary').v2;

const trimmed = (value) => String(value || '').trim();

/**
 * Status HTTP dari galat SDK apa pun.
 *
 * Setiap SDK menyimpan statusnya di tempat yang berbeda, dan ini sempat salah
 * diasumsikan: SDK Cloudinary menolak dengan objek BERSARANG
 * (`error.error.http_code`), SDK AWS memakai `$metadata.httpStatusCode`, dan
 * galat biasa memakai `http_code` datar.
 */
const httpStatusFromError = (error) =>
  error?.http_code ||
  error?.status ||
  error?.error?.http_code ||
  error?.error?.status ||
  error?.$metadata?.httpStatusCode ||
  null;

/**
 * Kode galat penyimpanan yang berarti SALAH KONFIGURASI, bukan gangguan sesaat.
 *
 * Pembedaan ini penting untuk pengguna, bukan sekadar kerapian: kredensial yang
 * ditolak provider sebelumnya dilaporkan sebagai 502 "coba lagi", padahal
 * menekan ulang tidak akan pernah berhasil dan yang dibutuhkan adalah admin.
 */
const STORAGE_CONFIG_ERROR_CODES = [
  'STORAGE_NOT_CONFIGURED', // variabelnya belum diisi sama sekali
  'STORAGE_CREDENTIALS_REJECTED', // provider menolak kredensialnya (401/403)
  'STORAGE_BUCKET_NOT_FOUND' // bucket/nama cloud tidak ada untuk kredensial ini
];

/** True bila galat penyimpanan berasal dari konfigurasi server, bukan gangguan sesaat. */
const isStorageConfigError = (error) => STORAGE_CONFIG_ERROR_CODES.includes(error?.code);

/**
 * Tandai galat SDK penyimpanan dengan kode yang bisa dibedakan pemanggil.
 * Galat yang sudah dikodei modul ini (`STORAGE_*`) dibiarkan apa adanya.
 */
const markStorageError = (error, provider) => {
  if (error && typeof error === 'object') {
    const sudahDikodei = typeof error.code === 'string' && error.code.startsWith('STORAGE_');

    if (!sudahDikodei) {
      const status = httpStatusFromError(error);

      if (status === 401 || status === 403) error.code = 'STORAGE_CREDENTIALS_REJECTED';
      else if (status === 404) error.code = 'STORAGE_BUCKET_NOT_FOUND';
      else error.code = 'STORAGE_UPLOAD_FAILED';

      // Disimpan di properti terpisah, bukan di `code`, agar kode status HTTP
      // yang sudah dibaca pemeriksa kesehatan tidak ikut berubah.
      error.storageProvider = provider;
    }
  }

  return error;
};

/** Folder penyimpanan lokal — sama dengan yang dilayani `/uploads` di server.js. */
const getUploadDir = () => path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');

const REQUIRED_S3_VARS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];

/** Variabel S3 yang belum diisi (dipakai untuk pesan error yang jelas). */
const missingS3Vars = () => REQUIRED_S3_VARS.filter((name) => trimmed(process.env[name]) === '');

const isS3Configured = () => missingS3Vars().length === 0;

const REQUIRED_CLOUDINARY_VARS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];

/**
 * Kredensial Cloudinary dari satu nilai `CLOUDINARY_URL`.
 *
 * Bentuknya persis seperti baris "API Environment variable" di dashboard
 * Cloudinary:
 *
 *   CLOUDINARY_URL=cloudinary://<API_KEY>:<API_SECRET>@<CLOUD_NAME>
 *
 * Latar belakangnya konkret: dengan tiga variabel terpisah, mengambil API key
 * dan secret dari satu Product Environment sementara nama cloud dari
 * environment lain adalah kesalahan yang mudah terjadi — dan gejalanya
 * menyesatkan, karena seluruh pemeriksaan "sudah diisi atau belum" tetap lulus,
 * `/health` tetap melaporkan `cloudinary`, dan yang gagal hanya unggahan pertama
 * user. Satu nilai tidak bisa tidak cocok dengan dirinya sendiri.
 *
 * Nilai sengaja TIDAK di-URL-decode: baris di dashboard adalah teks biasa,
 * sedangkan satu `%` liar pada secret akan merusak nilai yang sebenarnya benar.
 *
 * @returns {{cloud_name: string, api_key: string, api_secret: string}|null}
 */
const parseCloudinaryUrl = (value) => {
  const raw = trimmed(value);
  if (!raw) return null;

  // Dashboard menampilkan dengan skema; salinan manual sering tanpa skema.
  const tanpaSkema = raw.replace(/^cloudinary:\/\//i, '');
  const at = tanpaSkema.lastIndexOf('@');
  if (at === -1) return null;

  const kredensial = tanpaSkema.slice(0, at);
  // Bagian KOSONG dibuang, dan ini bukan kelonggaran tanpa alasan: nilai seperti
  // `cloudinary://:key:secret@cloud` (titik dua berlebih tepat setelah skema)
  // adalah artefak salin-tempel yang benar-benar terjadi — nilai yang dipasang
  // di produksi pernah berbentuk begitu, dan karena parser menolaknya, mode
  // penyimpanan diam-diam jatuh ke `local`. Bagian kosong tidak pernah muncul di
  // URL Cloudinary yang sah, jadi aturan ini tidak bisa salah membaca nilai yang
  // benar.
  const bagian = kredensial.split(':').filter((item) => trimmed(item) !== '');
  if (bagian.length < 2) return null;

  const cloudName = trimmed(tanpaSkema.slice(at + 1).replace(/\/+$/, ''));
  const apiKey = trimmed(bagian[0]);
  // Sisanya digabung kembali supaya secret yang memuat ':' tidak terpotong.
  const apiSecret = bagian.slice(1).join(':').trim();

  if (!cloudName || !apiKey || !apiSecret) return null;

  return { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret };
};

/**
 * Masalah bentuk `CLOUDINARY_URL`, bila ada.
 *
 * Bedanya penting untuk keselamatan data: "variabelnya tidak diisi" dan "diisi
 * tetapi bentuknya tidak terbaca" pernah diperlakukan sama — keduanya jatuh ke
 * penyimpanan lokal. Untuk mode lokal di produksi itu berbahaya: filesystem
 * container diganti tiap deploy, sehingga gambar user hilang tanpa satu pun
 * error. Lebih baik unggahannya gagal dengan pesan yang menyebut variabelnya.
 *
 * @returns {string|null} pesan masalah, atau null bila tidak ada masalah
 */
const cloudinaryUrlProblem = () => {
  const raw = trimmed(process.env.CLOUDINARY_URL);
  if (!raw || parseCloudinaryUrl(raw)) return null;

  return (
    `CLOUDINARY_URL tidak terbaca (${raw.length} karakter). Bentuk yang benar: ` +
    'cloudinary://<api_key>:<api_secret>@<cloud_name> — salin utuh dari baris ' +
    '"API environment variable" di dashboard Cloudinary.'
  );
};

/**
 * Kredensial Cloudinary yang benar-benar dipakai.
 *
 * `CLOUDINARY_URL` menang bila ada dan terbaca, karena nilai tunggal itu memang
 * dimaksudkan sebagai sumbernya. Bila bentuknya tidak terbaca, tiga variabel
 * terpisah tetap dipakai supaya konfigurasi lama tidak ikut mati hanya karena
 * ada satu variabel tambahan yang salah tulis.
 */
const cloudinaryCredentials = () => {
  const dariUrl = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
  if (dariUrl) return dariUrl;

  return {
    cloud_name: trimmed(process.env.CLOUDINARY_CLOUD_NAME),
    api_key: trimmed(process.env.CLOUDINARY_API_KEY),
    api_secret: trimmed(process.env.CLOUDINARY_API_SECRET)
  };
};

/**
 * Dari mana kredensial dibaca. Dilaporkan di log startup supaya tidak perlu
 * ditebak lagi apakah deployment memakai CLOUDINARY_URL atau tiga variabel.
 *
 * @returns {'url'|'vars'|'none'}
 */
const cloudinaryCredentialSource = () => {
  const rawUrl = trimmed(process.env.CLOUDINARY_URL);
  if (rawUrl && parseCloudinaryUrl(rawUrl)) return 'url';

  const variabelLengkap = REQUIRED_CLOUDINARY_VARS.every(
    (name) => trimmed(process.env[name]) !== ''
  );
  if (variabelLengkap) return 'vars';

  // 'url-invalid' dibedakan dari 'none': yang satu variabelnya salah bentuk,
  // yang satu memang tidak diisi — dan keduanya butuh tindakan berbeda. Tanpa
  // nilai ini, `/health` hanya melaporkan `local` dan penyebabnya tidak terlihat
  // dari luar sama sekali.
  return rawUrl ? 'url-invalid' : 'none';
};

/**
 * Variabel Cloudinary yang belum diisi.
 * Nama dikembalikan dalam bentuk variabel lingkungan supaya pesan galatnya tetap
 * menunjuk ke sesuatu yang bisa dicari di dashboard Railway.
 */
const missingCloudinaryVars = () => {
  const kredensial = cloudinaryCredentials();

  return REQUIRED_CLOUDINARY_VARS.filter((name) => {
    // CLOUDINARY_CLOUD_NAME -> cloud_name
    const kunci = name.replace('CLOUDINARY_', '').toLowerCase();
    return trimmed(kredensial[kunci]) === '';
  });
};

const isCloudinaryConfigured = () => missingCloudinaryVars().length === 0;

/**
 * Mode penyimpanan yang benar-benar dipakai.
 * - `STORAGE_PROVIDER` eksplisit selalu menang (dipakai test dan dev lokal).
 * - Kalau tidak, kredensial yang lengkap yang menentukan: Cloudinary lebih dulu,
 *   lalu S3, dan terakhir folder lokal supaya dev tetap jalan tanpa akun apa pun.
 * @returns {'local'|'s3'|'cloudinary'}
 */
const getStorageMode = () => {
  const explicit = trimmed(process.env.STORAGE_PROVIDER).toLowerCase();

  if (explicit === 'local' || explicit === 's3' || explicit === 'cloudinary') return explicit;

  if (isCloudinaryConfigured()) return 'cloudinary';

  // `CLOUDINARY_URL` yang terpasang tetapi tidak terbaca tetap dianggap sebagai
  // niat memakai Cloudinary. Jatuh ke `local` akan menulis gambar user ke
  // filesystem container yang hilang pada deploy berikutnya — kegagalan senyap
  // yang justru ingin dicegah. S3 yang lengkap tetap menang, supaya konfigurasi
  // S3 yang sudah jalan tidak ikut mati karena satu variabel sisa yang rusak.
  if (cloudinaryUrlProblem() && !isS3Configured()) return 'cloudinary';

  return isS3Configured() ? 's3' : 'local';
};

/**
 * True bila berkas tidak berada di container aplikasi.
 * Dipakai pemanggil yang perlu tahu apakah URL hasil unggahan sudah bisa diakses
 * dari internet (provider AI mengambil gambar input lewat URL tersebut).
 */
const isRemoteStorage = () => getStorageMode() !== 'local';

const assertCloudinaryConfig = () => {
  // "Belum diisi" dan "diisi tetapi salah bentuk" butuh pesan yang berbeda,
  // karena tindakan perbaikannya juga berbeda.
  const masalahUrl = cloudinaryUrlProblem();
  if (masalahUrl && !isCloudinaryConfigured()) {
    const error = new Error(masalahUrl);
    error.code = 'STORAGE_NOT_CONFIGURED';
    throw error;
  }

  const missing = missingCloudinaryVars();
  if (missing.length) {
    const error = new Error(
      `Cloudinary belum lengkap: ${missing.join(', ')} belum diisi. ` +
        'Ambil ketiganya dari dashboard Cloudinary (Product Environment Credentials), ' +
        'atau set STORAGE_PROVIDER=local untuk memakai folder lokal.'
    );
    error.code = 'STORAGE_NOT_CONFIGURED';
    throw error;
  }
};

const assertS3Config = () => {
  const missing = missingS3Vars();
  if (missing.length) {
    const error = new Error(
      `Object storage belum lengkap: ${missing.join(', ')} belum diisi. ` +
        'Isi keempatnya, atau set STORAGE_PROVIDER=local untuk memakai folder lokal.'
    );
    error.code = 'STORAGE_NOT_CONFIGURED';
    throw error;
  }
};

let client = null;
let cloudinaryConfigured = false;

/**
 * Klien Cloudinary dikonfigurasi sekali per proses.
 * SDK-nya modul tunggal (state global), jadi konfigurasinya tidak dibuat ulang.
 */
const getCloudinary = () => {
  assertCloudinaryConfig();

  if (!cloudinaryConfigured) {
    const kredensial = cloudinaryCredentials();

    cloudinary.config({
      cloud_name: trimmed(kredensial.cloud_name),
      api_key: trimmed(kredensial.api_key),
      api_secret: trimmed(kredensial.api_secret),
      // Selalu https: URL yang disimpan dipakai langsung oleh <img> di browser.
      secure: true
    });
    cloudinaryConfigured = true;
  }

  return cloudinary;
};

/** Klien S3 dibuat sekali per proses (dipakai ulang antar request). */
const getClient = () => {
  assertS3Config();

  if (!client) {
    client = new S3Client({
      region: trimmed(process.env.S3_REGION) || 'auto',
      endpoint: trimmed(process.env.S3_ENDPOINT),
      // MinIO dan B2 memerlukan path-style; R2/Supabase menerima keduanya.
      forcePathStyle: trimmed(process.env.S3_FORCE_PATH_STYLE).toLowerCase() === 'true',
      credentials: {
        accessKeyId: trimmed(process.env.S3_ACCESS_KEY_ID),
        secretAccessKey: trimmed(process.env.S3_SECRET_ACCESS_KEY)
      }
    });
  }

  return client;
};

/**
 * Hanya untuk test: buang klien yang sudah dibuat agar env baru ikut terbaca,
 * dan kembalikan status verifikasi ke awal.
 */
const resetClientForTests = () => {
  client = null;
  cloudinaryConfigured = false;
  storageCheck = { state: 'pending' };
  storageCheckBerjalan = false;
};

const getPublicBaseUrl = () => trimmed(process.env.S3_PUBLIC_BASE_URL).replace(/\/+$/, '');

/**
 * URL publik sebuah berkas.
 * - mode cloudinary : `https://res.cloudinary.com/<cloud>/image/upload/<public_id>`
 *   (tanpa versi; versi hanya dipakai bila hasil unggahan yang memberikannya)
 * - mode s3         : `<S3_PUBLIC_BASE_URL>/<key>` (absolut, dipakai langsung oleh <img>)
 * - mode local      : `/uploads/<key>` (relatif, di-proxy Vite saat dev)
 */
const getPublicUrl = (key) => {
  if (getStorageMode() === 'cloudinary') {
    assertCloudinaryConfig();
    return `https://res.cloudinary.com/${trimmed(process.env.CLOUDINARY_CLOUD_NAME)}/image/upload/${key}`;
  }

  if (getStorageMode() === 's3') {
    const base = getPublicBaseUrl();
    if (!base) {
      const error = new Error(
        'S3_PUBLIC_BASE_URL belum diisi, jadi berkas di object storage tidak punya ' +
          'alamat publik. Isi dengan basis URL bucket (mis. https://pub-xxxx.r2.dev).'
      );
      error.code = 'STORAGE_NOT_CONFIGURED';
      throw error;
    }
    return `${base}/${key}`;
  }

  return `/uploads/${key}`;
};

/**
 * Hapus satu aset Cloudinary dari public_id-nya.
 *
 * Perilaku `not found` sengaja dianggap berhasil: itulah tujuan akhirnya, dan
 * user yang menghapus gambar (atau record sisa yang berkasnya sudah tidak ada)
 * tidak boleh mendapat error 500 hanya karena berkasnya sudah raib. Sebaliknya,
 * penolakan sungguhan (mis. limit) dilempar supaya tidak diam-diam dianggap
 * berhasil.
 */
const destroyCloudinaryAsset = async (publicId) => {
  try {
    const result = await getCloudinary().uploader.destroy(publicId, {
      resource_type: 'image',
      // Buang juga salinan di CDN, supaya gambar yang dihapus user tidak tetap
      // tampil dari cache tepi Cloudinary. (Propagasi purge-nya perlu waktu.)
      invalidate: true
    });

    if (result && (result.result === 'ok' || result.result === 'not found')) return true;

    const error = new Error(
      `Cloudinary menolak menghapus ${publicId}: ${(result && result.result) || 'alasan tidak diketahui'}`
    );
    error.code = 'STORAGE_DELETE_FAILED';
    throw error;
  } catch (error) {
    // SDK melaporkan aset yang tidak ada sebagai error http 404.
    if (error && (error.http_code === 404 || /not found/i.test(String(error.message || '')))) {
      return true;
    }

    throw error;
  }
};

/**
 * Public_id Cloudinary dari URL delivery-nya.
 *
 * Bentuk URL: https://res.cloudinary.com/<cloud>/image/upload/[transformasi/][v123]/<public_id>.<ext>
 * Transformasi (mis. `f_auto,q_auto`) dan versi (`v123`) dibuang karena
 * penghapusan hanya butuh public_id. URL milik akun lain sengaja ditolak supaya
 * berkas orang lain tidak pernah ikut terhapus.
 *
 * @returns {string|null}
 */
const publicIdFromCloudinaryUrl = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.hostname !== 'res.cloudinary.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const configuredCloud = trimmed(cloudinaryCredentials().cloud_name);

  if (configuredCloud && segments[0] !== configuredCloud) return null;

  const uploadIndex = segments.findIndex((segment) =>
    ['upload', 'fetch', 'private', 'authenticated'].includes(segment)
  );
  if (uploadIndex === -1) return null;

  const rest = segments.slice(uploadIndex + 1);
  const versionIndex = rest.findIndex((segment) => /^v\d+$/.test(segment));
  const parts = versionIndex === -1 ? rest : rest.slice(versionIndex + 1);

  if (!parts.length) return null;

  const last = parts.length - 1;
  const dot = parts[last].lastIndexOf('.');
  if (dot > 0) parts[last] = parts[last].slice(0, dot);

  return parts.join('/') || null;
};

/**
 * Kirim buffer ke Upload API Cloudinary.
 * `public_id` diambil dari nama berkas tanpa ekstensi, sedangkan formatnya
 * dikirim terpisah — persis seperti yang diharapkan Cloudinary.
 */
const uploadToCloudinary = async ({ key, buffer }) => {
  const fileName = path.basename(key);
  const dot = fileName.lastIndexOf('.');
  const publicId = dot > 0 ? fileName.slice(0, dot) : fileName;
  const rawFormat = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  // 'jpeg' adalah alias 'jpg' di Cloudinary; URL-nya lebih lazim berakhiran .jpg.
  const format = rawFormat === 'jpeg' ? 'jpg' : rawFormat;

  const options = {
    public_id: publicId,
    resource_type: 'image',
    overwrite: true,
    invalidate: true,
    ...(format ? { format } : {})
  };

  try {
    return await new Promise((resolve, reject) => {
      const stream = getCloudinary().uploader.upload_stream(options, (error, result) =>
        error ? reject(error) : resolve(result)
      );

      stream.on('error', reject);
      stream.end(buffer);
    });
  } catch (error) {
    // Kredensial yang ditolak Cloudinary harus bisa dibedakan dari gangguan
    // sesaat, supaya pemanggil tidak menyuruh user "coba lagi" untuk kegagalan
    // yang hanya bisa diperbaiki admin. Galat konfigurasi dari modul ini
    // (STORAGE_NOT_CONFIGURED) dibiarkan apa adanya.
    throw markStorageError(error, 'cloudinary');
  }
};

/**
 * Simpan satu berkas.
 *
 * @param {{key: string, buffer: Buffer, contentType: string}} params
 * @returns {Promise<{key: string, url: string, reference: string}>}
 *   `reference` disimpan di database: `s3://<bucket>/<key>` atau path lokal absolut,
 *   supaya penghapusan nanti tidak perlu menebak berkasnya di mana.
 */
const putObject = async ({ key, buffer, contentType }) => {
  if (getStorageMode() === 'cloudinary') {
    const uploaded = await uploadToCloudinary({ key, buffer });

    if (!uploaded || !uploaded.secure_url) {
      const error = new Error(
        'Cloudinary tidak mengembalikan URL berkas. Periksa CLOUDINARY_* dan kuota plan gratisnya.'
      );
      error.code = 'STORAGE_UPLOAD_FAILED';
      throw error;
    }

    return {
      key,
      url: uploaded.secure_url,
      // public_id dari Cloudinary dipakai untuk menghapus berkas nanti; tidak
      // perlu menebak dari URL (yang bisa berisi transformasi/versi).
      reference: `cloudinary://${uploaded.public_id}`
    };
  }

  if (getStorageMode() === 's3') {
    assertS3Config();

    try {
      await getClient().send(
        new PutObjectCommand({
          Bucket: trimmed(process.env.S3_BUCKET),
          Key: key,
          Body: buffer,
          ContentType: contentType || 'application/octet-stream'
        })
      );
    } catch (error) {
      throw markStorageError(error, 's3');
    }

    return {
      key,
      url: getPublicUrl(key),
      reference: `s3://${trimmed(process.env.S3_BUCKET)}/${key}`
    };
  }

  const uploadDir = getUploadDir();
  await fs.mkdir(uploadDir, { recursive: true });

  const filePath = path.join(uploadDir, key);
  await fs.writeFile(filePath, buffer);

  return { key, url: `/uploads/${key}`, reference: filePath };
};

/** Hapus berkas lokal bila path-nya benar-benar berada di dalam folder upload. */
const removeLocalFile = async (filePath) => {
  const uploadDir = getUploadDir();

  if (!path.resolve(filePath).startsWith(uploadDir)) return false;

  await fs.rm(filePath, { force: true });
  return true;
};

/**
 * Hapus berkas dari referensi yang tersimpan di database
 * (`s3://bucket/key` atau path lokal absolut).
 */
const removeByReference = async (reference) => {
  if (!reference) return false;

  const cloudinaryMatch = String(reference).match(/^cloudinary:\/\/(.+)$/);
  if (cloudinaryMatch) {
    return destroyCloudinaryAsset(cloudinaryMatch[1]);
  }

  const s3Match = String(reference).match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (s3Match) {
    assertS3Config();
    await getClient().send(
      new DeleteObjectCommand({ Bucket: s3Match[1], Key: s3Match[2] })
    );
    return true;
  }

  return removeLocalFile(reference);
};

/**
 * Hapus berkas dari URL yang dipakai frontend.
 * Tiga bentuk yang pernah tersimpan di database:
 * - `/uploads/<key>`                        (mode lokal, dan record lama sebelum ini)
 * - `https://res.cloudinary.com/.../<id>`   (mode cloudinary)
 * - `https://host/.../<key>`                (object storage S3, dan mode lokal bila PUBLIC_BASE_URL diisi)
 */
const removeByUrl = async (url) => {
  const value = trimmed(url);
  if (!value) return false;

  if (value.startsWith('/uploads/')) {
    return removeLocalFile(path.join(getUploadDir(), path.basename(value)));
  }

  const cloudinaryPublicId = publicIdFromCloudinaryUrl(value);
  if (cloudinaryPublicId) {
    return destroyCloudinaryAsset(cloudinaryPublicId);
  }

  let key = '';
  try {
    key = path.basename(new URL(value).pathname);
  } catch {
    // Bukan URL absolut dan bukan path /uploads — tidak ada yang bisa dihapus.
    return false;
  }

  if (!key) return false;

  // Referensi milik penyimpanan lain (mis. sisa URL bucket lama padahal
  // kredensialnya sudah dicabut) tidak bisa dihapus dari sini. Mengembalikan
  // false jauh lebih baik daripada melempar: penghapusan record tetap selesai.
  if (!isS3Configured()) return false;

  assertS3Config();
  await getClient().send(new DeleteObjectCommand({ Bucket: trimmed(process.env.S3_BUCKET), Key: key }));
  return true;
};

/** Ringkasan penyimpanan untuk endpoint /health (hanya di luar production). */
const describeStorage = () => {
  const mode = getStorageMode();

  return {
    mode,
    bucket: mode === 's3' ? trimmed(process.env.S3_BUCKET) : null,
    // Nama cloud bukan rahasia: ia muncul di setiap URL publik gambar. Berguna
    // untuk memastikan deployment menunjuk ke akun Cloudinary yang benar.
    cloudName: mode === 'cloudinary' ? trimmed(cloudinaryCredentials().cloud_name) : null,
    // Hanya nama variabelnya, bukan nilainya — cukup untuk menjawab "konfigurasi
    // ini dibaca dari CLOUDINARY_URL atau dari tiga variabel terpisah?".
    credentialSource: mode === 'cloudinary' ? cloudinaryCredentialSource() : null,
    publicBaseUrl: mode === 's3' ? getPublicBaseUrl() || null : null
  };
};

// ---------------------------------------------------------------------------
// Verifikasi kredensial penyimpanan
//
// `isCloudinaryConfigured()` dan `isS3Configured()` hanya memeriksa bahwa
// variabelnya TIDAK KOSONG. Nilai yang salah tulis tetap lolos, dan akibatnya
// baru terlihat saat user pertama kali men-generate gambar — sementara
// `/health` sudah melaporkan `storageMode: cloudinary` dan job deploy tetap
// hijau. Pemeriksaan di bawah benar-benar memanggil providernya, dan hasilnya
// dilaporkan lewat `/health` supaya rilis dengan kredensial tidak berlaku bisa
// ditolak sebelum sampai ke user.
//
// Sengaja TIDAK memblokir startup: server tetap naik walau penyimpanan sedang
// tidak bisa dihubungi, sehingga fitur non-media tetap terpakai dan pesannya
// tetap bisa dibaca dari log. Healthcheck platform tidak ikut melambat —
// `/health` hanya membaca hasil yang sudah tersimpan, dan `pending` berarti
// pemeriksaannya belum selesai.
// ---------------------------------------------------------------------------

/** Batas waktu satu panggilan verifikasi; cukup longgar untuk jaringan lambat. */
const STORAGE_CHECK_TIMEOUT_MS = 10000;

let storageCheck = { state: 'pending' };
let storageCheckBerjalan = false;

/** Hasil terakhir verifikasi: { state: 'pending'|'ok'|'failed'|'skipped', alasan? }. */
const getStorageCheck = () => storageCheck;

/**
 * Batasi satu panggilan jaringan dengan batas waktu, karena SDK tidak selalu
 * punya timeout default yang wajar di semua jalur.
 */
const denganBatasWaktu = (janji, ms, label) =>
  Promise.race([
    janji,
    new Promise((_, tolak) => {
      const timer = setTimeout(() => {
        const galat = new Error(`${label}_timeout`);
        // Kode ini yang membedakan "provider tidak merespons" dari "kredensial
        // ditolak" di log — dua hal dengan tindakan perbaikan yang berbeda.
        galat.code = 'timeout';
        tolak(galat);
      }, ms);
      // Timer tidak boleh menahan proses tetap hidup saat server dimatikan.
      if (typeof timer.unref === 'function') timer.unref();
    })
  ]);

/**
 * Ringkas galat jadi kode yang aman dicatat.
 *
 * Pesan asli dari Cloudinary/S3 memuat endpoint dan nama bucket, sedangkan baris
 * log ini ikut tayang di CI yang repo-nya publik. Kode HTTP sudah cukup untuk
 * membedakan "kredensial salah" (401/403) dari "bucket tidak ada" (404), dan
 * `timeout` membedakan keduanya dari provider yang tidak merespons.
 *
 * PENTING — setiap SDK menyimpan statusnya di tempat yang berbeda, dan ini
 * sempat salah diasumsikan: SDK Cloudinary menolak dengan objek BERSARANG,
 * statusnya ada di `error.error.http_code`, bukan `error.http_code`:
 *
 *   { request_options, query_params, error: { message, http_code: 401 } }
 *
 * Versi pertama fungsi ini hanya membaca bentuk datar, sehingga SETIAP
 * penolakan kredensial Cloudinary dilaporkan sebagai `gagal` — persis kasus
 * yang pemeriksaan ini dibuat untuk menjelaskan. SDK AWS memakai
 * `$metadata.httpStatusCode`, sedangkan galat biasa memakai `http_code` datar.
 */
const kodeGalat = (error) => {
  const status = httpStatusFromError(error);

  if (status) return `HTTP ${status}`;
  if (error?.code && /^[A-Za-z0-9_]+$/.test(String(error.code))) return String(error.code);
  return 'gagal';
};

/**
 * Uji kredensial penyimpanan yang sedang dipakai ke providernya.
 * - `cloudinary` : `api.ping()` — endpoint yang memang disediakan untuk ini.
 * - `s3`         : `HeadBucket` — memvalidasi kredensial sekaligus akses bucket.
 * - `local`      : tidak ada yang bisa diuji; dev memang tanpa kredensial.
 *
 * @returns {Promise<{state: 'ok'|'failed'|'skipped', alasan?: string}>}
 */
const verifyRemoteStorage = async () => {
  const mode = getStorageMode();

  if (mode === 'local') return { state: 'skipped', alasan: 'mode=local' };

  try {
    if (mode === 'cloudinary') {
      const hasil = await denganBatasWaktu(
        getCloudinary().api.ping(),
        STORAGE_CHECK_TIMEOUT_MS,
        'cloudinary'
      );
      return hasil && hasil.status === 'ok' ? { state: 'ok' } : { state: 'failed', alasan: 'respons tak terduga' };
    }

    await denganBatasWaktu(
      getClient().send(new HeadBucketCommand({ Bucket: trimmed(process.env.S3_BUCKET) })),
      STORAGE_CHECK_TIMEOUT_MS,
      's3'
    );
    return { state: 'ok' };
  } catch (error) {
    return { state: 'failed', alasan: kodeGalat(error) };
  }
};

/**
 * Jalankan verifikasi sekali per proses, tanpa memblokir pemanggilnya.
 * Aman dipanggil berkali-kali: pemanggilan berikutnya dilewati selama hasil
 * pertama sudah ada atau sedang berjalan.
 */
const startStorageCheck = (catat = console.log) => {
  if (storageCheckBerjalan || storageCheck.state !== 'pending') return null;
  storageCheckBerjalan = true;

  // Promise-nya dikembalikan agar bisa di-await test (dan siapa pun yang ingin
  // tahu kapan selesai). Pemanggil yang tidak peduli boleh mengabaikannya —
  // memang begitu cara server.js memakainya, supaya startup tidak tertahan.
  return verifyRemoteStorage()
    .then((hasil) => {
      storageCheck = hasil;
    })
    .catch(() => {
      storageCheck = { state: 'failed', alasan: 'gagal' };
    })
    .finally(() => {
      storageCheckBerjalan = false;
      const { state, alasan } = storageCheck;
      catat(`Verifikasi penyimpanan: ${state}${alasan ? ` (${alasan})` : ''}`);
    });
};

module.exports = {
  getStorageMode,
  isRemoteStorage,
  isS3Configured,
  isCloudinaryConfigured,
  cloudinaryCredentials,
  cloudinaryCredentialSource,
  cloudinaryUrlProblem,
  parseCloudinaryUrl,
  isStorageConfigError,
  getPublicUrl,
  putObject,
  removeByReference,
  removeByUrl,
  describeStorage,
  getUploadDir,
  getStorageCheck,
  verifyRemoteStorage,
  startStorageCheck,
  STORAGE_CHECK_TIMEOUT_MS,
  resetClientForTests
};
