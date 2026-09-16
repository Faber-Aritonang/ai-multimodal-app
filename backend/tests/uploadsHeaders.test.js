/**
 * Test: penyajian berkas /uploads
 *
 * Bug nyata di produksi: gambar hasil generate tampil rusak di frontend padahal
 * permintaannya 200 dan file-nya ada. Penyebabnya `helmet()` yang menyetel
 * `Cross-Origin-Resource-Policy: same-origin` untuk semua respons — sementara
 * halaman dimuat dari domain Vercel dan gambarnya dari domain backend, sehingga
 * browser menolak memakainya sebagai subresource
 * (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin).
 *
 * Di lokal hal ini tidak pernah terlihat karena Vite mem-proxy /uploads, jadi
 * halaman dan gambar berada di satu origin. Karena itu header-nya dikunci di
 * sini: perilakunya sama sekali tidak bergantung pada proxy.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const { app } = require('../server');

const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
const FILE_NAME = 'corp-check.png';
// PNG 1x1 transparan — cukup untuk memastikan express.static melayaninya.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

describe('penyajian berkas /uploads', () => {
  beforeAll(() => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, FILE_NAME), PNG_1X1);
  });

  afterAll(() => {
    fs.rmSync(path.join(UPLOAD_DIR, FILE_NAME), { force: true });
  });

  test('gambar boleh dimuat dari origin frontend, bukan hanya same-origin', async () => {
    const res = await request(app).get(`/uploads/${FILE_NAME}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  test('header keamanan lain dari helmet tetap berlaku', async () => {
    const res = await request(app).get(`/uploads/${FILE_NAME}`);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
