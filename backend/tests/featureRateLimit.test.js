/**
 * Test: limiter per fitur (middleware/featureRateLimit.js).
 *
 * Dua lapis yang diuji:
 *  1. Middleware-nya sendiri — memakai app express kecil tanpa database.
 *  2. Pemasangannya di route asli POST /api/v1/media/text-to-image, karena
 *     middleware yang benar tetapi lupa dipasang tidak menahan apa pun.
 *
 * Batasnya diturunkan lewat env SEBELUM modul apa pun di-require: nilainya
 * dibaca sekali saat route dibuat, jadi menyetelnya di dalam test tidak akan
 * berpengaruh.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-limit-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;
process.env.JWT_SECRET = 'feature-limit-test-secret';
process.env.FEATURE_RATE_LIMIT_IMAGE_MAX = '2';
process.env.FEATURE_RATE_LIMIT_VIDEO_MAX = '2';
process.env.FEATURE_RATE_LIMIT_WINDOW_MS = '600000';

const mockGenerateImage = jest.fn();

jest.mock('../models/User');
jest.mock('../models/Admin');
jest.mock('../models/MediaContent');
jest.mock('../config/imageProviders', () => ({
  generateImage: (...args) => mockGenerateImage(...args)
}));

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const User = require('../models/User');
const MediaContent = require('../models/MediaContent');
const { featureRateLimit } = require('../middleware/featureRateLimit');

afterAll(() => {
  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

describe('featureRateLimit (middleware)', () => {
  const buildApp = () => {
    const app = express();

    app.post(
      '/video',
      (req, res, next) => {
        req.user = { uid: req.headers['x-uid'] };
        next();
      },
      featureRateLimit('video'),
      (req, res) => res.json({ success: true })
    );

    return app;
  };

  test('melewati batas fitur -> 429 dengan JSON yang bisa dibaca frontend', async () => {
    const app = buildApp();

    const pertama = await request(app).post('/video').set('x-uid', 'uid-a');
    const kedua = await request(app).post('/video').set('x-uid', 'uid-a');
    const ketiga = await request(app).post('/video').set('x-uid', 'uid-a');

    expect(pertama.status).toBe(200);
    expect(kedua.status).toBe(200);
    expect(ketiga.status).toBe(429);
    expect(ketiga.body.success).toBe(false);
    // Pesannya harus menyebut fitur & batasnya, bukan sekadar kode status.
    expect(ketiga.body.message).toMatch(/Too many video generation requests/);
    expect(ketiga.body.message).toMatch(/limit 2/);
    expect(ketiga.body.retryAfter).toBeGreaterThan(0);
    expect(ketiga.headers['retry-after']).toBeDefined();
  });

  test('hitungan per user: uid lain tidak ikut terkunci', async () => {
    const app = buildApp();

    await request(app).post('/video').set('x-uid', 'uid-b');
    await request(app).post('/video').set('x-uid', 'uid-b');

    const terkunci = await request(app).post('/video').set('x-uid', 'uid-b');
    const userLain = await request(app).post('/video').set('x-uid', 'uid-c');

    expect(terkunci.status).toBe(429);
    expect(userLain.status).toBe(200);
  });

  test('nama fitur yang tidak dikenal langsung gagal saat pemasangan', () => {
    expect(() => featureRateLimit('tidak-ada')).toThrow(/Unknown feature rate limit/);
  });

  test('chat juga punya limiternya sendiri', () => {
    expect(() => featureRateLimit('chat')).not.toThrow();
  });
});

describe('pemasangan limiter di route media', () => {
  const { app } = require('../server');

  const authHeader = (uid) => ({
    Authorization: `Bearer ${jwt.sign({ uid }, process.env.JWT_SECRET)}`
  });

  const member = () => ({
    uid: 'uid-rate',
    role: 'member',
    isApproved: true,
    quota: { chat: 10, imageGeneration: 50 },
    save: jest.fn().mockResolvedValue(undefined)
  });

  beforeEach(() => {
    mockGenerateImage.mockReset();
    mockGenerateImage.mockResolvedValue({
      buffer: Buffer.from('rate-limit-image-bytes'),
      format: 'jpeg',
      mimeType: 'image/jpeg',
      provider: 'cloudflare',
      model: '@cf/black-forest-labs/flux-1-schnell',
      attempts: []
    });

    MediaContent.create.mockResolvedValue({
      contentId: 'media_rate',
      status: 'processing',
      save: jest.fn().mockResolvedValue(undefined)
    });
  });

  test('permintaan ke-3 dari user yang sama ditolak 429 dan tidak memanggil provider', async () => {
    User.findOne.mockResolvedValue(member());

    const kirim = () =>
      request(app)
        .post('/api/v1/media/text-to-image')
        .set(authHeader('uid-rate'))
        .send({ prompt: 'kucing' });

    expect((await kirim()).status).toBe(201);
    expect((await kirim()).status).toBe(201);

    const diblokir = await kirim();

    expect(diblokir.status).toBe(429);
    expect(diblokir.body.message).toMatch(/Too many image generation requests/);
    // Ditolak SEBELUM handler: provider tidak dipanggil dan kuota tidak terpakai.
    expect(mockGenerateImage).toHaveBeenCalledTimes(2);
  });

  test('user lain tetap bisa memakai fitur yang sama', async () => {
    User.findOne.mockResolvedValue({ ...member(), uid: 'uid-rate-lain' });

    const response = await request(app)
      .post('/api/v1/media/text-to-image')
      .set(authHeader('uid-rate-lain'))
      .send({ prompt: 'kucing' });

    expect(response.status).toBe(201);
  });
});
