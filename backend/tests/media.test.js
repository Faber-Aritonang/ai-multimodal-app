/**
 * Test: mediaController.textToImage
 * OpenAI dan model MediaContent di-mock; file hasil generate ditulis ke
 * direktori sementara lewat env UPLOAD_DIR.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockGenerateImage = jest.fn();
const mockGetOpenAIClient = jest.fn();

jest.mock('../config/openai', () => ({
  getOpenAIClient: (...args) => mockGetOpenAIClient(...args),
  getChatModel: () => 'gpt-3.5-turbo',
  getImageModel: () => 'dall-e-3',
  supportsResponseFormat: (model) => String(model).startsWith('dall-e')
}));

jest.mock('../models/MediaContent');

const MediaContent = require('../models/MediaContent');
const { textToImage, deleteMedia } = require('../controllers/mediaController');

let uploadDir;

beforeAll(() => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-uploads-'));
});

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.UPLOAD_DIR = uploadDir;
  delete process.env.OPENAI_API_KEY;
  mockGetOpenAIClient.mockReturnValue({ images: { generate: mockGenerateImage } });
  mockGenerateImage.mockResolvedValue({
    data: [{ b64_json: Buffer.from('fake-image-bytes').toString('base64') }]
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
      format: 'png'
    });
    expect(media.save).toHaveBeenCalled();

    // Quota berkurang 1 dan tersimpan
    expect(req.member.quota.imageGeneration).toBe(2);
    expect(req.member.save).toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        quota: { chat: 10, imageGeneration: 2 }
      })
    );
  });

  test('mengirim parameter yang benar ke OpenAI', async () => {
    mockCreatedMedia('media_test2');

    const req = {
      body: { prompt: 'a blue cat', size: '1792x1024', quality: 'hd' },
      member: createMember()
    };

    await textToImage(req, createRes());

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'dall-e-3',
        prompt: 'a blue cat',
        size: '1792x1024',
        quality: 'hd',
        response_format: 'b64_json'
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

  test('mengembalikan 503 dengan pesan jelas saat API key belum diisi', async () => {
    mockCreatedMedia('media_test4');
    mockGetOpenAIClient.mockImplementation(() => {
      throw new Error('OPENAI_API_KEY is not set. Add it to backend/.env to enable AI features.');
    });

    const req = { body: { prompt: 'a dog' }, member: createMember() };
    const res = createRes();

    await textToImage(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('OPENAI_API_KEY') })
    );
    expect(req.member.save).not.toHaveBeenCalled();
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
});
