/**
 * Test: POST /api/v1/client-errors (routes/clientErrors.js).
 *
 * Endpoint ini publik, jadi perilakunya harus jelas batasnya:
 *   - laporan yang wajar diterima dan tercatat sebagai galat dasar 'client';
 *   - laporan tanpa pesan ditolak (kalau tidak, daftar galat admin bisa diisi
 *     baris kosong yang tidak menjelaskan apa pun);
 *   - nilai yang panjang dipotong, dan pengirimnya dibatasi per IP supaya
 *     endpoint ini tidak bisa dipakai membanjiri log.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clienterrors-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;
// Batasnya dinaikkan supaya test di berkas ini menguji isi laporannya, bukan
// batasnya. Batas per IP diuji terpisah di clientErrorsLimit.test.js — satu
// berkas = satu registry modul, jadi limiter di sini tidak saling mempengaruhi.
process.env.CLIENT_ERROR_LIMIT_MAX = '100';
process.env.CLIENT_ERROR_WINDOW_MS = '60000';
process.env.LOG_LEVEL = 'error'; // senyapkan log akses selama test ini berjalan

const request = require('supertest');
const { app } = require('../server');
const { getRecentErrors, clearErrors } = require('../config/errorLog');

afterAll(() => {
  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearErrors();
});

describe('laporan yang sah', () => {
  test('diterima dengan 202 dan tercatat sebagai galat dari klien', async () => {
    const response = await request(app).post('/api/v1/client-errors').send({
      message: 'Cannot read properties of undefined',
      kind: 'boundary',
      url: 'https://aplikasi.example/history',
      requestId: 'ui-1',
      stack: 'Error: boom\n    at HistoryPage'
    });

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);

    const catatan = getRecentErrors();

    expect(catatan).toHaveLength(1);
    expect(catatan[0]).toMatchObject({
      source: 'client',
      message: 'Cannot read properties of undefined',
      kind: 'boundary',
      path: 'https://aplikasi.example/history',
      requestId: 'ui-1'
    });
    expect(catatan[0].stack).toContain('at HistoryPage');
  });

  test('stack komponen React digabung dengan stack biasa, tetap terbaca asalnya', async () => {
    await request(app).post('/api/v1/client-errors').send({
      message: 'gagal render',
      stack: 'stack-biasa',
      componentStack: 'component-stack'
    });

    const [catatan] = getRecentErrors();

    expect(catatan.stack).toContain('stack-biasa');
    expect(catatan.stack).toContain('component stack');
    expect(catatan.stack).toContain('component-stack');
  });

  test('kolom yang tidak dikirim tetap aman (tidak ada undefined yang menggantung)', async () => {
    const response = await request(app).post('/api/v1/client-errors').send({ message: 'minimal' });

    expect(response.status).toBe(202);

    const [catatan] = getRecentErrors();

    expect(catatan.message).toBe('minimal');
    expect(catatan.path).toBeUndefined();
    expect(catatan.stack).toBeUndefined();
  });

  test('nilai yang panjang dipotong sebelum disimpan', async () => {
    await request(app).post('/api/v1/client-errors').send({
      message: 'x'.repeat(2000),
      stack: 'y'.repeat(5000),
      url: 'z'.repeat(1000)
    });

    const [catatan] = getRecentErrors();

    expect(catatan.message.length).toBeLessThan(600);
    expect(catatan.stack.length).toBeLessThan(2100);
    expect(catatan.path.length).toBeLessThan(400);
  });
});

describe('laporan yang ditolak', () => {
  test('tanpa pesan dijawab 400', async () => {
    const response = await request(app).post('/api/v1/client-errors').send({ kind: 'error' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(getRecentErrors()).toEqual([]);
  });


  test('pesan yang hanya berisi spasi juga ditolak', async () => {
    const response = await request(app).post('/api/v1/client-errors').send({ message: '   ' });

    expect(response.status).toBe(400);
  });

  test('pesan yang bukan string ditolak', async () => {
    const response = await request(app).post('/api/v1/client-errors').send({ message: { a: 1 } });

    expect(response.status).toBe(400);
  });
});
