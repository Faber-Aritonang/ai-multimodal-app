/**
 * Test: alur lengkap text-to-sound lewat HTTP (integrasi).
 *
 * Stack yang diuji adalah stack asli: route -> requireMember -> checkQuota ->
 * mediaController -> penulisan berkas -> express.static. Hanya MongoDB (model)
 * dan provider suara yang di-mock, jadi test tetap jalan di CI tanpa kredensial
 * provider suara mana pun.
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

// Provider suara dipatok supaya daftar voice yang divalidasi tidak bergantung
// pada kredensial yang kebetulan sudah ada di mesin pengembang: begitu
// OPENAI_API_KEY terisi, provider aktif berpindah dan voice Gemini jadi tidak
// sah. Gemini adalah provider utama default untuk teks Indonesia.
const ENV_PROVIDER = ['SOUND_PROVIDER', 'SOUND_FALLBACK_PROVIDER'];
const envAwal = Object.fromEntries(ENV_PROVIDER.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.SOUND_PROVIDER = 'gemini';
});

afterAll(() => {
  ENV_PROVIDER.forEach((key) => {
    if (envAwal[key] === undefined) delete process.env[key];
    else process.env[key] = envAwal[key];
  });

  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

const authHeader = () => ({
  Authorization: `Bearer ${jwt.sign({ uid: 'uid-sound' }, process.env.JWT_SECRET)}`
});

// Kuota audio punya jatahnya sendiri: `audioGeneration`. Sebelumnya fitur suara
// memakai `videoGeneration` sehingga satu fitur bisa menghabiskan jatah fitur
// lain; pemisahan itu yang dijaga di sini.
const approvedMember = (audioGeneration = 3) => ({
  uid: 'uid-sound',
  role: 'member',
  isApproved: true,
  quota: { chat: 10, imageGeneration: 5, audioGeneration, videoGeneration: 5 },
  save: jest.fn().mockResolvedValue(undefined)
});

const WAV_BYTES = Buffer.from('RIFF____WAVEfmt ');

beforeEach(() => {
  mockGenerateSpeech.mockReset();
  mockGenerateSpeech.mockResolvedValue({
    buffer: WAV_BYTES,
    format: 'wav',
    mimeType: 'audio/wav',
    provider: 'gemini',
    model: 'gemini-3.1-flash-tts-preview',
    voice: 'Kore',
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
      .send({ text: 'Selamat pagi, ini contoh suara.', voice: 'Kore', format: 'wav' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.provider).toBe('gemini');
    expect(response.body.duration).toBe(1.5);
    expect(response.body.media.outputUrl).toBe('/uploads/media_sound.wav');
    expect(response.body.media.metadata).toMatchObject({
      format: 'wav',
      mimeType: 'audio/wav',
      duration: 1.5,
      voice: 'Kore',
      model: 'gemini-3.1-flash-tts-preview'
    });

    // Kuota yang berkurang adalah audioGeneration, bukan image/videoGeneration.
    expect(response.body.quota.audioGeneration).toBe(2);
    expect(response.body.quota.videoGeneration).toBe(5);
    expect(response.body.quota.imageGeneration).toBe(5);
    expect(member.save).toHaveBeenCalled();

    expect(mockGenerateSpeech).toHaveBeenCalledWith({
      text: 'Selamat pagi, ini contoh suara.',
      voice: 'Kore',
      style: '',
      format: 'wav'
    });

    expect(fs.existsSync(path.join(tempUploadDir, 'media_sound.wav'))).toBe(true);

    const fileResponse = await request(app).get('/uploads/media_sound.wav');
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers['content-type']).toMatch(/audio\/wav/);
  });

  test('deskripsi gaya suara dicatat, dan voice yang dipakai tetap ikut disimpan', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));
    mockGenerateSpeech.mockResolvedValue({
      buffer: WAV_BYTES,
      format: 'wav',
      mimeType: 'audio/wav',
      provider: 'gemini',
      model: 'gemini-3.1-flash-tts-preview',
      voice: 'Kore',
      duration: null,
      attempts: []
    });

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'Yes, I had a sandwich.', style: 'young male tone' });

    expect(response.status).toBe(201);
    expect(response.body.media.metadata.style).toBe('young male tone');
    // Deskripsi gaya TIDAK menggantikan pilihan voice: Gemini tetap memakai
    // voice yang dipilih, gayanya dikirim sebagai arahan di depan teks.
    expect(response.body.media.metadata.voice).toBe('Kore');
    expect(response.body.media.metadata.model).toBe('gemini-3.1-flash-tts-preview');
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
      quota: { audioGeneration: 5 },
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
    expect(response.body.message).toMatch(/Kore/);
    expect(mockGenerateSpeech).not.toHaveBeenCalled();
  });

  test('voice provider lain ditolak: nama voice Gemini bukan nilai sah untuk OpenAI', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));
    process.env.SOUND_PROVIDER = 'openai';

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'halo', voice: 'Kore' });

    expect(response.status).toBe(400);
    // Pesannya menyebut daftar provider yang AKTIF, supaya user tahu nilai
    // benar yang harus dikirim — bukan daftar gabungan yang menyesatkan.
    expect(response.body.message).toMatch(/alloy/);
    expect(response.body.message).not.toMatch(/Kore/);
  });

  test('voice yang dilaporkan provider dicatat apa adanya, bukan dari request', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));
    mockGenerateSpeech.mockResolvedValue({
      buffer: WAV_BYTES,
      format: 'wav',
      mimeType: 'audio/wav',
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      // Terjadi saat voice dari request diganti voice bawaan provider.
      voice: 'alloy',
      duration: null,
      attempts: []
    });

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'halo', voice: 'Kore' });

    expect(response.status).toBe(201);
    expect(response.body.media.metadata.voice).toBe('alloy');
    expect(response.body.media.metadata.provider).toBe('openai');
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

    const providerError = new Error('All sound providers failed (gemini: HTTP 503)');
    providerError.code = 'PROVIDER_UNAVAILABLE';
    mockGenerateSpeech.mockRejectedValue(providerError);

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'halo' });

    expect(response.status).toBe(502);
    expect(response.body.success).toBe(false);
    expect(member.quota.audioGeneration).toBe(3);
    expect(member.save).not.toHaveBeenCalled();

    const record = await MediaContent.create.mock.results[0].value;
    expect(record.status).toBe('failed');
    expect(record.error.message).toMatch(/All sound providers failed/);
  });

  test('kredensial provider yang belum diisi dijawab 503, bukan menyuruh coba lagi', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    // Pesan asli dari config/soundProviders.js saat rantainya kosong.
    const missing = new Error(
      'Text-to-sound dimatikan di server (SOUND_PROVIDER=none). Lepaskan ' +
        'pengaturan itu untuk memakai Edge TTS (suara Indonesia, tanpa kunci) ' +
        'atau isi GEMINI_API_KEY (https://aistudio.google.com/apikey) untuk ' +
        'logat yang bisa diarahkan lewat deskripsi gaya.'
    );
    missing.code = 'MISSING_CREDENTIALS';
    mockGenerateSpeech.mockRejectedValue(missing);

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'halo' });

    expect(response.status).toBe(503);
    expect(response.body.message).toMatch(/SOUND_PROVIDER=none/);
    expect(response.body.message).toMatch(/GEMINI_API_KEY/);
  });
});

describe('GET /api/v1/media/status', () => {
  test('text-to-sound terdaftar sebagai endpoint yang tersedia', async () => {
    const response = await request(app).get('/api/v1/media/status');

    expect(response.body.availableEndpoints).toContain('POST /api/v1/media/text-to-sound');
    expect(response.body.comingSoonEndpoints).not.toContain('POST /api/v1/media/text-to-sound');
  });
});

describe('GET /api/v1/media/sound-voices', () => {
  const ambil = () =>
    request(app).get('/api/v1/media/sound-voices').set(authHeader());

  test('member mendapat voice milik provider yang aktif', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await ambil();

    expect(response.status).toBe(200);
    expect(response.body.provider).toBe('gemini');
    expect(response.body.defaultVoice).toBe('Kore');
    expect(response.body.voices.map((item) => item.value)).toContain('Kore');
  });

  test('daftar berpindah begitu providernya ditukar, tanpa mengubah frontend', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));
    process.env.SOUND_PROVIDER = 'openai';

    const response = await ambil();

    expect(response.body.provider).toBe('openai');
    expect(response.body.defaultVoice).toBe('alloy');
    // Voice Gemini tidak dikenal OpenAI — inilah yang membuat salah pilih tidak
    // mungkin terjadi dari UI.
    expect(response.body.voices.map((item) => item.value)).not.toContain('Kore');
  });

  test('format yang sah ikut provider: Gemini hanya WAV', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));
    process.env.SOUND_PROVIDER = 'gemini';

    const response = await ambil();

    expect(response.body.provider).toBe('gemini');
    // Gemini mengembalikan PCM yang dibungkus WAV; MP3 bukan sesuatu yang bisa
    // dihasilkannya di sini, jadi tidak ditawarkan ke user.
    expect(response.body.formats).toEqual(['wav']);
  });

  test('MP3 ditolak 400 saat provider yang aktif tidak sanggup menghasilkannya', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));
    process.env.SOUND_PROVIDER = 'gemini';

    const response = await request(app)
      .post('/api/v1/media/text-to-sound')
      .set(authHeader())
      .send({ text: 'halo', format: 'mp3' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Invalid format/);
    expect(response.body.message).toMatch(/gemini/);
    expect(mockGenerateSpeech).not.toHaveBeenCalled();
  });

  test('tanpa token ditolak 401', async () => {
    const response = await request(app).get('/api/v1/media/sound-voices');

    expect(response.status).toBe(401);
  });
});
