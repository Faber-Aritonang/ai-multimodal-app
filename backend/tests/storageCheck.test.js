/**
 * Test: verifikasi kredensial penyimpanan (config/storage)
 *
 * `isCloudinaryConfigured()` dan `isS3Configured()` hanya bertanya "apakah
 * variabelnya kosong". Nilai yang salah tulis tetap lolos, dan dulu akibatnya
 * baru terlihat saat user pertama kali men-generate gambar — sementara `/health`
 * sudah melaporkan `storageMode: cloudinary` dan job deploy tetap hijau.
 *
 * Test ini mengunci dua hal:
 *   1. verifikasi benar-benar memanggil providernya, bukan sekadar membaca env;
 *   2. apa pun yang gagal, yang dilaporkan HANYA kode aman — pesan dari provider
 *      memuat endpoint dan nama bucket, sedangkan hasilnya tampil di `/health`
 *      dan di log CI yang repo-nya publik.
 *
 * Klien S3 dan Cloudinary di-mock, jadi tidak ada jaringan yang disentuh.
 */

const mockSend = jest.fn();
const mockPing = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation((config) => ({ config, send: mockSend })),
  PutObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  HeadBucketCommand: jest.fn().mockImplementation((input) => ({ type: 'HeadBucket', input }))
}));

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    api: { ping: (...args) => mockPing(...args) },
    uploader: { upload_stream: jest.fn(), destroy: jest.fn() }
  }
}));

const storage = require('../config/storage');

const CLOUDINARY_ENV = {
  CLOUDINARY_CLOUD_NAME: 'uji-cloud',
  CLOUDINARY_API_KEY: '123456789012345',
  CLOUDINARY_API_SECRET: 'rahasia-cloudinary-uji'
};

const S3_ENV = {
  S3_ENDPOINT: 'https://contoh.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'media-app',
  S3_ACCESS_KEY_ID: 'kunci-uji',
  S3_SECRET_ACCESS_KEY: 'rahasia-uji'
};

const ENV_NAMES = [
  'STORAGE_PROVIDER',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY'
];

const simpanAsli = {};
for (const nama of ENV_NAMES) simpanAsli[nama] = process.env[nama];

const hapusEnv = () => {
  for (const nama of ENV_NAMES) delete process.env[nama];
};

const setEnv = (nilai) => {
  hapusEnv();
  Object.assign(process.env, nilai);
};

beforeEach(() => {
  jest.clearAllMocks();
  hapusEnv();
  storage.resetClientForTests();
});

afterAll(() => {
  hapusEnv();
  for (const [nama, nilai] of Object.entries(simpanAsli)) {
    if (nilai !== undefined) process.env[nama] = nilai;
  }
});

describe('verifyRemoteStorage', () => {
  test('mode local dilewati tanpa memanggil provider apa pun', async () => {
    const hasil = await storage.verifyRemoteStorage();

    expect(hasil).toEqual({ state: 'skipped', alasan: 'mode=local' });
    expect(mockPing).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('Cloudinary: ping berhasil berarti kredensial berlaku', async () => {
    setEnv(CLOUDINARY_ENV);
    mockPing.mockResolvedValueOnce({ status: 'ok' });

    expect(await storage.verifyRemoteStorage()).toEqual({ state: 'ok' });
    expect(mockPing).toHaveBeenCalledTimes(1);
  });

  test('Cloudinary: respons tak terduga dianggap gagal, bukan lolos', async () => {
    setEnv(CLOUDINARY_ENV);
    mockPing.mockResolvedValueOnce({ status: 'unknown' });

    expect((await storage.verifyRemoteStorage()).state).toBe('failed');
  });

  test('Cloudinary: kredensial ditolak hanya melaporkan kode HTTP, bukan pesannya', async () => {
    setEnv(CLOUDINARY_ENV);

    // Bentuk ini PERSIS seperti yang dilempar SDK Cloudinary 2.x pada HTTP 401:
    // statusnya bersarang di `error.error.http_code`. Versi pertama fungsi
    // ringkasannya hanya membaca `error.http_code` yang datar, sehingga setiap
    // penolakan kredensial Cloudinary dilaporkan sebagai `gagal` — tepat kasus
    // yang pemeriksaan ini dibuat untuk menjelaskan. Bentuknya diambil dari
    // SDK yang terpasang, bukan dari asumsi.
    const galat = {
      request_options: {},
      query_params: {},
      error: {
        message:
          `Invalid credentials for cloud ${CLOUDINARY_ENV.CLOUDINARY_CLOUD_NAME} ` +
          `(api_key ${CLOUDINARY_ENV.CLOUDINARY_API_KEY})`,
        http_code: 401
      }
    };
    mockPing.mockRejectedValueOnce(galat);

    const hasil = await storage.verifyRemoteStorage();

    expect(hasil.state).toBe('failed');
    expect(hasil.alasan).toBe('HTTP 401');
    // Nilai rahasia dan nama cloud tidak boleh ikut terbawa ke /health atau log.
    const tercetak = JSON.stringify(hasil);
    expect(tercetak).not.toContain(CLOUDINARY_ENV.CLOUDINARY_API_KEY);
    expect(tercetak).not.toContain(CLOUDINARY_ENV.CLOUDINARY_CLOUD_NAME);
    expect(tercetak).not.toContain('Invalid credentials');
  });

  test('Cloudinary: bentuk galat tanpa kode status tidak dilaporkan sebagai `gagal`', async () => {
    // Regresi untuk bug yang lolos ke produksi: yang dilaporkan harus tetap
    // berguna walau SDK mengubah bentuk galatnya. Kalau status benar-benar tidak
    // ada, minimal `error.code` yang dipakai — bukan kata "gagal" tanpa isi.
    setEnv(CLOUDINARY_ENV);

    const galat = new Error('ditolak');
    galat.error = { status: 403 };
    mockPing.mockRejectedValueOnce(galat);

    expect(await storage.verifyRemoteStorage()).toEqual({
      state: 'failed',
      alasan: 'HTTP 403'
    });
  });

  test('S3: HeadBucket dijalankan pada bucket yang dikonfigurasi', async () => {
    setEnv(S3_ENV);
    mockSend.mockResolvedValueOnce({});

    expect(await storage.verifyRemoteStorage()).toEqual({ state: 'ok' });

    const perintah = mockSend.mock.calls[0][0];
    expect(perintah.type).toBe('HeadBucket');
    expect(perintah.input).toEqual({ Bucket: S3_ENV.S3_BUCKET });
  });

  test('S3: akses ditolak dianggap gagal dengan status dari metadata', async () => {
    setEnv(S3_ENV);

    const galat = new Error('Access Denied for bucket media-app');
    galat.$metadata = { httpStatusCode: 403 };
    mockSend.mockRejectedValueOnce(galat);

    const hasil = await storage.verifyRemoteStorage();

    expect(hasil).toEqual({ state: 'failed', alasan: 'HTTP 403' });
    expect(JSON.stringify(hasil)).not.toContain('media-app');
  });

  test('memakai kredensial hasil edit langsung, tanpa cache klien lama', async () => {
    // Nilai salah yang "menempel" dari konfigurasi sebelumnya adalah salah satu
    // penyebab nyata: mode terbaca benar padahal kredensialnya sudah diganti.
    setEnv({ ...CLOUDINARY_ENV, CLOUDINARY_CLOUD_NAME: 'cloud-lama' });
    mockPing.mockResolvedValueOnce({ status: 'ok' });
    await storage.verifyRemoteStorage();

    storage.resetClientForTests();
    setEnv({ ...CLOUDINARY_ENV, CLOUDINARY_CLOUD_NAME: 'cloud-baru' });
    mockPing.mockResolvedValueOnce({ status: 'ok' });
    await storage.verifyRemoteStorage();

    const { v2 } = require('cloudinary');
    const konfigurasiTerakhir = v2.config.mock.calls.at(-1)[0];
    expect(konfigurasiTerakhir.cloud_name).toBe('cloud-baru');
  });

  test('panggilan yang menggantung dibatasi batas waktu, bukan menahan selamanya', async () => {
    jest.useFakeTimers();
    try {
      setEnv(CLOUDINARY_ENV);
      mockPing.mockImplementationOnce(() => new Promise(() => {}));

      const janji = storage.verifyRemoteStorage();
      await jest.advanceTimersByTimeAsync(storage.STORAGE_CHECK_TIMEOUT_MS + 100);
      const hasil = await janji;

      // Alasannya harus membedakan "tidak merespons" dari "ditolak": yang
      // pertama berarti masalah jaringan, yang kedua berarti nilainya salah.
      expect(hasil).toEqual({ state: 'failed', alasan: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('startStorageCheck', () => {
  test('mengisi status verifikasi dan mencatat hasilnya sekali', async () => {
    setEnv(CLOUDINARY_ENV);
    mockPing.mockResolvedValueOnce({ status: 'ok' });
    const catat = jest.fn();

    const janji = storage.startStorageCheck(catat);

    // Sebelum selesai, statusnya masih `pending` — inilah yang dipakai job deploy
    // untuk menunggu, bukan untuk memutuskan.
    expect(storage.getStorageCheck().state).toBe('pending');

    await janji;

    expect(storage.getStorageCheck()).toEqual({ state: 'ok' });
    expect(catat).toHaveBeenCalledWith('Verifikasi penyimpanan: ok');
  });

  test('kegagalan dicatat lengkap dengan alasannya', async () => {
    setEnv(CLOUDINARY_ENV);
    // Bentuk datar (S3/AWS memakai $metadata, SDK lain memakai http_code di akar).
    const galat = new Error('nope');
    galat.http_code = 403;
    mockPing.mockRejectedValueOnce(galat);
    const catat = jest.fn();

    await storage.startStorageCheck(catat);

    expect(storage.getStorageCheck()).toEqual({ state: 'failed', alasan: 'HTTP 403' });
    expect(catat).toHaveBeenCalledWith('Verifikasi penyimpanan: failed (HTTP 403)');
  });

  test('tidak dijalankan dua kali untuk proses yang sama', async () => {
    setEnv(CLOUDINARY_ENV);
    mockPing.mockResolvedValue({ status: 'ok' });

    await storage.startStorageCheck(jest.fn());
    const kedua = storage.startStorageCheck(jest.fn());

    expect(kedua).toBeNull();
    expect(mockPing).toHaveBeenCalledTimes(1);
  });

  test('tidak pernah melempar walau verifikasi gagal di luar dugaan', async () => {
    setEnv(CLOUDINARY_ENV);
    mockPing.mockImplementationOnce(() => {
      throw new Error('gagal sebelum promise');
    });

    await expect(storage.startStorageCheck(jest.fn())).resolves.toBeUndefined();
    expect(storage.getStorageCheck().state).toBe('failed');
  });
});

describe('/health melaporkan hasilnya', () => {
  test('storageCheck muncul sebagai satu kata status', () => {
    const { app } = require('../server');
    const request = require('supertest');

    return request(app)
      .get('/health')
      .expect(200)
      .expect((res) => {
        // Test lain di repo ini juga mengandalkan /health selalu memuat kolom ini.
        expect(res.body).toHaveProperty('storageCheck');
        expect(['pending', 'ok', 'failed', 'skipped']).toContain(res.body.storageCheck);
      });
  });

  test('penyebab kegagalan ikut dilaporkan, jadi bisa ditindaklanjuti tanpa log server', () => {
    const { app } = require('../server');
    const request = require('supertest');

    setEnv(CLOUDINARY_ENV);
    // Bentuk galat Cloudinary yang sebenarnya.
    mockPing.mockRejectedValueOnce({ error: { message: 'rahasia-jangan-tayang', http_code: 401 } });

    return storage
      .startStorageCheck(jest.fn())
      .then(() => request(app).get('/health').expect(200))
      .then((res) => {
        expect(res.body.storageCheck).toBe('failed');
        // `failed` saja tidak menuntun ke tindakan apa pun; kode inilah yang
        // membedakan kredensial salah dari provider yang tidak menjawab.
        expect(res.body.storageCheckReason).toBe('HTTP 401');
        expect(JSON.stringify(res.body)).not.toContain('rahasia-jangan-tayang');
      });
  });

  test('saat verifikasi berhasil tidak ada kolom penyebab yang menyesatkan', async () => {
    const { app } = require('../server');
    const request = require('supertest');

    setEnv(CLOUDINARY_ENV);
    mockPing.mockResolvedValueOnce({ status: 'ok' });
    await storage.startStorageCheck(jest.fn());

    const res = await request(app).get('/health').expect(200);

    expect(res.body.storageCheck).toBe('ok');
    expect(res.body).not.toHaveProperty('storageCheckReason');
  });
});
