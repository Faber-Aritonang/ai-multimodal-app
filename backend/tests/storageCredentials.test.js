/**
 * Test: kredensial penyimpanan Cloudinary
 *
 * Dua hal yang dikunci di sini:
 *
 * 1. `CLOUDINARY_URL` sebagai sumber tunggal. Dengan tiga variabel terpisah,
 *    memasangkan API key dari satu Product Environment dengan nama cloud dari
 *    environment lain adalah kesalahan yang mudah terjadi, dan gejalanya
 *    menyesatkan: seluruh pemeriksaan "sudah diisi atau belum" tetap lulus,
 *    `/health` tetap melaporkan `cloudinary`, dan yang gagal hanya unggahan
 *    pertama user. Satu nilai tidak bisa tidak cocok dengan dirinya sendiri.
 *
 * 2. Kode galat penyimpanan yang membedakan salah konfigurasi dari gangguan
 *    sesaat. Bedanya bukan kerapian: yang satu butuh admin, yang satu butuh
 *    menekan tombol lagi.
 *
 * Klien Cloudinary dan S3 di-mock, jadi test ini tidak menyentuh jaringan.
 */

const mockCloudinaryConfig = jest.fn();
const mockUploadStream = jest.fn();
const mockSend = jest.fn();

jest.mock('cloudinary', () => ({
  v2: {
    config: (...args) => mockCloudinaryConfig(...args),
    api: { ping: jest.fn() },
    uploader: {
      upload_stream: (...args) => mockUploadStream(...args),
      destroy: jest.fn()
    }
  }
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation((config) => ({ config, send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ type: 'PutObject', input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ type: 'DeleteObject', input })),
  HeadBucketCommand: jest.fn().mockImplementation((input) => ({ type: 'HeadBucket', input }))
}));

const storage = require('../config/storage');

const CLOUDINARY_URL = 'cloudinary://api-key-uji:api-secret-uji@nama-cloud-uji';

const VARIABEL_DIKELOLA = [
  'CLOUDINARY_URL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'STORAGE_PROVIDER',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY'
];

let snapshot = {};

beforeEach(() => {
  snapshot = {};
  for (const nama of VARIABEL_DIKELOLA) {
    snapshot[nama] = process.env[nama];
    delete process.env[nama];
  }

  storage.resetClientForTests();
  mockCloudinaryConfig.mockClear();
  mockUploadStream.mockReset();
  mockSend.mockReset();
});

afterEach(() => {
  for (const [nama, nilai] of Object.entries(snapshot)) {
    if (nilai === undefined) delete process.env[nama];
    else process.env[nama] = nilai;
  }
});

/**
 * Buat upload Cloudinary palsu: berhasil bila `galat` kosong, atau gagal dengan
 * galat tertentu. Callback-nya dipanggil dengan DUA argumen seperti SDK asli —
 * `callback(error)` saja berarti hasilnya `undefined`, yang oleh putObject
 * dianggap sebagai kegagalan "tidak mengembalikan URL".
 */
const cloudinaryMengembalikan = (galat = null) => {
  const hasil = {
    secure_url: 'https://res.cloudinary.com/contoh/image/upload/v1/a.jpg',
    public_id: 'a'
  };

  mockUploadStream.mockImplementation((options, callback) => ({
    on: jest.fn(),
    end: jest.fn(() => callback(galat, galat ? undefined : hasil))
  }));
};

const unggahUji = () =>
  storage.putObject({ key: 'a.jpg', buffer: Buffer.from('x'), contentType: 'image/jpeg' });

/** Jalankan promise yang seharusnya gagal, lalu kembalikan galatnya. */
const tangkapGalat = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Seharusnya gagal, tetapi berhasil.');
};

describe('parseCloudinaryUrl', () => {
  test.each([
    [CLOUDINARY_URL, { cloud_name: 'nama-cloud-uji', api_key: 'api-key-uji', api_secret: 'api-secret-uji' }],
    ['cloudinary://key:secret@cloud', { cloud_name: 'cloud', api_key: 'key', api_secret: 'secret' }],
    // Tanpa skema: salinan manual dari dashboard sering kehilangan bagian ini.
    ['key:secret@cloud', { cloud_name: 'cloud', api_key: 'key', api_secret: 'secret' }],
    // Spasi dan garis miring di ujung tidak boleh ikut terbaca sebagai nilainya.
    [`  ${CLOUDINARY_URL}  `, { cloud_name: 'nama-cloud-uji', api_key: 'api-key-uji', api_secret: 'api-secret-uji' }],
    ['cloudinary://key:secret@cloud/', { cloud_name: 'cloud', api_key: 'key', api_secret: 'secret' }],
    // Titik dua berlebih tepat setelah skema: artefak salin-tempel yang benar-benar
    // pernah masuk ke produksi. Karena parser menolaknya, mode penyimpanan
    // diam-diam jatuh ke `local` — dan gambar user ditulis ke filesystem container.
    ['cloudinary://:key:secret@cloud', { cloud_name: 'cloud', api_key: 'key', api_secret: 'secret' }],
    // Artefak yang sama di antara kredensial.
    ['cloudinary://key::secret@cloud', { cloud_name: 'cloud', api_key: 'key', api_secret: 'secret' }],
    // Secret yang memuat ':' tidak boleh terpotong.
    ['cloudinary://key:sek:ret@cloud', { cloud_name: 'cloud', api_key: 'key', api_secret: 'sek:ret' }]
  ])('membaca %j', (nilai, harapan) => {
    expect(storage.parseCloudinaryUrl(nilai)).toEqual(harapan);
  });

  test.each([
    [undefined],
    [null],
    [''],
    ['   '],
    ['cloudinary://key:secret'], // tanpa pemisah '@'
    ['cloudinary://key@cloud'], // tanpa pemisah ':' pada kredensial
    ['cloudinary://:secret@cloud'], // API key kosong
    ['cloudinary://key:@cloud'], // API secret kosong
    ['cloudinary://key:secret@'] // nama cloud kosong
  ])('menolak bentuk tidak lengkap %j', (nilai) => {
    expect(storage.parseCloudinaryUrl(nilai)).toBeNull();
  });

  test('secret yang mengandung tanda hubung dan garis bawah dibiarkan apa adanya', () => {
    expect(storage.parseCloudinaryUrl('cloudinary://k-1:s_e-2@cloud')).toEqual({
      cloud_name: 'cloud',
      api_key: 'k-1',
      api_secret: 's_e-2'
    });
  });
});

describe('CLOUDINARY_URL sebagai sumber tunggal', () => {
  test('satu nilai itu sudah cukup untuk mengaktifkan mode cloudinary', () => {
    process.env.CLOUDINARY_URL = CLOUDINARY_URL;

    expect(storage.getStorageMode()).toBe('cloudinary');
    expect(storage.isCloudinaryConfigured()).toBe(true);
    expect(storage.cloudinaryCredentialSource()).toBe('url');
    expect(storage.cloudinaryCredentials()).toEqual({
      cloud_name: 'nama-cloud-uji',
      api_key: 'api-key-uji',
      api_secret: 'api-secret-uji'
    });
  });

  test('SDK benar-benar menerima nilai dari URL, bukan dari tiga variabel', async () => {
    process.env.CLOUDINARY_URL = 'cloudinary://url-key:url-secret@url-cloud';
    process.env.CLOUDINARY_CLOUD_NAME = 'var-cloud';
    process.env.CLOUDINARY_API_KEY = 'var-key';
    process.env.CLOUDINARY_API_SECRET = 'var-secret';

    cloudinaryMengembalikan(null);
    await unggahUji();

    expect(storage.cloudinaryCredentialSource()).toBe('url');
    expect(mockCloudinaryConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        cloud_name: 'url-cloud',
        api_key: 'url-key',
        api_secret: 'url-secret',
        secure: true
      })
    );
  });

  test('tiga variabel terpisah tetap bekerja seperti sebelumnya', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'var-cloud';
    process.env.CLOUDINARY_API_KEY = 'var-key';
    process.env.CLOUDINARY_API_SECRET = 'var-secret';

    cloudinaryMengembalikan(null);
    await unggahUji();

    expect(storage.cloudinaryCredentialSource()).toBe('vars');
    expect(mockCloudinaryConfig).toHaveBeenCalledWith(
      expect.objectContaining({ cloud_name: 'var-cloud', api_key: 'var-key', api_secret: 'var-secret' })
    );
  });

  test('CLOUDINARY_URL yang bentuknya rusak tidak mematikan konfigurasi lama', async () => {
    process.env.CLOUDINARY_URL = 'cloudinary://rusak';
    process.env.CLOUDINARY_CLOUD_NAME = 'var-cloud';
    process.env.CLOUDINARY_API_KEY = 'var-key';
    process.env.CLOUDINARY_API_SECRET = 'var-secret';

    expect(storage.cloudinaryCredentialSource()).toBe('vars');
    expect(storage.getStorageMode()).toBe('cloudinary');

    cloudinaryMengembalikan(null);
    await unggahUji();

    expect(mockCloudinaryConfig).toHaveBeenCalledWith(
      expect.objectContaining({ cloud_name: 'var-cloud' })
    );
  });

  test('tidak ada sumber apa pun -> mode lokal, bukan cloudinary setengah jadi', () => {
    expect(storage.cloudinaryCredentialSource()).toBe('none');
    expect(storage.isCloudinaryConfigured()).toBe(false);
    expect(storage.getStorageMode()).toBe('local');
  });

  test('CLOUDINARY_URL yang tidak terbaca tidak diam-diam jatuh ke penyimpanan lokal', async () => {
    // Bagian nama cloud-nya kosong, jadi nilainya memang tidak bisa dipakai.
    process.env.CLOUDINARY_URL = 'cloudinary://key:secret@';

    expect(storage.cloudinaryUrlProblem()).toContain('CLOUDINARY_URL');
    expect(storage.cloudinaryCredentialSource()).toBe('url-invalid');
    expect(storage.isCloudinaryConfigured()).toBe(false);

    // Intinya: mode TIDAK menjadi `local`. Kalau menjadi `local`, gambar user
    // ditulis ke filesystem container dan hilang pada deploy berikutnya tanpa
    // satu pun error — kegagalan senyap yang justru ingin dicegah.
    expect(storage.getStorageMode()).toBe('cloudinary');

    const galat = await tangkapGalat(unggahUji());
    expect(galat.code).toBe('STORAGE_NOT_CONFIGURED');
    // Pesannya menyebut bentuk yang benar, bukan sekadar "belum diisi".
    expect(galat.message).toContain('cloudinary://<api_key>:<api_secret>@<cloud_name>');
  });

  test('CLOUDINARY_URL rusak tidak mematikan S3 yang sudah lengkap', () => {
    process.env.CLOUDINARY_URL = 'cloudinary://rusak';
    process.env.S3_ENDPOINT = 'https://contoh.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'media-app';
    process.env.S3_ACCESS_KEY_ID = 'kunci-uji';
    process.env.S3_SECRET_ACCESS_KEY = 'rahasia-uji';

    expect(storage.getStorageMode()).toBe('s3');
  });
});

describe('kode galat penyimpanan Cloudinary', () => {
  beforeEach(() => {
    process.env.CLOUDINARY_URL = CLOUDINARY_URL;
  });

  test('401 bentuk BERSARANG dari SDK -> kredensial ditolak', async () => {
    // Bentuk inilah yang benar-benar dikirim SDK; statusnya ada di
    // error.error.http_code, bukan error.http_code.
    cloudinaryMengembalikan({ error: { message: 'Invalid cloud_name', http_code: 401 } });

    const galat = await tangkapGalat(unggahUji());

    expect(galat.code).toBe('STORAGE_CREDENTIALS_REJECTED');
    expect(galat.storageProvider).toBe('cloudinary');
    expect(storage.isStorageConfigError(galat)).toBe(true);
  });

  test('403 juga dihitung sebagai kredensial ditolak', async () => {
    cloudinaryMengembalikan({ error: { message: 'Forbidden', http_code: 403 } });

    const galat = await tangkapGalat(unggahUji());

    expect(galat.code).toBe('STORAGE_CREDENTIALS_REJECTED');
    expect(storage.isStorageConfigError(galat)).toBe(true);
  });

  test('404 -> nama cloud/bucket tidak ditemukan', async () => {
    cloudinaryMengembalikan({ error: { message: 'Not found', http_code: 404 } });

    const galat = await tangkapGalat(unggahUji());

    expect(galat.code).toBe('STORAGE_BUCKET_NOT_FOUND');
    expect(storage.isStorageConfigError(galat)).toBe(true);
  });

  test('500 tetap gangguan sesaat, bukan salah konfigurasi', async () => {
    cloudinaryMengembalikan({ error: { message: 'Internal error', http_code: 500 } });

    const galat = await tangkapGalat(unggahUji());

    expect(galat.code).toBe('STORAGE_UPLOAD_FAILED');
    // Inilah bedanya untuk user: gangguan 500 memang layak dicoba lagi.
    expect(storage.isStorageConfigError(galat)).toBe(false);
  });

  test('galat jaringan tanpa status juga gangguan sesaat', async () => {
    cloudinaryMengembalikan(new Error('socket hang up'));

    const galat = await tangkapGalat(unggahUji());

    expect(galat.code).toBe('STORAGE_UPLOAD_FAILED');
    expect(galat.message).toBe('socket hang up');
    expect(storage.isStorageConfigError(galat)).toBe(false);
  });

  test('kredensial yang belum diisi tetap berkode STORAGE_NOT_CONFIGURED', async () => {
    delete process.env.CLOUDINARY_URL;
    process.env.STORAGE_PROVIDER = 'cloudinary';

    const galat = await tangkapGalat(unggahUji());

    expect(galat.code).toBe('STORAGE_NOT_CONFIGURED');
    expect(storage.isStorageConfigError(galat)).toBe(true);
    expect(mockUploadStream).not.toHaveBeenCalled();
  });
});

describe('kode galat penyimpanan S3', () => {
  beforeEach(() => {
    process.env.STORAGE_PROVIDER = 's3';
    process.env.S3_ENDPOINT = 'https://contoh.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'media-app';
    process.env.S3_ACCESS_KEY_ID = 'kunci-uji';
    process.env.S3_SECRET_ACCESS_KEY = 'rahasia-uji';
  });

  test('403 dari AWS (status di $metadata) -> kredensial ditolak', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { $metadata: { httpStatusCode: 403 } })
    );

    const galat = await tangkapGalat(unggahUji());

    expect(galat.code).toBe('STORAGE_CREDENTIALS_REJECTED');
    expect(galat.storageProvider).toBe('s3');
    expect(storage.isStorageConfigError(galat)).toBe(true);
  });

  test('galat AWS tanpa status (mis. koneksi putus) tetap gangguan sesaat', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    );

    const galat = await tangkapGalat(unggahUji());

    expect(galat.code).toBe('STORAGE_UPLOAD_FAILED');
    expect(storage.isStorageConfigError(galat)).toBe(false);
  });
});
