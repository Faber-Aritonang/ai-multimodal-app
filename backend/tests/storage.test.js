/**
 * Test: config/storage
 *
 * Mengunci kontrak penyimpanan berkas media:
 * - tanpa kredensial S3, semua tetap jalan seperti sebelumnya (folder lokal),
 *   sehingga dev dan test tidak butuh akun object storage apa pun;
 * - dengan kredensial S3, berkas dikirim ke bucket dan yang disimpan di database
 *   adalah referensi `s3://bucket/key` + URL publik absolutnya.
 *
 * Klien S3 di-mock, jadi test ini tidak menyentuh jaringan dan aman untuk CI.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockSend = jest.fn(async (command) => ({ command }));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation((config) => ({ config, send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ type: 'PutObject', input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ type: 'DeleteObject', input }))
}));

const { S3Client } = require('@aws-sdk/client-s3');
const storage = require('../config/storage');

const S3_ENV = {
  S3_ENDPOINT: 'https://contoh.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'media-app',
  S3_ACCESS_KEY_ID: 'kunci-uji',
  S3_SECRET_ACCESS_KEY: 'rahasia-uji',
  S3_PUBLIC_BASE_URL: 'https://pub-contoh.r2.dev'
};

const ENV_NAMES = [
  'STORAGE_PROVIDER',
  'UPLOAD_DIR',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_PUBLIC_BASE_URL',
  'S3_FORCE_PATH_STYLE'
];

let tempDir = null;
const originalEnv = {};

const setS3Env = (overrides = {}) => {
  Object.entries({ ...S3_ENV, ...overrides }).forEach(([name, value]) => {
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  });
};

beforeAll(() => {
  ENV_NAMES.forEach((name) => {
    originalEnv[name] = process.env[name];
  });
});

afterAll(() => {
  ENV_NAMES.forEach((name) => {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  });
});

beforeEach(() => {
  ENV_NAMES.forEach((name) => delete process.env[name]);
  mockSend.mockClear();
  S3Client.mockClear();
  storage.resetClientForTests();

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  process.env.UPLOAD_DIR = tempDir;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('mode penyimpanan', () => {
  test('tanpa kredensial S3, mode-nya lokal', () => {
    expect(storage.getStorageMode()).toBe('local');
    expect(storage.isS3Configured()).toBe(false);
  });

  test('kredensial lengkap otomatis memilih object storage', () => {
    setS3Env();

    expect(storage.isS3Configured()).toBe(true);
    expect(storage.getStorageMode()).toBe('s3');
  });

  test('STORAGE_PROVIDER=local menang walau kredensial S3 diisi', () => {
    setS3Env({ STORAGE_PROVIDER: 'local' });

    expect(storage.getStorageMode()).toBe('local');
  });

  test('kredensial kurang satu berarti belum siap', () => {
    setS3Env({ S3_SECRET_ACCESS_KEY: null });

    expect(storage.isS3Configured()).toBe(false);
    expect(storage.getStorageMode()).toBe('local');
  });
});

describe('mode lokal', () => {
  test('berkas ditulis ke folder uploads dan URL-nya relatif', async () => {
    const buffer = Buffer.from('gambar-uji');

    const saved = await storage.putObject({
      key: 'media_1.png',
      buffer,
      contentType: 'image/png'
    });

    expect(saved.url).toBe('/uploads/media_1.png');
    expect(saved.reference).toBe(path.join(tempDir, 'media_1.png'));
    expect(fs.readFileSync(path.join(tempDir, 'media_1.png'))).toEqual(buffer);
  });

  test('removeByUrl menghapus berkas lokal', async () => {
    await storage.putObject({ key: 'media_2.png', buffer: Buffer.from('x'), contentType: 'image/png' });

    expect(await storage.removeByUrl('/uploads/media_2.png')).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'media_2.png'))).toBe(false);
  });

  test('removeByReference menghapus path lokal', async () => {
    const saved = await storage.putObject({ key: 'media_3.png', buffer: Buffer.from('x'), contentType: 'image/png' });

    expect(await storage.removeByReference(saved.reference)).toBe(true);
    expect(fs.existsSync(saved.reference)).toBe(false);
  });

  test('berkas di luar folder upload tidak pernah dihapus', async () => {
    const luar = path.join(os.tmpdir(), `bukan-media-${Date.now()}.txt`);
    fs.writeFileSync(luar, 'jangan dihapus');

    expect(await storage.removeByReference(luar)).toBe(false);
    expect(fs.existsSync(luar)).toBe(true);

    fs.rmSync(luar, { force: true });
  });
});

describe('mode object storage', () => {
  test('berkas dikirim ke bucket dengan ContentType yang benar', async () => {
    setS3Env();

    const saved = await storage.putObject({
      key: 'media_4.jpeg',
      buffer: Buffer.from('gambar-uji'),
      contentType: 'image/jpeg'
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.type).toBe('PutObject');
    expect(command.input).toMatchObject({
      Bucket: 'media-app',
      Key: 'media_4.jpeg',
      ContentType: 'image/jpeg'
    });

    // URL absolut dipakai langsung oleh <img> di frontend (tanpa /uploads).
    expect(saved.url).toBe('https://pub-contoh.r2.dev/media_4.jpeg');
    expect(saved.reference).toBe('s3://media-app/media_4.jpeg');
  });

  test('klien dibuat dengan endpoint dan path-style sesuai env', async () => {
    setS3Env({ S3_FORCE_PATH_STYLE: 'true' });

    await storage.putObject({ key: 'media_5.png', buffer: Buffer.from('x'), contentType: 'image/png' });

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'auto',
        endpoint: S3_ENV.S3_ENDPOINT,
        forcePathStyle: true,
        credentials: { accessKeyId: 'kunci-uji', secretAccessKey: 'rahasia-uji' }
      })
    );
  });

  test('klien dipakai ulang, tidak dibuat tiap permintaan', async () => {
    setS3Env();

    await storage.putObject({ key: 'a.png', buffer: Buffer.from('x'), contentType: 'image/png' });
    await storage.putObject({ key: 'b.png', buffer: Buffer.from('x'), contentType: 'image/png' });

    expect(S3Client).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('removeByReference menghapus objek dari bucket', async () => {
    setS3Env();

    expect(await storage.removeByReference('s3://media-app/media_6.jpeg')).toBe(true);
    expect(mockSend.mock.calls[0][0]).toMatchObject({
      type: 'DeleteObject',
      input: { Bucket: 'media-app', Key: 'media_6.jpeg' }
    });
  });

  test('removeByUrl menerima URL publik object storage', async () => {
    setS3Env();

    expect(await storage.removeByUrl('https://pub-contoh.r2.dev/media_7.jpeg')).toBe(true);
    expect(mockSend.mock.calls[0][0]).toMatchObject({
      type: 'DeleteObject',
      input: { Bucket: 'media-app', Key: 'media_7.jpeg' }
    });
  });

  test('tanpa S3_PUBLIC_BASE_URL, penyimpanan ditolak dengan pesan jelas', async () => {
    setS3Env({ S3_PUBLIC_BASE_URL: null });

    await expect(
      storage.putObject({ key: 'media_8.png', buffer: Buffer.from('x'), contentType: 'image/png' })
    ).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
  });

  test('STORAGE_PROVIDER=s3 tanpa kredensial ditolak, bukan diam-diam lokal', async () => {
    process.env.STORAGE_PROVIDER = 's3';

    await expect(
      storage.putObject({ key: 'media_9.png', buffer: Buffer.from('x'), contentType: 'image/png' })
    ).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });

    // Berkas tidak boleh tertulis lokal: itu membuat produksi tampak jalan
    // padahal gambarnya akan hilang saat deploy berikutnya.
    expect(fs.existsSync(path.join(tempDir, 'media_9.png'))).toBe(false);
  });
});
