/**
 * Test: smoke test HTTP endpoint.
 * App di-require tanpa menyalakan server/koneksi DB (lihat server.js),
 * sehingga test bisa jalan di CI tanpa kredensial apa pun.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Folder upload khusus test, harus di-set sebelum server.js di-require
// karena express.static membaca env ini saat mounting.
const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;

const request = require('supertest');
const { app } = require('../server');

afterAll(() => {
  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

describe('GET /health', () => {
  test('mengembalikan status OK dan kondisi database', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('OK');
    expect(response.body.database).toBe('disconnected');
    expect(typeof response.body.timestamp).toBe('string');
  });

  describe('status konfigurasi layanan', () => {
    const TOUCHED_VARS = [
      'FIREBASE_SERVICE_ACCOUNT',
      'OPENAI_API_KEY',
      'NODE_ENV'
    ];

    let saved;

    beforeEach(() => {
      saved = Object.fromEntries(TOUCHED_VARS.map((key) => [key, process.env[key]]));
    });

    afterEach(() => {
      TOUCHED_VARS.forEach((key) => {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      });
    });

    const services = async () => (await request(app).get('/health')).body.services;

    test('tanpa kredensial keduanya dilaporkan missing', async () => {
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
      delete process.env.OPENAI_API_KEY;

      expect(await services()).toEqual({
        firebase: 'missing',
        openai: 'missing',
        devLogin: 'enabled'
      });
    });

    test('path service account yang filenya tidak ada -> missing', async () => {
      process.env.FIREBASE_SERVICE_ACCOUNT = './config/berkas-tidak-ada.json';

      expect((await services()).firebase).toBe('missing');
    });

    test('JSON service account dianggap configured', async () => {
      process.env.FIREBASE_SERVICE_ACCOUNT = '{"type":"service_account"}';

      expect((await services()).firebase).toBe('configured');
    });

    test('nilai placeholder tidak dianggap sebagai konfigurasi valid', async () => {
      process.env.OPENAI_API_KEY = 'sk-your-openai-key-here';

      expect((await services()).openai).toBe('missing');
    });

    test('status layanan tidak dibocorkan di production', async () => {
      process.env.NODE_ENV = 'production';

      expect(await services()).toBeUndefined();
    });
  });
});

describe('GET /api/v1/media/status', () => {
  test('mendaftar endpoint media yang sudah dan belum tersedia', async () => {
    const response = await request(app).get('/api/v1/media/status');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.availableEndpoints).toEqual(
      expect.arrayContaining(['POST /api/v1/media/text-to-image'])
    );
    expect(response.body.comingSoonEndpoints).toEqual(
      expect.arrayContaining(['POST /api/v1/media/text-to-video'])
    );
  });
});

describe('route yang dilindungi auth', () => {
  test.each([
    ['get', '/api/v1/member/profile'],
    ['get', '/api/v1/member/quota'],
    ['get', '/api/v1/member/referral-stats'],
    ['get', '/api/v1/admin/pending-members'],
    ['post', '/api/v1/media/text-to-image'],
    ['get', '/api/v1/media/history'],
    ['delete', '/api/v1/media/media_abc']
  ])('%s %s tanpa token ditolak 401', async (method, url) => {
    const response = await request(app)[method](url);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});

describe('penyajian file media', () => {
  test('GET /uploads/:file menyajikan file hasil generate', async () => {
    const fileName = 'media_smoke_test.png';
    fs.writeFileSync(path.join(tempUploadDir, fileName), 'fake-image');

    const response = await request(app).get(`/uploads/${fileName}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/image\/png/);
  });

  test('file yang tidak ada mengembalikan 404', async () => {
    const response = await request(app).get('/uploads/tidak-ada.png');

    expect(response.status).toBe(404);
  });
});
