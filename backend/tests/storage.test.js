/**
 * Test: config/storage
 *
 * Mengunci kontrak penyimpanan berkas media:
 * - tanpa kredensial penyimpanan apa pun, semua tetap jalan seperti sebelumnya
 *   (folder lokal), sehingga dev dan test tidak butuh akun cloud apa pun;
 * - dengan kredensial S3, berkas dikirim ke bucket dan yang disimpan di database
 *   adalah referensi `s3://bucket/key` + URL publik absolutnya;
 * - dengan kredensial Cloudinary, berkas dikirim lewat Upload API-nya dan yang
 *   disimpan adalah referensi `cloudinary://<public_id>`.
 *
 * Klien S3 dan Cloudinary di-mock, jadi test ini tidak menyentuh jaringan dan
 * aman untuk CI.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockSend = jest.fn(async (command) => ({ command }));
const mockUploadStream = jest.fn();
const mockDestroy = jest.fn(async () => ({ result: 'ok' }));
const mockCloudinaryConfig = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation((config) => ({ config, send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ type: 'PutObject', input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ type: 'DeleteObject', input })),
  // Dipakai verifikasi kredensial; ikut didaftarkan supaya mock ini sama dengan
  // modul aslinya (lihat tests/storageCheck.test.js untuk perilakunya).
  HeadBucketCommand: jest.fn().mockImplementation((input) => ({ type: 'HeadBucket', input }))
}));

jest.mock('cloudinary', () => ({
  v2: {
    config: (...args) => mockCloudinaryConfig(...args),
    uploader: {
      upload_stream: (...args) => mockUploadStream(...args),
      destroy: (...args) => mockDestroy(...args)
    }
  }
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

const CLOUDINARY_ENV = {
  CLOUDINARY_CLOUD_NAME: 'uji-cloud',
  CLOUDINARY_API_KEY: '123456789012345',
  CLOUDINARY_API_SECRET: 'rahasia-cloudinary-uji'
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
  'S3_FORCE_PATH_STYLE',
  ...Object.keys(CLOUDINARY_ENV)
];

/** Buffer yang benar-benar dikirim ke Cloudinary (dari stream.end). */
let uploadedBuffer = null;

let tempDir = null;
const originalEnv = {};

const setEnv = (values) => {
  Object.entries(values).forEach(([name, value]) => {
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  });
};

const setS3Env = (overrides = {}) => setEnv({ ...S3_ENV, ...overrides });

const setCloudinaryEnv = (overrides = {}) => setEnv({ ...CLOUDINARY_ENV, ...overrides });

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
  mockUploadStream.mockClear();
  mockDestroy.mockClear();
  mockCloudinaryConfig.mockClear();
  uploadedBuffer = null;

  // Tirukan perilaku SDK: panggil callback dengan hasil unggahan, dan catat
  // buffer yang dikirim lewat stream supaya isi berkasnya bisa diperiksa.
  mockUploadStream.mockImplementation((options, callback) => {
    setImmediate(() =>
      callback(null, {
        public_id: options.public_id,
        secure_url:
          'https://res.cloudinary.com/uji-cloud/image/upload/v1700000000/' +
          `${options.public_id}${options.format ? `.${options.format}` : ''}`
      })
    );

    return {
      on: jest.fn(),
      end: jest.fn((buffer) => {
        uploadedBuffer = buffer;
      })
    };
  });

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

describe('mode Cloudinary', () => {
  test('kredensial lengkap otomatis memilih Cloudinary', () => {
    setCloudinaryEnv();

    expect(storage.isCloudinaryConfigured()).toBe(true);
    expect(storage.getStorageMode()).toBe('cloudinary');
    expect(storage.isRemoteStorage()).toBe(true);
  });

  test('Cloudinary dipakai lebih dulu bila kredensial S3 juga diisi', () => {
    setS3Env();
    setCloudinaryEnv();

    expect(storage.getStorageMode()).toBe('cloudinary');
  });

  test('kurang satu kredensial berarti belum siap', () => {
    setCloudinaryEnv({ CLOUDINARY_API_SECRET: null });

    expect(storage.isCloudinaryConfigured()).toBe(false);
    expect(storage.getStorageMode()).toBe('local');
  });

  test('berkas diunggah lewat Upload API dengan public_id tanpa ekstensi', async () => {
    setCloudinaryEnv();
    const buffer = Buffer.from('gambar-uji');

    const saved = await storage.putObject({
      key: 'media_1.jpeg',
      buffer,
      contentType: 'image/jpeg'
    });

    expect(mockCloudinaryConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        cloud_name: 'uji-cloud',
        api_key: '123456789012345',
        api_secret: 'rahasia-cloudinary-uji',
        secure: true
      })
    );

    expect(mockUploadStream).toHaveBeenCalledTimes(1);
    expect(mockUploadStream.mock.calls[0][0]).toMatchObject({
      public_id: 'media_1',
      resource_type: 'image',
      // 'jpeg' dinormalkan jadi 'jpg' supaya URL-nya lazim.
      format: 'jpg',
      overwrite: true
    });

    // Isi berkas yang benar-benar dikirim harus identik dengan buffer aslinya.
    expect(uploadedBuffer).toEqual(buffer);
    expect(saved.url).toBe(
      'https://res.cloudinary.com/uji-cloud/image/upload/v1700000000/media_1.jpg'
    );
    expect(saved.reference).toBe('cloudinary://media_1');
  });

  test('gambar tidak pernah ditulis ke disk saat Cloudinary aktif', async () => {
    setCloudinaryEnv();

    await storage.putObject({
      key: 'media_2.jpeg',
      buffer: Buffer.from('x'),
      contentType: 'image/jpeg'
    });

    // Kalau ini gagal, produksi akan tampak jalan padahal gambarnya hilang saat
    // deploy berikutnya mengganti container.
    expect(fs.existsSync(path.join(tempDir, 'media_2.jpeg'))).toBe(false);
  });

  test('konfigurasi Cloudinary cukup sekali per proses', async () => {
    setCloudinaryEnv();

    await storage.putObject({ key: 'a.png', buffer: Buffer.from('x'), contentType: 'image/png' });
    await storage.putObject({ key: 'b.png', buffer: Buffer.from('x'), contentType: 'image/png' });

    expect(mockCloudinaryConfig).toHaveBeenCalledTimes(1);
    expect(mockUploadStream).toHaveBeenCalledTimes(2);
  });

  test('kegagalan dari Cloudinary diteruskan apa adanya', async () => {
    setCloudinaryEnv();
    mockUploadStream.mockImplementationOnce((options, callback) => {
      setImmediate(() => callback(new Error('Invalid credentials'), null));
      return { on: jest.fn(), end: jest.fn() };
    });

    await expect(
      storage.putObject({ key: 'media_3.jpeg', buffer: Buffer.from('x'), contentType: 'image/jpeg' })
    ).rejects.toThrow('Invalid credentials');

    expect(fs.existsSync(path.join(tempDir, 'media_3.jpeg'))).toBe(false);
  });

  test('balasan tanpa URL ditolak dengan kode yang jelas', async () => {
    setCloudinaryEnv();
    mockUploadStream.mockImplementationOnce((options, callback) => {
      setImmediate(() => callback(null, { public_id: options.public_id }));
      return { on: jest.fn(), end: jest.fn() };
    });

    await expect(
      storage.putObject({ key: 'media_4.jpeg', buffer: Buffer.from('x'), contentType: 'image/jpeg' })
    ).rejects.toMatchObject({ code: 'STORAGE_UPLOAD_FAILED' });
  });

  test('removeByReference menghapus lewat public_id', async () => {
    setCloudinaryEnv();

    expect(await storage.removeByReference('cloudinary://media_5')).toBe(true);
    expect(mockDestroy).toHaveBeenCalledWith(
      'media_5',
      expect.objectContaining({ resource_type: 'image', invalidate: true })
    );
  });

  test('removeByUrl menghapus dari URL delivery, versi dan transformasi diabaikan', async () => {
    setCloudinaryEnv();

    const url =
      'https://res.cloudinary.com/uji-cloud/image/upload/f_auto,q_auto/v1700000000/media_6.jpg';

    expect(await storage.removeByUrl(url)).toBe(true);
    expect(mockDestroy).toHaveBeenCalledWith('media_6', expect.anything());
  });

  test('aset yang sudah tidak ada dianggap sudah terhapus', async () => {
    setCloudinaryEnv();
    mockDestroy.mockResolvedValueOnce({ result: 'not found' });

    // Tanpa ini, tombol hapus di UI gagal 500 untuk record sisa yang berkasnya
    // sudah raib — padahal justru itu yang ingin dicapai user.
    expect(await storage.removeByReference('cloudinary://media_lama')).toBe(true);
  });

  test('error 404 dari SDK juga dianggap sudah terhapus', async () => {
    setCloudinaryEnv();
    mockDestroy.mockRejectedValueOnce(Object.assign(new Error('not found'), { http_code: 404 }));

    expect(await storage.removeByReference('cloudinary://media_lama')).toBe(true);
  });

  test('penolakan sungguhan tidak diam-diam dianggap berhasil', async () => {
    setCloudinaryEnv();
    mockDestroy.mockResolvedValueOnce({ result: 'rate limit exceeded' });

    await expect(storage.removeByReference('cloudinary://media_10')).rejects.toMatchObject({
      code: 'STORAGE_DELETE_FAILED'
    });
  });

  test('URL Cloudinary milik akun lain tidak pernah dihapus', async () => {
    setCloudinaryEnv();

    const url = 'https://res.cloudinary.com/akun-lain/image/upload/v1700000000/media_7.jpg';

    expect(await storage.removeByUrl(url)).toBe(false);
    expect(mockDestroy).not.toHaveBeenCalled();
  });

  test('describeStorage melaporkan mode dan nama cloud', () => {
    setCloudinaryEnv();

    expect(storage.describeStorage()).toMatchObject({
      mode: 'cloudinary',
      cloudName: 'uji-cloud',
      bucket: null
    });

    expect(storage.getPublicUrl('media_8.jpg')).toBe(
      'https://res.cloudinary.com/uji-cloud/image/upload/media_8.jpg'
    );
  });
});

describe('referensi asing tidak pernah menggagalkan penghapusan', () => {
  test('URL milik penyimpanan lain dijawab false, bukan melempar', async () => {
    expect(await storage.removeByUrl('https://contoh.example.com/media_9.jpeg')).toBe(false);
    expect(await storage.removeByUrl('bukan-url-sama-sekali')).toBe(false);
  });
});
