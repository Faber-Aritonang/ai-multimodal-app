/**
 * Test: alur lengkap text-to-image lewat HTTP (integrasi).
 *
 * Yang diuji adalah stack asli: route -> requireMember -> checkQuota ->
 * mediaController -> penulisan file -> express.static.
 * Hanya MongoDB (model) dan OpenAI yang di-mock, jadi test tetap jalan di CI
 * tanpa kredensial.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockGenerateImage = jest.fn();
const mockGetOpenAIClient = jest.fn();

const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;
process.env.JWT_SECRET = 'flow-test-secret';

jest.mock('../models/User');
jest.mock('../models/Admin');
jest.mock('../models/MediaContent');
jest.mock('../config/openai', () => ({
  getOpenAIClient: (...args) => mockGetOpenAIClient(...args),
  getChatModel: () => 'gpt-3.5-turbo',
  getImageModel: () => 'dall-e-3',
  supportsResponseFormat: () => true
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const User = require('../models/User');
const MediaContent = require('../models/MediaContent');
const { app } = require('../server');

afterAll(() => {
  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

const authHeader = () => ({
  Authorization: `Bearer ${jwt.sign({ uid: 'uid-flow' }, process.env.JWT_SECRET)}`
});

const approvedMember = (imageGeneration = 3) => ({
  uid: 'uid-flow',
  role: 'member',
  isApproved: true,
  quota: { chat: 10, imageGeneration },
  save: jest.fn().mockResolvedValue(undefined)
});

beforeEach(() => {
  mockGetOpenAIClient.mockReturnValue({ images: { generate: mockGenerateImage } });
  mockGenerateImage.mockResolvedValue({
    data: [{ b64_json: Buffer.from('flow-image').toString('base64') }]
  });
  MediaContent.create.mockResolvedValue({
    contentId: 'media_flow',
    status: 'processing',
    save: jest.fn().mockResolvedValue(undefined)
  });
});

describe('POST /api/v1/media/text-to-image', () => {
  test('member terverifikasi mendapat 201 dan gambarnya bisa diakses', async () => {
    const member = approvedMember(3);
    User.findOne.mockResolvedValue(member);

    const response = await request(app)
      .post('/api/v1/media/text-to-image')
      .set(authHeader())
      .send({ prompt: 'a scenic mountain lake' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.media.outputUrl).toBe('/uploads/media_flow.png');
    expect(response.body.quota.imageGeneration).toBe(2);
    expect(member.save).toHaveBeenCalled();

    // File benar-benar tersimpan dan bisa diambil lewat endpoint statis
    expect(fs.existsSync(path.join(tempUploadDir, 'media_flow.png'))).toBe(true);

    const fileResponse = await request(app).get('/uploads/media_flow.png');
    expect(fileResponse.status).toBe(200);
  });

  test('member tanpa quota gambar ditolak 403 dan OpenAI tidak dipanggil', async () => {
    User.findOne.mockResolvedValue(approvedMember(0));

    const response = await request(app)
      .post('/api/v1/media/text-to-image')
      .set(authHeader())
      .send({ prompt: 'a scenic mountain lake' });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/quota/i);
    expect(mockGenerateImage).not.toHaveBeenCalled();
    expect(MediaContent.create).not.toHaveBeenCalled();
  });

  test('user yang belum di-approve ditolak 403', async () => {
    User.findOne.mockResolvedValue({
      uid: 'uid-flow',
      role: 'guest',
      isApproved: false,
      quota: { imageGeneration: 5 },
      save: jest.fn()
    });

    const response = await request(app)
      .post('/api/v1/media/text-to-image')
      .set(authHeader())
      .send({ prompt: 'a scenic mountain lake' });

    expect(response.status).toBe(403);
    expect(response.body.role).toBe('pending');
  });

  test('prompt kosong ditolak 400 setelah lolos auth & quota', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/text-to-image')
      .set(authHeader())
      .send({ prompt: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/prompt/i);
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });
});
