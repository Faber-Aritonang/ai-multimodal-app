/**
 * Test: mediaController.textToImage
 * Provider gambar dan model MediaContent di-mock; file hasil generate ditulis ke
 * direktori sementara lewat env UPLOAD_DIR.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockGenerateImage = jest.fn();
const mockEditImage = jest.fn();

// Hanya fungsi jaringan yang di-mock. Helper murni (detectFormat, measureImage,
// looksLikeImage) memakai implementasi asli supaya validasi gambar input di
// controller benar-benar diuji, bukan ikut di-mock.
jest.mock('../config/imageProviders', () => ({
  ...jest.requireActual('../config/imageProviders'),
  generateImage: (...args) => mockGenerateImage(...args),
  editImage: (...args) => mockEditImage(...args)
}));

jest.mock('../models/MediaContent');

const MediaContent = require('../models/MediaContent');
const { textToImage, imageToImage, deleteMedia } = require('../controllers/mediaController');

let uploadDir;

beforeAll(() => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-uploads-'));
});

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.UPLOAD_DIR = uploadDir;
  delete process.env.PUBLIC_BASE_URL;
  mockEditImage.mockReset();
  mockEditImage.mockResolvedValue({
    buffer: Buffer.from('edited-image-bytes'),
    format: 'png',
    mimeType: 'image/png',
    provider: 'cloudflare',
    model: '@cf/black-forest-labs/flux-2-klein-4b',
    attempts: []
  });
  mockGenerateImage.mockReset();
  mockGenerateImage.mockResolvedValue({
    buffer: Buffer.from('fake-image-bytes'),
    format: 'png',
    mimeType: 'image/png',
    provider: 'cloudflare',
    model: '@cf/black-forest-labs/flux-1-schnell',
    attempts: []
  });
});

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function createMember() {
  return {
    uid: 'uid-member',
    quota: { chat: 10, imageGeneration: 3 },
    save: jest.fn().mockResolvedValue(undefined)
  };
}

function mockCreatedMedia(contentId = 'media_test1') {
  const media = {
    contentId,
    userId: 'uid-member',
    type: 'text-to-image',
    status: 'processing',
    save: jest.fn().mockResolvedValue(undefined)
  };
  MediaContent.create.mockResolvedValue(media);
  return media;
}

describe('validasi request', () => {
  test.each([
    [{}, 'Prompt is required'],
    [{ prompt: '   ' }, 'Prompt is required'],
    [{ prompt: 'ok', size: '999x999' }, 'Invalid size'],
    [{ prompt: 'ok', quality: 'ultra' }, 'Invalid quality'],
    [{ prompt: 'x'.repeat(1001) }, 'Prompt is too long']
  ])('menolak body %j dengan 400', async (body, expectedMessage) => {
    const req = { body, member: createMember() };
    const res = createRes();

    await textToImage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining(expectedMessage) })
    );
    expect(MediaContent.create).not.toHaveBeenCalled();
  });
});

describe('generate berhasil', () => {
  test('menyimpan file, menandai completed, dan mengurangi quota', async () => {
    const media = mockCreatedMedia();

    const req = { body: { prompt: 'a red apple' }, member: createMember() };
    const res = createRes();

    await textToImage(req, res);

    // File benar-benar ditulis ke disk
    const filePath = path.join(uploadDir, 'media_test1.png');
    expect(fs.existsSync(filePath)).toBe(true);

    // Record diperbarui
    expect(media.status).toBe('completed');
    expect(media.outputUrl).toBe('/uploads/media_test1.png');
    expect(media.metadata).toEqual({
      width: 1024,
      height: 1024,
      resolution: '1024x1024',
      requestedResolution: '1024x1024',
      format: 'png',
      provider: 'cloudflare',
      model: '@cf/black-forest-labs/flux-1-schnell'
    });
    expect(media.save).toHaveBeenCalled();

    // Quota berkurang 1 dan tersimpan
    expect(req.member.quota.imageGeneration).toBe(2);
    expect(req.member.save).toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        provider: 'cloudflare',
        quota: { chat: 10, imageGeneration: 2 }
      })
    );
  });

  test('meneruskan prompt, size, dan quality ke provider aktif', async () => {
    mockCreatedMedia('media_test2');

    const req = {
      body: { prompt: 'a blue cat', size: '1792x1024', quality: 'hd' },
      member: createMember()
    };

    await textToImage(req, createRes());

    expect(mockGenerateImage).toHaveBeenCalledWith({
      prompt: 'a blue cat',
      size: '1792x1024',
      quality: 'hd'
    });
  });

  test('ekstensi file mengikuti format asli provider (mis. FLUX -> jpeg)', async () => {
    const media = mockCreatedMedia('media_jpeg');
    mockGenerateImage.mockResolvedValue({
      buffer: Buffer.from('jpeg-bytes'),
      format: 'jpeg',
      mimeType: 'image/jpeg',
      provider: 'pollinations',
      model: 'flux',
      attempts: []
    });

    await textToImage({ body: { prompt: 'a dog' }, member: createMember() }, createRes());

    expect(media.outputUrl).toBe('/uploads/media_jpeg.jpeg');
    expect(media.metadata.format).toBe('jpeg');
    expect(fs.existsSync(path.join(uploadDir, 'media_jpeg.jpeg'))).toBe(true);
  });

  test('metadata memakai dimensi asli dari provider, bukan ukuran yang diminta', async () => {
    const media = mockCreatedMedia('media_scaled');
    mockGenerateImage.mockResolvedValue({
      buffer: Buffer.from('jpeg-bytes'),
      format: 'jpeg',
      mimeType: 'image/jpeg',
      provider: 'pollinations',
      model: 'flux',
      width: 768,
      height: 768,
      attempts: []
    });

    await textToImage(
      { body: { prompt: 'a cat', size: '1024x1024' }, member: createMember() },
      createRes()
    );

    expect(media.metadata).toEqual(
      expect.objectContaining({
        width: 768,
        height: 768,
        resolution: '768x768',
        requestedResolution: '1024x1024'
      })
    );
  });
});

describe('generate gagal', () => {
  test('menandai record failed dan tidak mengurangi quota', async () => {
    const media = mockCreatedMedia('media_test3');
    mockGenerateImage.mockRejectedValue(new Error('Rate limit exceeded'));

    const req = { body: { prompt: 'a dog' }, member: createMember() };
    const res = createRes();

    await textToImage(req, res);

    expect(media.status).toBe('failed');
    expect(media.error).toEqual({ message: 'Rate limit exceeded' });
    expect(req.member.quota.imageGeneration).toBe(3);
    expect(req.member.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(502);
  });

  test('mengembalikan 503 dengan pesan jelas saat provider belum dikonfigurasi', async () => {
    mockCreatedMedia('media_test4');

    const error = new Error(
      'All image providers failed (cloudflare: missing credentials). Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (free) in backend/.env.'
    );
    error.code = 'MISSING_CREDENTIALS';
    mockGenerateImage.mockRejectedValue(error);

    const req = { body: { prompt: 'a dog' }, member: createMember() };
    const res = createRes();

    await textToImage(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('CLOUDFLARE_ACCOUNT_ID') })
    );
    expect(req.member.save).not.toHaveBeenCalled();
  });

  test('nama provider salah di env juga dikembalikan sebagai 503', async () => {
    mockCreatedMedia('media_test5');

    const error = new Error('Unknown IMAGE_PROVIDER "midjourney".');
    error.code = 'INVALID_PROVIDER_CONFIG';
    mockGenerateImage.mockRejectedValue(error);

    const req = { body: { prompt: 'a dog' }, member: createMember() };
    const res = createRes();

    await textToImage(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });
});

describe('deleteMedia', () => {
  test('mengembalikan 404 jika media bukan milik user', async () => {
    MediaContent.findOneAndDelete.mockResolvedValue(null);

    const req = { params: { contentId: 'media_x' }, member: createMember() };
    const res = createRes();

    await deleteMedia(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('menghapus file di folder uploads', async () => {
    const filePath = path.join(uploadDir, 'media_deleted.png');
    fs.writeFileSync(filePath, 'x');

    MediaContent.findOneAndDelete.mockResolvedValue({
      contentId: 'media_deleted',
      outputFile: filePath
    });

    const req = { params: { contentId: 'media_deleted' }, member: createMember() };
    const res = createRes();

    await deleteMedia(req, res);

    expect(fs.existsSync(filePath)).toBe(false);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  test('ikut menghapus gambar input milik image-to-image', async () => {
    const inputPath = path.join(uploadDir, 'media_i2i_input.png');
    fs.writeFileSync(inputPath, 'x');

    MediaContent.findOneAndDelete.mockResolvedValue({
      contentId: 'media_i2i',
      inputFile: '/uploads/media_i2i_input.png',
      outputFile: null
    });

    await deleteMedia(
      { params: { contentId: 'media_i2i' }, member: createMember() },
      createRes()
    );

    expect(fs.existsSync(inputPath)).toBe(false);
  });
});

describe('imageToImage', () => {
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

  const dataUrl = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
  const INPUT_IMAGE = pngBytes(400, 300);
  const validBody = { prompt: 'make it a watercolor painting', image: dataUrl(INPUT_IMAGE) };

  const createEditRequest = (body, overrides = {}) => ({
    body,
    member: createMember(),
    protocol: 'http',
    get: () => 'localhost:4000',
    ...overrides
  });

  function mockCreatedEdit(contentId = 'media_i2i') {
    const media = {
      contentId,
      userId: 'uid-member',
      type: 'image-to-image',
      status: 'processing',
      save: jest.fn().mockResolvedValue(undefined)
    };
    MediaContent.create.mockResolvedValue(media);
    return media;
  }

  describe('validasi gambar input', () => {
    test.each([
      [{}, 'Prompt is required'],
      [{ prompt: 'ok' }, 'Input image is required'],
      [{ prompt: 'ok', image: 'bukan base64 !!' }, 'must be base64'],
      [
        { prompt: 'ok', image: Buffer.from('ini teks biasa').toString('base64') },
        'not a valid PNG, JPEG, or WEBP'
      ],
      [{ prompt: 'ok', image: dataUrl(pngBytes(1024, 1024)) }, 'at most 512x512'],
      [{ prompt: 'ok', image: dataUrl(INPUT_IMAGE), size: '999x999' }, 'Invalid size'],
      [{ prompt: 'ok', image: dataUrl(INPUT_IMAGE), guidance: 99 }, 'Invalid guidance']
    ])('menolak kasus %# dengan 400', async (body, expectedMessage) => {
      const res = createRes();

      await imageToImage(createEditRequest(body), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining(expectedMessage) })
      );
      expect(MediaContent.create).not.toHaveBeenCalled();
    });

    test('menolak gambar input yang terlalu besar sebelum menyentuh provider', async () => {
      const tooLarge = Buffer.concat([pngBytes(512, 512), Buffer.alloc(7 * 1024 * 1024, 1)]);
      const res = createRes();

      await imageToImage(createEditRequest({ prompt: 'ok', image: dataUrl(tooLarge) }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('too large') })
      );
      expect(mockEditImage).not.toHaveBeenCalled();
    });
  });

  test('menyimpan gambar input, hasil edit, dan mengurangi quota', async () => {
    const media = mockCreatedEdit('media_i2i_ok');
    const req = createEditRequest(validBody);
    const res = createRes();

    await imageToImage(req, res);

    // Gambar input disimpan agar riwayat bisa menampilkan sebelum/sesudah
    expect(fs.existsSync(path.join(uploadDir, 'media_i2i_ok_input.png'))).toBe(true);
    expect(media.inputFile).toBe('/uploads/media_i2i_ok_input.png');

    // Hasil edit disimpan dengan ekstensi sesuai format provider
    expect(fs.existsSync(path.join(uploadDir, 'media_i2i_ok.png'))).toBe(true);
    expect(media.outputUrl).toBe('/uploads/media_i2i_ok.png');
    expect(media.status).toBe('completed');

    expect(media.metadata).toEqual({
      width: 1024,
      height: 1024,
      resolution: '1024x1024',
      requestedResolution: '1024x1024',
      inputResolution: '400x300',
      format: 'png',
      provider: 'cloudflare',
      model: '@cf/black-forest-labs/flux-2-klein-4b'
    });

    expect(mockEditImage).toHaveBeenCalledWith({
      prompt: 'make it a watercolor painting',
      imageBuffer: expect.any(Buffer),
      mimeType: 'image/png',
      size: '1024x1024',
      guidance: null
    });

    expect(req.member.quota.imageGeneration).toBe(2);
    expect(req.member.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, provider: 'cloudflare' })
    );
  });

  test('PUBLIC_BASE_URL tidak lagi ikut dikirim ke provider edit', async () => {
    // Semua provider edit menerima bytes gambar hasil unggahan frontend, jadi
    // tidak ada lagi yang perlu mengambil gambar input lewat URL.
    process.env.PUBLIC_BASE_URL = 'https://aplikasi.example.com/';
    mockCreatedEdit('media_i2i_public');

    await imageToImage(createEditRequest(validBody), createRes());

    expect(mockEditImage).toHaveBeenCalledWith(
      expect.not.objectContaining({ inputPublicUrl: expect.anything() })
    );
  });

  test('guidance diteruskan ke provider bila dikirim', async () => {
    mockCreatedEdit('media_i2i_guidance');

    await imageToImage(createEditRequest({ ...validBody, guidance: 7.5 }), createRes());

    expect(mockEditImage).toHaveBeenCalledWith(expect.objectContaining({ guidance: 7.5 }));
  });

  test('kegagalan provider -> 502, record failed, quota tidak berkurang', async () => {
    const media = mockCreatedEdit('media_i2i_fail');
    mockEditImage.mockRejectedValue(new Error('model overloaded'));

    const req = createEditRequest(validBody);
    const res = createRes();

    await imageToImage(req, res);

    expect(media.status).toBe('failed');
    expect(media.error).toEqual({ message: 'model overloaded' });
    expect(req.member.quota.imageGeneration).toBe(3);
    expect(req.member.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(502);
  });

  test('kredensial belum diisi -> 503 dengan petunjuk konfigurasi', async () => {
    mockCreatedEdit('media_i2i_nocreds');

    const error = new Error('All image edit providers failed (cloudflare: missing credentials)');
    error.code = 'MISSING_CREDENTIALS';
    mockEditImage.mockRejectedValue(error);

    const res = createRes();
    await imageToImage(createEditRequest(validBody), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('missing credentials') })
    );
  });

  test('provider tanpa kemampuan edit -> 503, bukan 502', async () => {
    mockCreatedEdit('media_i2i_unsupported');

    const error = new Error('Provider ini tidak bisa mengedit gambar.');
    error.code = 'PROVIDER_UNSUPPORTED';
    mockEditImage.mockRejectedValue(error);

    const res = createRes();
    await imageToImage(createEditRequest(validBody), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('tidak bisa mengedit') })
    );
  });
});

/**
 * Mongoose membuang field yang tidak terdaftar di schema secara DIAM-DIAM.
 * Sempat terjadi pada `inputResolution`: controller menulisnya, unit test lolos
 * (karena model di-mock), tapi data yang tersimpan dan yang dikirim ke frontend
 * kehilangan field itu - sehingga riwayat tidak bisa menampilkan gambar asal.
 *
 * Test ini membaca daftar field langsung dari controller, jadi field metadata
 * baru otomatis ikut diperiksa tanpa perlu memperbarui daftar di sini.
 */
describe('schema metadata MediaContent', () => {
  const ambilFieldMetadataDariController = () => {
    const file = path.join(__dirname, '..', 'controllers', 'mediaController.js');
    const source = fs.readFileSync(file, 'utf8');
    const blocks = source.match(/media\.metadata = \{[\s\S]*?\n\s{4}\};/g) || [];

    const keys = new Set();
    for (const block of blocks) {
      for (const match of block.matchAll(/^\s{6}([A-Za-z_][A-Za-z0-9_]*):/gm)) {
        keys.add(match[1]);
      }
    }

    return { keys: [...keys], blocks: blocks.length };
  };

  test('setiap field yang ditulis controller terdaftar di schema', () => {
    const RealMediaContent = jest.requireActual('../models/MediaContent');
    const schemaFields = Object.keys(RealMediaContent.schema.paths)
      .filter((nama) => nama.startsWith('metadata.'))
      .map((nama) => nama.replace('metadata.', ''));

    const { keys, blocks } = ambilFieldMetadataDariController();

    expect(blocks).toBeGreaterThan(0);
    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      expect({ field: key, terdaftar: schemaFields.includes(key) }).toEqual({
        field: key,
        terdaftar: true
      });
    }
  });

  test('inputResolution ikut tersimpan (dipakai riwayat untuk gambar asal)', () => {
    const RealMediaContent = jest.requireActual('../models/MediaContent');

    expect(RealMediaContent.schema.paths['metadata.inputResolution']).toBeDefined();
  });
});
