/**
 * Test: alur lengkap text-to-sound lewat HTTP (integrasi).
 *
 * Stack yang diuji adalah stack asli: route -> requireMember -> checkQuota ->
 * mediaController -> penulisan berkas -> express.static. Hanya MongoDB (model)
 * dan provider suara yang di-mock, jadi test tetap jalan di CI tanpa kredensial
 * MiMo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockGenerateSpeech = jest.fn();

const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-flow-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;
process.env.JWT_SECRET = 'sound-flow-test-secret';

jest.mock('../models/User');
jest.mock('../models/Admin');
jest.mock('../models/MediaContent');
jest.mock('../config/soundProviders', () => ({
  ...jest.requireActual('../config/soundProviders'),
  generateSpeech: (...args) => mockGenerateSpeech(...args)
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
  Authorization: `Bearer ${jwt.sign({ uid: 'uid-sound' }, process.env.JWT_SECRET)}`
});

// Kuota audio memakai `videoGeneration` yang sudah ada (lihat mediaController).
const approvedMember = (videoGeneration = 3) => ({
  uid: 'uid-sound',
  role: 'member',
  isApproved: true,
  quota: { chat: 10, imageGeneration: 5, videoGeneration },
  save: jest.fn().mockResolvedValue(undefined)
});

const WAV_BYTES = Buffer.from('RIFF____WAVEfmt ');

beforeEach(() => {
  mockGenerateSpeech.mockReset();
  mockGenerateSpeech.mockResolvedValue({
    buffer: WAV_BYTES,
    format: 'wav',
    mimeType: 'audio/wav',
    provider: 'mimo',
    model: 'mimo-v2.5-tts',
    duration: 1.5,
    attempts: []
  });

  MediaContent.create.mockResolvedValue({
    contentId: 'media_sound',
    status: 'processing',
    save: jest.fn().mockResolvedValue(undefined)
  });
});

describe('POST /api/v1/media/text-to-sound', () => {
  test('member terverifikasi mendapat 201 dan berkas audionya bisa diakses', async () => {
    const member = approvedMember(3);
    User.findOne.mockResolvedValue(member);

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'Selamat pagi, ini contoh suara.', voice: 'Mia', format: 'wav' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.provider).toBe('mimo');
    expect(response.body.duration).toBe(1.5);
    expect(response.body.media.outputUrl).toBe('/uploads/media_sound.wav');
    expect(response.body.media.metadata).toMatchObject({
      format: 'wav',
      mimeType: 'audio/wav',
      duration: 1.5,
      voice: 'Mia',
      model: 'mimo-v2.5-tts'
    });

    // Kuota yang berkurang adalah videoGeneration, bukan imageGeneration.
    expect(response.body.quota.videoGeneration).toBe(2);
    expect(response.body.quota.imageGeneration).toBe(5);
    expect(member.save).toHaveBeenCalled();

    expect(mockGenerateSpeech).toHaveBeenCalledWith({
      text: 'Selamat pagi, ini contoh suara.',
      voice: 'Mia',
      style: '',
      format: 'wav'
    });

    expect(fs.existsSync(path.join(tempUploadDir, 'media_sound.wav'))).toBe(true);

    const fileResponse = await request(app).get('/uploads/media_sound.wav');
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers['content-type']).toMatch(/audio\/wav/);
  });

  test('deskripsi gaya suara dicatat, dan voice bawaan tidak ikut disimpan', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));
    mockGenerateSpeech.mockResolvedValue({
      buffer: WAV_BYTES,
      format: 'wav',
      mimeType: 'audio/wav',
      provider: 'mimo',
      model: 'mimo-v2.5-tts-voicedesign',
      duration: null,
      attempts: []
    });

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'Yes, I had a sandwich.', style: 'young male tone' });

    expect(response.status).toBe(201);
    expect(response.body.media.metadata.style).toBe('young male tone');
    // Suaranya dibuat dari deskripsi, jadi tidak ada voice bawaan yang dipakai.
    expect(response.body.media.metadata.voice).toBeNull();
    expect(response.body.media.metadata.model).toBe('mimo-v2.5-tts-voicedesign');
  });

  test('member tanpa kuota audio ditolak 403 dan provider tidak dipanggil', async () => {
    User.findOne.mockResolvedValue(approvedMember(0));

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'halo' });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/quota/i);
    expect(mockGenerateSpeech).not.toHaveBeenCalled();
    expect(MediaContent.create).not.toHaveBeenCalled();
  });

  test('user yang belum di-approve ditolak 403', async () => {
    User.findOne.mockResolvedValue({
      uid: 'uid-sound',
      role: 'guest',
      isApproved: false,
      quota: { videoGeneration: 5 },
      save: jest.fn()
    });

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'halo' });

    expect(response.status).toBe(403);
    expect(response.body.role).toBe('pending');
  });

  test('teks kosong ditolak 400 setelah lolos auth & kuota', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/text is required/i);
    expect(mockGenerateSpeech).not.toHaveBeenCalled();
  });

  test('voice yang tidak dikenal ditolak 400 beserta daftar yang benar', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'halo', voice: 'suara-ajaib' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Invalid voice/);
    expect(response.body.message).toMatch(/mimo_default/);
    expect(mockGenerateSpeech).not.toHaveBeenCalled();
  });

  test('format yang tidak didukung ditolak 400', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'halo', format: 'ogg' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Invalid format/);
  });

  test('kegagalan provider dicatat sebagai failed dan kuota tidak berkurang', async () => {
    const member = approvedMember(3);
    User.findOne.mockResolvedValue(member);

    const providerError = new Error('All sound providers failed (mimo: HTTP 503)');
    providerError.code = 'PROVIDER_UNAVAILABLE';
    mockGenerateSpeech.mockRejectedValue(providerError);

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'halo' });

    expect(response.status).toBe(502);
    expect(response.body.success).toBe(false);
    expect(member.quota.videoGeneration).toBe(3);
    expect(member.save).not.toHaveBeenCalled();

    const record = await MediaContent.create.mock.results[0].value;
    expect(record.status).toBe('failed');
    expect(record.error.message).toMatch(/All sound providers failed/);
  });

  test('kredensial provider yang belum diisi dijawab 503, bukan menyuruh coba lagi', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const missing = new Error(
      'Text-to-sound belum dikonfigurasi di server. Isi MIMO_API_KEY di backend/.env.'
    );
    missing.code = 'MISSING_CREDENTIALS';
    mockGenerateSpeech.mockRejectedValue(missing);

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'halo' });

    expect(response.status).toBe(503);
    expect(response.body.message).toMatch(/MIMO_API_KEY/);
  });
});

describe('GET /api/v1/media/status', () => {
  test('text-to-sound terdaftar sebagai endpoint yang tersedia', async () => {
    const response = await request(app).get('/api/v1/media/status');

    expect(response.body.availableEndpoints).toContain('POST /api/v1/media/text-to-sound');
    expect(response.body.comingSoonEndpoints).not.toContain('POST /api/v1/media/text-to-sound');
  });
});
