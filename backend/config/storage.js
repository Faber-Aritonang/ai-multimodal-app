/**
 * Penyimpanan berkas media (gambar hasil generate).
 *
 * Container Railway bersifat sementara: setiap deploy mengganti container dan
 * menghapus seluruh isi `/app/uploads`, sehingga gambar yang sudah tersimpan ikut
 * hilang — record-nya tetap ada di database dan muncul di UI sebagai gambar
 * rusak. Berkasnya tidak bisa dipulihkan.
 *
 * Modul ini menyimpan berkas ke object storage S3-compatible bila kredensialnya
 * diisi, dan jatuh ke folder lokal bila tidak. Dev tetap jalan tanpa kredensial
 * apa pun, sedangkan produksi dibuat permanen hanya dengan mengisi variabel
 * lingkungan — Cloudflare R2, Supabase Storage, Backblaze B2, dan MinIO semuanya
 * memakai API S3 yang sama.
 *
 * Env:
 *   STORAGE_PROVIDER      local | s3   (default: s3 bila kredensialnya lengkap)
 *   S3_ENDPOINT           mis. https://<account>.r2.cloudflarestorage.com
 *   S3_REGION             default 'auto'
 *   S3_BUCKET
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_PUBLIC_BASE_URL    basis URL publik bucket (mis. https://pub-xxx.r2.dev)
 *   S3_FORCE_PATH_STYLE   'true' untuk MinIO/B2 yang memerlukan path-style
 */

const fs = require('fs/promises');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const trimmed = (value) => String(value || '').trim();

/** Folder penyimpanan lokal — sama dengan yang dilayani `/uploads` di server.js. */
const getUploadDir = () => path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');

const REQUIRED_S3_VARS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];

/** Variabel S3 yang belum diisi (dipakai untuk pesan error yang jelas). */
const missingS3Vars = () => REQUIRED_S3_VARS.filter((name) => trimmed(process.env[name]) === '');

const isS3Configured = () => missingS3Vars().length === 0;

/**
 * Mode penyimpanan yang benar-benar dipakai.
 * `s3` dipilih otomatis begitu kredensialnya lengkap, kecuali STORAGE_PROVIDER
 * menyebut `local` secara eksplisit (dipakai test dan pengembangan lokal).
 * @returns {'local'|'s3'}
 */
const getStorageMode = () => {
  const explicit = trimmed(process.env.STORAGE_PROVIDER).toLowerCase();

  if (explicit === 'local') return 'local';
  if (explicit === 's3') return 's3';

  return isS3Configured() ? 's3' : 'local';
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

/** Hanya untuk test: buang klien yang sudah dibuat agar env baru ikut terbaca. */
const resetClientForTests = () => {
  client = null;
};

const getPublicBaseUrl = () => trimmed(process.env.S3_PUBLIC_BASE_URL).replace(/\/+$/, '');

/**
 * URL publik sebuah berkas.
 * - mode s3    : `<S3_PUBLIC_BASE_URL>/<key>` (absolut, dipakai langsung oleh <img>)
 * - mode local : `/uploads/<key>` (relatif, di-proxy Vite saat dev)
 */
const getPublicUrl = (key) => {
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
 * Simpan satu berkas.
 *
 * @param {{key: string, buffer: Buffer, contentType: string}} params
 * @returns {Promise<{key: string, url: string, reference: string}>}
 *   `reference` disimpan di database: `s3://<bucket>/<key>` atau path lokal absolut,
 *   supaya penghapusan nanti tidak perlu menebak berkasnya di mana.
 */
const putObject = async ({ key, buffer, contentType }) => {
  if (getStorageMode() === 's3') {
    assertS3Config();

    await getClient().send(
      new PutObjectCommand({
        Bucket: trimmed(process.env.S3_BUCKET),
        Key: key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream'
      })
    );

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
 * Dua bentuk yang pernah tersimpan di database:
 * - `/uploads/<key>`              (mode lokal, dan record lama sebelum ini)
 * - `https://host/.../<key>`      (object storage, dan mode lokal bila PUBLIC_BASE_URL diisi)
 */
const removeByUrl = async (url) => {
  const value = trimmed(url);
  if (!value) return false;

  if (value.startsWith('/uploads/')) {
    return removeLocalFile(path.join(getUploadDir(), path.basename(value)));
  }

  const key = path.basename(new URL(value).pathname);
  if (!key) return false;

  assertS3Config();
  await getClient().send(new DeleteObjectCommand({ Bucket: trimmed(process.env.S3_BUCKET), Key: key }));
  return true;
};

/** Ringkasan penyimpanan untuk endpoint /health (hanya di luar production). */
const describeStorage = () => ({
  mode: getStorageMode(),
  bucket: getStorageMode() === 's3' ? trimmed(process.env.S3_BUCKET) : null,
  publicBaseUrl: getStorageMode() === 's3' ? getPublicBaseUrl() || null : null
});

module.exports = {
  getStorageMode,
  isS3Configured,
  getPublicUrl,
  putObject,
  removeByReference,
  removeByUrl,
  describeStorage,
  getUploadDir,
  resetClientForTests
};
