/**
 * Test: respons controller media saat PENYIMPANAN gagal
 *
 * Kenapa dipisah dari tests/media.test.js: di sana penyimpanan memakai
 * implementasi asli (folder lokal), sehingga jalur kegagalan ini tidak pernah
 * tersentuh. Di kelas kegagalan inilah bug nyata terjadi di produksi:
 * `CLOUDINARY_CLOUD_NAME` ditolak Cloudinary, dan user melihat
 * "Image generation failed. Please try again." — ajakan mencoba lagi untuk
 * kegagalan yang hanya bisa diperbaiki admin. User menekan tombol yang sama
 * berulang kali, dan tidak ada satu pun tanda bahwa yang salah adalah server.
 *
 * Yang dikunci di sini:
 * - kegagalan konfigurasi penyimpanan dijawab 503, bukan 502;
 * - pesannya jujur bahwa mengulang tidak akan menolong;
 * - pesan mentah provider (yang memuat nama cloud) tidak dilempar ke user,
 *   tetapi tetap tersedia untuk operator lewat kolom `error` dan log server;
 * - gangguan penyimpanan yang bersifat sementara tetap 502 dan boleh dicoba lagi.
 */

const mockGenerateImage = jest.fn();
const mockEditImage = jest.fn();
const mockPutObject = jest.fn();

jest.mock('../config/storage', () => ({
  // Helper murni dan predikat konfigurasi memakai implementasi asli supaya
  // pemetaan kode galat benar-benar diuji, bukan ikut di-mock.
  ...jest.requireActual('../config/storage'),
  putObject: (...args) => mockPutObject(...args)
}));

jest.mock('../config/imageProviders', () => ({
  ...jest.requireActual('../config/imageProviders'),
  generateImage: (...args) => mockGenerateImage(...args),
  editImage: (...args) => mockEditImage(...args)
}));

jest.mock('../models/MediaContent');

const MediaContent = require('../models/MediaContent');
const { textToImage, imageToImage } = require('../controllers/mediaController');

/** PNG minimal dengan chunk IHDR sehingga dimensinya bisa dibaca. */
const pngBytes = (width, height) => {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const createMember = () => ({
  uid: 'uid-member',
  quota: { chat: 10, imageGeneration: 3 },
  save: jest.fn().mockResolvedValue(undefined)
});

const mockCreatedMedia = (contentId, type) => {
  const media = {
    contentId,
    userId: 'uid-member',
    type,
    status: 'processing',
    save: jest.fn().mockResolvedValue(undefined)
  };
  MediaContent.create.mockResolvedValue(media);
  return media;
};

/** Galat penyimpanan seperti yang sekarang dilempar config/storage. */
const galatPenyimpanan = (code, message = 'Invalid cloud_name contoh-cloud') =>
  Object.assign(new Error(message), { code, storageProvider: 'cloudinary' });

beforeEach(() => {
  mockGenerateImage.mockReset();
  mockEditImage.mockReset();
  mockPutObject.mockReset();

  mockGenerateImage.mockResolvedValue({
    buffer: Buffer.from('fake-image-bytes'),
    format: 'png',
    provider: 'pollinations',
    model: 'flux',
    attempts: []
  });
  mockEditImage.mockResolvedValue({
    buffer: Buffer.from('edited-image-bytes'),
    format: 'png',
    provider: 'cloudflare',
    model: 'flux-2-klein',
    attempts: []
  });
});

describe('text-to-image saat penyimpanan gagal', () => {
  test('kredensial penyimpanan ditolak -> 503, bukan 502 "coba lagi"', async () => {
    mockCreatedMedia('media_store_1', 'text-to-image');
    mockPutObject.mockRejectedValue(galatPenyimpanan('STORAGE_CREDENTIALS_REJECTED'));

    const req = { body: { prompt: 'a red apple' }, member: createMember() };
    const res = createRes();

    await textToImage(req, res);

    expect(res.status).toHaveBeenCalledWith(503);

    const body = res.json.mock.calls[0][0];
    expect(body.message).toContain('not configured correctly');
    expect(body.message).toContain('contact the administrator');
    // Inti perbaikannya: jangan menyuruh user mengulang hal yang pasti gagal.
    expect(body.message).not.toContain('Please try again');
    // Nama cloud dari pesan provider tidak ikut ke user...
    expect(body.message).not.toContain('contoh-cloud');
    // ...tetapi tetap ada di kolom teknis dan di log server untuk operator.
    expect(body.error).toBe('Invalid cloud_name contoh-cloud');
  });

  test('record ditandai failed dan quota TIDAK berkurang', async () => {
    const media = mockCreatedMedia('media_store_2', 'text-to-image');
    mockPutObject.mockRejectedValue(galatPenyimpanan('STORAGE_CREDENTIALS_REJECTED'));

    const req = { body: { prompt: 'a red apple' }, member: createMember() };
    const res = createRes();

    await textToImage(req, res);

    expect(media.status).toBe('failed');
    expect(req.member.quota.imageGeneration).toBe(3);
    expect(req.member.save).not.toHaveBeenCalled();
  });

  test('kredensial belum diisi juga dijawab 503 dengan pesan yang sama', async () => {
    mockCreatedMedia('media_store_3', 'text-to-image');
    mockPutObject.mockRejectedValue(
      galatPenyimpanan('STORAGE_NOT_CONFIGURED', 'Cloudinary belum lengkap: CLOUDINARY_API_KEY belum diisi.')
    );

    const res = createRes();
    await textToImage({ body: { prompt: 'a red apple' }, member: createMember() }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].message).toContain('not configured correctly');
  });

  test('gangguan penyimpanan sesaat tetap 502 dan boleh dicoba lagi', async () => {
    mockCreatedMedia('media_store_4', 'text-to-image');
    mockPutObject.mockRejectedValue(
      galatPenyimpanan('STORAGE_UPLOAD_FAILED', 'socket hang up')
    );

    const res = createRes();
    await textToImage({ body: { prompt: 'a red apple' }, member: createMember() }, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json.mock.calls[0][0].message).toBe('Image generation failed. Please try again.');
  });
});

describe('image-to-image saat penyimpanan gagal', () => {
  const dataUrl = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
  const validBody = {
    prompt: 'make it a watercolor painting',
    image: dataUrl(pngBytes(400, 300))
  };

  test('gagal menyimpan gambar input -> 503 dengan pesan konfigurasi, bukan transformasi', async () => {
    mockCreatedMedia('media_store_i2i', 'image-to-image');
    mockPutObject.mockRejectedValue(galatPenyimpanan('STORAGE_CREDENTIALS_REJECTED'));

    const res = createRes();
    await imageToImage({ body: validBody, member: createMember() }, res);

    expect(res.status).toHaveBeenCalledWith(503);

    const body = res.json.mock.calls[0][0];
    expect(body.message).toContain('not configured correctly');
    expect(body.message).not.toContain('Please try again');
    // Provider edit tidak perlu dipanggil kalau inputnya saja belum tersimpan.
    expect(mockEditImage).not.toHaveBeenCalled();
  });

  test('gangguan penyimpanan sesaat tetap 502 dengan pesan transformasi', async () => {
    mockCreatedMedia('media_store_i2i_2', 'image-to-image');
    mockPutObject.mockRejectedValue(galatPenyimpanan('STORAGE_UPLOAD_FAILED', 'timeout'));

    const res = createRes();
    await imageToImage({ body: validBody, member: createMember() }, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json.mock.calls[0][0].message).toBe('Image transformation failed. Please try again.');
  });
});
