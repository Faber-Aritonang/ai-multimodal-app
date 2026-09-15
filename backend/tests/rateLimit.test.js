/**
 * Test: rate limiter global (lihat server.js).
 *
 * Batasnya diturunkan lewat env SEBELUM server di-require supaya test tidak
 * perlu mengirim 1000 request. Yang dikunci di sini adalah bentuk responsnya:
 * 429 harus JSON berisi `message` yang bisa dibaca frontend, bukan teks polos
 * yang berakhir di UI sebagai "Request failed with status code 429".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratelimit-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;
process.env.RATE_LIMIT_MAX = '3';
process.env.RATE_LIMIT_WINDOW_MS = '600000';

const request = require('supertest');
const { app } = require('../server');

afterAll(() => {
  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

describe('rate limit global', () => {
  test('request di bawah batas tetap dilayani', async () => {
    const response = await request(app).get('/api/v1/media/status');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('melewati batas -> 429 dengan JSON yang bisa ditampilkan frontend', async () => {
    // Sisa kuota dihabiskan (limit = 3, satu sudah terpakai di test sebelumnya).
    await request(app).get('/api/v1/media/status');
    await request(app).get('/api/v1/media/status');

    const blocked = await request(app).get('/api/v1/media/status');

    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    // Pesannya harus menjelaskan sebabnya, bukan sekadar kode status.
    expect(blocked.body.message).toMatch(/Too many requests/);
    expect(blocked.body.message).toMatch(/try again in \d+ seconds/);
    expect(blocked.body.retryAfter).toBeGreaterThan(0);
    // Header standar dipakai supaya klien/proxy tahu harus menunggu berapa lama.
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  test('request API berikutnya tetap diblokir (bukan hanya sekali)', async () => {
    const blocked = await request(app).get('/api/v1/media/status');

    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/Too many requests/);
  });

  test('/health tidak dihitung dan tidak pernah diblokir', async () => {
    for (let i = 0; i < 5; i += 1) {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
    }
  });

  test('file statis /uploads tidak dihitung', async () => {
    const fileName = 'ratelimit_check.png';
    fs.writeFileSync(path.join(tempUploadDir, fileName), 'fake-image');

    const response = await request(app).get(`/uploads/${fileName}`);

    expect(response.status).toBe(200);
  });
});
