/**
 * Test: alur lengkap text-to-video & image-to-video lewat HTTP (integrasi).
 *
 * Stack yang diuji adalah stack asli: route -> requireMember -> checkQuota ->
 * mediaController -> penulisan berkas -> express.static. Hanya MongoDB (model)
 * dan provider video yang di-mock, jadi test tetap jalan di CI tanpa kredensial
 * dan tanpa jaringan.
 *
 * Yang khas dari fitur ini: pekerjaannya berjalan di LATAR BELAKANG setelah
 * responsnya dikirim (202). Karena itu setiap test menunggu recordnya berubah
 * status memakai `tungguSelesai()` — bukan memeriksa hasil langsung setelah
 * respons, yang akan selalu melihat status `processing`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockGenerateVideo = jest.fn();

const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-flow-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;
process.env.JWT_SECRET = 'video-flow-test-secret';

jest.mock('../models/User');
jest.mock('../models/Admin');
jest.mock('../models/MediaContent');
jest.mock('../config/videoProviders', () => ({
  ...jest.requireActual('../config/videoProviders'),
  generateVideo: (...args) => mockGenerateVideo(...args)
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
  Authorization: `Bearer ${jwt.sign({ uid: 'uid-video' }, process.env.JWT_SECRET)}`
});

const approvedMember = (videoGeneration = 3) => ({
  uid: 'uid-video',
  role: 'member',
  isApproved: true,
  quota: { chat: 10, imageGeneration: 5, videoGeneration },
  save: jest.fn().mockResolvedValue(undefined)
});

/**
 * Tunggu sampai pekerjaan latar belakang menutup recordnya.
 *
 * Batas waktunya kecil karena providernya di-mock; yang ditunggu hanyalah
 * giliran microtask/timer, bukan generasi video sungguhan.
 */
const tungguSelesai = async (media, timeoutMs = 2000) => {
  const batas = Date.now() + timeoutMs;

  while (Date.now() < batas) {
    if (media.status === 'completed' || media.status === 'failed') return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  return false;
};

/**
 * PNG minimal yang dimensinya benar-benar terbaca dari header IHDR — bukan
 * sekadar magic bytes, karena gambar pertama image-to-video ikut diukur.
 */
const pngBytes = (width = 1024, height = 768) => {
  const buffer = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const dataUrl = (buffer, mime = 'image/png') =>
  `data:${mime};base64,${buffer.toString('base64')}`;

const MP4 = Buffer.from('00000018667479706d703432', 'hex');

let mediaRecord;

beforeEach(() => {
  mockGenerateVideo.mockReset();
  mockGenerateVideo.mockResolvedValue({
    buffer: MP4,
    format: 'mp4',
    mimeType: 'video/mp4',
    provider: 'bynara',
    model: 'agnes-video-v2.0',
    duration: 5,
    jobId: 'job-1',
    attempts: []
  });

  mediaRecord = {
    contentId: 'media_video',
    prompt: '',
    status: 'processing',
    save: jest.fn().mockResolvedValue(undefined)
  };

  MediaContent.create.mockReset();
  MediaContent.create.mockResolvedValue(mediaRecord);
});

describe('POST /api/v1/media/text-to-video', () => {
  test('membalas 202 dengan record processing, lalu menyimpan videonya', async () => {
    const member = approvedMember(3);
    User.findOne.mockResolvedValue(member);

    const response = await request(app)
      .post('/api/v1/media/text-to-video')
      .set(authHeader())
      .send({ prompt: 'sebuah kota futuristik saat senja' });

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe('processing');
    expect(response.body.media.contentId).toBe('media_video');
    expect(response.body.media.status).toBe('processing');

    // Kuota BELUM berkurang: angkanya baru berubah setelah videonya tersimpan,
    // supaya pekerjaan yang gagal tidak menghabiskan jatah user.
    expect(response.body.quota.videoGeneration).toBe(3);

    expect(mockGenerateVideo).toHaveBeenCalledWith({
      prompt: 'sebuah kota futuristik saat senja',
      mode: 't2v',
      imageBuffer: undefined,
      mimeType: undefined,
      resolution: '720p',
      ratio: '16:9',
      duration: 5
    });

    expect(await tungguSelesai(mediaRecord)).toBe(true);

    expect(mediaRecord.status).toBe('completed');
    expect(mediaRecord.outputUrl).toBe('/uploads/media_video.mp4');
    expect(mediaRecord.metadata).toEqual({
      format: 'mp4',
      mimeType: 'video/mp4',
      duration: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      mode: 't2v',
      jobId: 'job-1',
      provider: 'bynara',
      model: 'agnes-video-v2.0'
    });

    // Kuota berkurang satu setelah hasilnya benar-benar tersimpan.
    expect(member.quota.videoGeneration).toBe(2);
    expect(member.save).toHaveBeenCalled();

    // Berkasnya benar-benar ada dan disajikan sebagai video.
    expect(fs.existsSync(path.join(tempUploadDir, 'media_video.mp4'))).toBe(true);
    const fileResponse = await request(app).get('/uploads/media_video.mp4');
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers['content-type']).toMatch(/video\/mp4/);
  });

  test('durasi yang dipilih user diteruskan ke provider, bukan default', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/text-to-video')
      .set(authHeader())
      .send({ prompt: 'ombak laut', duration: 12 });

    expect(response.status).toBe(202);
    expect(mockGenerateVideo).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 12 })
    );
  });

  test('kegagalan provider menutup recordnya sebagai failed, kuota tidak berkurang', async () => {
    const member = approvedMember(3);
    User.findOne.mockResolvedValue(member);
    mockGenerateVideo.mockRejectedValue(
      Object.assign(new Error('All video providers failed'), { code: 'PROVIDER_UNAVAILABLE' })
    );

    const response = await request(app)
      .post('/api/v1/media/text-to-video')
      .set(authHeader())
      .send({ prompt: 'apa saja' });

    expect(response.status).toBe(202);
    expect(await tungguSelesai(mediaRecord)).toBe(true);

    expect(mediaRecord.status).toBe('failed');
    // Pesannya pesan ramah, bukan detail provider.
    expect(mediaRecord.error.message).toBe('Video generation failed. Please try again.');
    expect(mediaRecord.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(member.quota.videoGeneration).toBe(3);
    expect(member.save).not.toHaveBeenCalled();
  });

  test('kunci yang belum diisi dijelaskan apa adanya, bukan sebagai "coba lagi"', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));
    mockGenerateVideo.mockRejectedValue(
      Object.assign(new Error('All video providers failed (missing credentials)'), {
        code: 'MISSING_CREDENTIALS'
      })
    );

    await request(app)
      .post('/api/v1/media/text-to-video')
      .set(authHeader())
      .send({ prompt: 'apa saja' });

    expect(await tungguSelesai(mediaRecord)).toBe(true);
    expect(mediaRecord.status).toBe('failed');
    // Pesan konfigurasi diteruskan utuh supaya user tahu menekan tombol lagi
    // tidak akan menolong.
    expect(mediaRecord.error.message).toMatch(/All video providers failed/);
    expect(mediaRecord.error.code).toBe('MISSING_CREDENTIALS');
  });

  test('prompt wajib diisi', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/text-to-video')
      .set(authHeader())
      .send({ prompt: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Prompt is required');
    expect(MediaContent.create).not.toHaveBeenCalled();
  });

  test('resolusi dan durasi di luar dukungan provider ditolak sebelum pekerjaan dimulai', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const resolusi = await request(app)
      .post('/api/v1/media/text-to-video')
      .set(authHeader())
      .send({ prompt: 'x', resolution: '480p' });

    expect(resolusi.status).toBe(400);
    expect(resolusi.body.message).toMatch(/Invalid resolution/);

    const durasi = await request(app)
      .post('/api/v1/media/text-to-video')
      .set(authHeader())
      .send({ prompt: 'x', duration: 60 });

    expect(durasi.status).toBe(400);
    expect(durasi.body.message).toMatch(/Invalid duration/);

    const ratio = await request(app)
      .post('/api/v1/media/text-to-video')
      .set(authHeader())
      .send({ prompt: 'x', ratio: '7:3' });

    expect(ratio.status).toBe(400);
    expect(ratio.body.message).toMatch(/Invalid aspect ratio/);

    // Tidak ada satu pun permintaan yang sampai ke provider.
    expect(MediaContent.create).not.toHaveBeenCalled();
    expect(mockGenerateVideo).not.toHaveBeenCalled();
  });

  test('kuota video habis ditolak 403 tanpa membuat record', async () => {
    User.findOne.mockResolvedValue(approvedMember(0));

    const response = await request(app)
      .post('/api/v1/media/text-to-video')
      .set(authHeader())
      .send({ prompt: 'apa saja' });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/Quota for videoGeneration/);
    expect(MediaContent.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/media/image-to-video', () => {
  test('gambar pertama disimpan lebih dulu lalu videonya dibuat', async () => {
    const member = approvedMember(3);
    User.findOne.mockResolvedValue(member);

    const response = await request(app)
      .post('/api/v1/media/image-to-video')
      .set(authHeader())
      .send({ prompt: 'kamra mendekat perlahan', image: dataUrl(pngBytes()) });

    expect(response.status).toBe(202);
    expect(response.body.media.inputFile).toBe('/uploads/media_video_input.png');

    // Gambar input langsung tersimpan supaya riwayat bisa menunjukkan sumbernya.
    expect(fs.existsSync(path.join(tempUploadDir, 'media_video_input.png'))).toBe(true);

    expect(await tungguSelesai(mediaRecord)).toBe(true);
    expect(mediaRecord.status).toBe('completed');
    // Bentuk gambar mengikuti gambar pertama, jadi tidak dicatat sebagai
    // permintaan user.
    expect(mediaRecord.metadata.mode).toBe('i2v');
    expect(mediaRecord.metadata.aspectRatio).toBeNull();

    expect(mockGenerateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'kamra mendekat perlahan',
        mode: 'i2v',
        mimeType: 'image/png',
        ratio: null
      })
    );
    // Bytes gambar yang dikirim ke provider persis isi unggahannya.
    expect(mockGenerateVideo.mock.calls[0][0].imageBuffer.equals(pngBytes())).toBe(true);
  });

  test('gambar yang bukan gambar ditolak 400', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/image-to-video')
      .set(authHeader())
      .send({ prompt: 'x', image: dataUrl(Buffer.from('bukan gambar sama sekali')) });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/not a valid PNG, JPEG, or WEBP/);
    expect(MediaContent.create).not.toHaveBeenCalled();
  });

  test('tanpa gambar ditolak 400', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/image-to-video')
      .set(authHeader())
      .send({ prompt: 'x' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Input image is required');
  });

  test('gambar yang terlalu besar ditolak 400 dengan batasnya', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .post('/api/v1/media/image-to-video')
      .set(authHeader())
      .send({ prompt: 'x', image: dataUrl(pngBytes(3000, 3000)) });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/at most 1920x1920 pixels/);
  });
});

describe('GET /api/v1/media/video-options', () => {
  test('melaporkan mode dan batas yang dipakai halaman video', async () => {
    User.findOne.mockResolvedValue(approvedMember(3));

    const response = await request(app)
      .get('/api/v1/media/video-options')
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.modes).toEqual(['t2v', 'i2v']);
    expect(response.body.resolutions).toEqual(['720p', '1080p']);
    expect(response.body.defaultResolution).toBe('720p');
    // Provider menerima 3-15 detik, jadi seluruh rentang itulah yang ditawarkan.
    expect(response.body.durations).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
    ]);
    expect(response.body.defaultDuration).toBe(5);
    expect(response.body.mimeType).toBe('video/mp4');
  });
});
