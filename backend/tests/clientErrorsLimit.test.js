/**
 * Test: batas per IP untuk POST /api/v1/client-errors.
 *
 * Dipisah dari clientErrors.test.js karena limiter-nya menyimpan hitungan di
 * memori modul: berkas test lain yang mengirim beberapa laporan dulu akan
 * menghabiskan kuotanya, sehingga hasilnya bergantung urutan test. Satu berkas
 * = satu registry modul, jadi batas kecil di sini berlaku bersih.
 *
 * Yang dibuktikan: endpoint publik tanpa auth ini tidak bisa dipakai membanjiri
 * log (repo ini publik dan log berbayar per volume), tetapi laporan yang wajar
 * dari satu tab yang bermasalah tetap diterima.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clienterrorslimit-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;
process.env.CLIENT_ERROR_LIMIT_MAX = '2';
process.env.CLIENT_ERROR_WINDOW_MS = '60000';
process.env.LOG_LEVEL = 'error'; // senyapkan log akses selama test ini berjalan

const request = require('supertest');
const { app } = require('../server');
const { getRecentErrors, clearErrors } = require('../config/errorLog');

afterAll(() => {
  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

describe('batas laporan galat per IP', () => {
  test('laporan beruntun dibatasi 429 dengan JSON yang bisa ditampilkan frontend', async () => {
    clearErrors();

    await request(app).post('/api/v1/client-errors').send({ message: 'satu' });
    await request(app).post('/api/v1/client-errors').send({ message: 'dua' });

    const diblokir = await request(app).post('/api/v1/client-errors').send({ message: 'tiga' });

    expect(diblokir.status).toBe(429);
    expect(diblokir.body.success).toBe(false);
    expect(diblokir.body.message).toMatch(/Too many error reports/);
    // Yang lolos tetap tercatat; yang ditolak tidak masuk daftar.
    expect(getRecentErrors().map((item) => item.message)).toEqual(['dua', 'satu']);
  });
});
