/**
 * Test: alur lengkap sound-to-text lewat HTTP (integrasi).
 *
 * Stack yang diuji adalah stack asli: route -> requireMember -> checkQuota ->
 * mediaController -> penulisan berkas -> express.static. Hanya MongoDB (model)
 * dan provider transkripsi yang di-mock, jadi test tetap jalan di CI tanpa
 * kredensial provider mana pun.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockTranscribeAudio = jest.fn();

const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-flow-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;
process.env.JWT_SECRET = 'stt-flow-test-secret';

jest.mock('../models/User');
jest.mock('../models/Admin');
jest.mock('../models/MediaContent');
jest.mock('../config/speechToTextProviders', () => ({
  ...jest.requireActual('../config/speechToTextProviders'),
  transcribeAudio: (...args) => mockTranscribeAudio(...args)
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
  Authorization: `Bearer ${jwt.sign({ uid: 'uid-stt' }, process.env.JWT_SECRET)}`
});

// Kuota audio punya jatahnya sendiri: `audioGeneration` (dulu memakai
// `videoGeneration` — lihat mediaController).
const approvedMember = (audioGeneration = 3) => ({
  uid: 'uid-stt',
  role: 'member',
  isApproved: true,
  quota: { chat: 10, imageGeneration: 5, audioGeneration, videoGeneration: 5 },
  save: jest.fn().mockResolvedValue(undefined)
});

/** WAV minimal yang dikenali dari magic bytes-nya. */
const wavBytes = () => {
  const buffer = Buffer.alloc(64);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(56, 4);
  buffer.write('WAVE', 8, 'ascii');
  return buffer;
};

const dataUrl = (buffer, mime = 'audio/wav') =>
  `data:${mime};base64,${buffer.toString('base64')}`;

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32)]);

let mediaRecord;

beforeEach(() => {
  mockTranscribeAudio.mockReset();
  mockTranscribeAudio.mockResolvedValue({
    text: 'Selamat pagi, ini hasil transkripsinya.',
    provider: 'groq',
    model: 'whisper-large-v3',
    language: 'id',
    attempts: []
  });

  mediaRecord = {
    contentId: 'media_stt',
    status: 'processing',
    save: jest.fn().mockResolvedValue(undefined)
  };

  MediaContent.create.mockReset();
  MediaContent.create.mockResolvedValue(mediaRecord);
});

describe('POST /api/v1/media/sound-to-text', () => {
  test('member terverifikasi mendapat 201 dan audionya bisa diputar kembali', async () => {
    const member = approvedMember(3);
    User.findOne.mockResolvedValue(member);

    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: dataUrl(wavBytes()), language: 'id' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.provider).toBe('groq');
    expect(response.body.transcript).toBe('Selamat pagi, ini hasil transkripsinya.');
    expect(response.body.media.prompt).toBe('Selamat pagi, ini hasil transkripsinya.');
    expect(response.body.media.inputFile).toBe('/uploads/media_stt_input.wav');
    expect(response.body.media.metadata).toMatchObject({
      transcript: 'Selamat pagi, ini hasil transkripsinya.',
      language: 'id',
      format: 'wav',
      mimeType: 'audio/wav',
      provider: 'groq',
      model: 'whisper-large-v3'
    });

    // Kuota yang berkurang adalah audioGeneration, bukan image/videoGeneration.
    expect(response.body.quota.audioGeneration).toBe(2);
    expect(response.body.quota.videoGeneration).toBe(5);
    expect(response.body.quota.imageGeneration).toBe(5);
    expect(member.save).toHaveBeenCalled();

    expect(mockTranscribeAudio).toHaveBeenCalledWith({
      buffer: wavBytes(),
      format: 'wav',
      mimeType: 'audio/wav',
      language: 'id',
      prompt: ''
    });

    // Audio input disimpan supaya riwayat bisa memutarnya kembali.
    expect(fs.existsSync(path.join(tempUploadDir, 'media_stt_input.wav'))).toBe(true);

    const fileResponse = await request(app).get('/uploads/media_stt_input.wav');
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers['content-type']).toMatch(/audio\//);
  });

  test('record dicatat sebagai sound-to-text, bukan text-to-sound', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: dataUrl(wavBytes()) });

    expect(MediaContent.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'uid-stt', type: 'sound-to-text' })
    );
  });

  test('bahasa & prompt opsional diteruskan apa adanya ke provider', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: dataUrl(wavBytes()), language: 'auto', prompt: 'istilah: neural network' });

    expect(mockTranscribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'auto', prompt: 'istilah: neural network' })
    );
  });

  test('tanpa bahasa, Bahasa Indonesia dipakai sebagai default', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: dataUrl(wavBytes()) });

    expect(response.status).toBe(201);
    expect(mockTranscribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'id' })
    );
  });

  test('member tanpa kuota audio ditolak 403 dan provider tidak dipanggil', async () => {
    User.findOne.mockResolvedValue(approvedMember(0));

    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: dataUrl(wavBytes()) });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/quota/i);
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
    expect(MediaContent.create).not.toHaveBeenCalled();
  });

  test('user yang belum di-approve ditolak 403', async () => {
    User.findOne.mockResolvedValue({
      uid: 'uid-stt',
      role: 'guest',
      isApproved: false,
      quota: { audioGeneration: 5 },
      save: jest.fn()
    });

    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: dataUrl(wavBytes()) });

    expect(response.status).toBe(403);
    expect(response.body.role).toBe('pending');
  });

  test('tanpa token ditolak 401', async () => {
    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .send({ audio: dataUrl(wavBytes()) });

    expect(response.status).toBe(401);
  });

  test('audio kosong ditolak 400 setelah lolos auth & kuota', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/audio is required/i);
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
  });

  test('berkas yang bukan audio ditolak 400 (dicek dari isinya, bukan MIME-nya)', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      // MIME-nya sengaja diklaim audio, isinya PNG.
      .send({ audio: dataUrl(PNG_BYTES, 'audio/wav') });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/not a valid file/i);
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
  });

  test('base64 sampah ditolak 400', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: 'bukan data url!' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/base64 or a data URL/i);
  });

  test('bahasa yang bentuknya tidak sah ditolak 400', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: dataUrl(wavBytes()), language: 'bahasa-indonesia' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Invalid language/);
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
  });

  test('prompt yang terlalu panjang ditolak 400', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: dataUrl(wavBytes()), prompt: 'x'.repeat(600) });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Prompt is too long/);
  });

  test('kegagalan provider dicatat sebagai failed dan kuota tidak berkurang', async () => {
    const member = approvedMember(3);
    User.findOne.mockResolvedValue(member);

    const providerError = new Error('All speech-to-text providers failed (groq: HTTP 503)');
    providerError.code = 'PROVIDER_UNAVAILABLE';
    mockTranscribeAudio.mockRejectedValue(providerError);

    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: dataUrl(wavBytes()) });

    expect(response.status).toBe(502);
    expect(response.body.success).toBe(false);
    expect(member.quota.audioGeneration).toBe(3);
    expect(member.save).not.toHaveBeenCalled();

    expect(mediaRecord.status).toBe('failed');
    expect(mediaRecord.error.message).toMatch(/All speech-to-text providers failed/);
    // Audionya tetap tersimpan walau transkripsinya gagal: user bisa mencoba
    // ulang tanpa mengunggah berkasnya lagi.
    expect(mediaRecord.inputFile).toBe('/uploads/media_stt_input.wav');
  });

  test('kredensial provider yang belum diisi dijawab 503, bukan menyuruh coba lagi', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const missing = new Error(
      'Sound-to-text belum aktif di server: tidak ada kredensial provider transkripsi. ' +
        'Isi GROQ_API_KEY (https://console.groq.com/keys, gratis, 1.000 request/hari) atau ' +
        'GEMINI_API_KEY (https://aistudio.google.com/apikey) lalu restart backend.'
    );
    missing.code = 'MISSING_CREDENTIALS';
    mockTranscribeAudio.mockRejectedValue(missing);

    const response = await request(app)
      .post('/api/v1/media/sound-to-text')
      .set(authHeader())
      .send({ audio: dataUrl(wavBytes()) });

    expect(response.status).toBe(503);
    expect(response.body.message).toMatch(/GROQ_API_KEY/);
    expect(response.body.message).toMatch(/GEMINI_API_KEY/);
  });
});

describe('GET /api/v1/media/transcribe-options', () => {
  test('member mendapat bahasa, format, dan batas ukuran yang diterima', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .get('/api/v1/media/transcribe-options')
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.defaultLanguage).toBe('id');
    expect(response.body.languages.map((item) => item.value)).toContain('auto');
    expect(response.body.acceptedFormats).toContain('wav');
    expect(response.body.maxAudioBytes).toBeGreaterThan(0);
  });

  test('tanpa token ditolak 401', async () => {
    const response = await request(app).get('/api/v1/media/transcribe-options');

    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/media/status', () => {
  test('sound-to-text terdaftar sebagai endpoint yang tersedia', async () => {
    const response = await request(app).get('/api/v1/media/status');

    expect(response.body.availableEndpoints).toContain('POST /api/v1/media/sound-to-text');
    expect(response.body.availableEndpoints).toContain('GET /api/v1/media/transcribe-options');
    expect(response.body.comingSoonEndpoints).not.toContain('POST /api/v1/media/sound-to-text');
  });
});
