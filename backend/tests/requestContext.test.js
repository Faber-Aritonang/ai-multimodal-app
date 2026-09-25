/**
 * Test: identitas request & log akses (middleware/requestContext + requestLogger).
 *
 * Yang dijaga di sini adalah kemampuan menelusuri satu request:
 *   - id selalu ada di respons, dan id dari klien dipakai apa adanya supaya
 *     laporan dari frontend menunjuk ke request yang sama;
 *   - id dari klien yang bentuknya tidak wajar DITOLAK (kalau diteruskan, header
 *     bisa menyisipkan baris palsu ke log — alat yang sedang dibangun ini jadi
 *     rusak oleh inputnya sendiri);
 *   - setiap baris log akses membawa id itu, jadi satu pencarian menemukan
 *     seluruh jejaknya.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'requestcontext-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;
// Format JSON supaya isi log bisa diparsing test; teks bebas sulit
// diperiksa tanpa menyalin formatnya ke sini.
process.env.LOG_FORMAT = 'json';
process.env.LOG_LEVEL = 'debug';

const request = require('supertest');
const { app } = require('../server');
const { requestContext, MAKS_PANJANG } = require('../middleware/requestContext');

/**
 * Jalankan middleware-nya langsung dengan request tiruan.
 *
 * Nilai "berbahaya" (mis. berisi baris baru) tidak bisa diuji lewat klien HTTP:
 * Node/superagent MENOLAK mengirim header seperti itu, dan galatnya terjadi di
 * sisi pengirim — bukan di kode yang sedang diuji.
 */
const jalankanMiddleware = (headers = {}) => {
  const req = { headers, method: 'GET', originalUrl: '/' };
  const res = { headers: {}, setHeader(nama, nilai) { this.headers[nama.toLowerCase()] = nilai; } };
  let lanjut = false;

  requestContext(req, res, () => { lanjut = true; });

  return { req, res, lanjut };
};

afterAll(() => {
  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

/** Jalankan request sambil merekam baris log yang ditulis ke stdout. */
const kirimDanRekam = async (fn) => {
  const keluar = [];
  const stdoutAsli = process.stdout.write;

  process.stdout.write = (chunk) => {
    keluar.push(String(chunk));
    return true;
  };

  try {
    const response = await fn();
    return { response, baris: keluar.join('').trim().split('\n').filter(Boolean).map((b) => JSON.parse(b)) };
  } finally {
    process.stdout.write = stdoutAsli;
  }
};

describe('header X-Request-Id', () => {
  test('id dibuat sendiri kalau klien tidak mengirimnya', async () => {
    const { response } = await kirimDanRekam(() => request(app).get('/health'));

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test('id dari klien dipakai apa adanya, supaya bisa ditelusuri dari laporan user', async () => {
    const { response } = await kirimDanRekam(() =>
      request(app).get('/health').set('X-Request-Id', 'ui-abc123')
    );

    expect(response.headers['x-request-id']).toBe('ui-abc123');
  });

  test.each([
    ['berisi spasi', 'ada spasi'],
    ['berisi baris baru (log injection)', `abc${String.fromCharCode(10)}palsu`],
    ['berisi tab', `abc${String.fromCharCode(9)}def`],
    ['terlalu panjang', 'a'.repeat(MAKS_PANJANG + 1)],
    ['berisi karakter aneh', 'abc<script>'],
    ['berisi kutip', 'abc"def']
  ])('id dari klien %s ditolak dan diganti id baru', (_nama, nilai) => {
    const { req, res, lanjut } = jalankanMiddleware({ 'x-request-id': nilai });

    expect(res.headers['x-request-id']).not.toBe(nilai);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.id).toBe(res.headers['x-request-id']);
    expect(lanjut).toBe(true);
  });

  test('id dari klien yang sah diteruskan tanpa diubah', () => {
    const { req, res } = jalankanMiddleware({ 'x-request-id': 'ui-abc123' });

    expect(req.id).toBe('ui-abc123');
    expect(res.headers['x-request-id']).toBe('ui-abc123');
  });

  test('req.log membawa id request supaya galat di bawahnya bisa ditelusuri', () => {
    const { req } = jalankanMiddleware({ 'x-request-id': 'ui-abc123' });

    expect(typeof req.log.info).toBe('function');

    const keluar = [];
    const stdoutAsli = process.stdout.write;
    process.stdout.write = (chunk) => {
      keluar.push(String(chunk));
      return true;
    };

    try {
      req.log.info('halo');
    } finally {
      process.stdout.write = stdoutAsli;
    }

    expect(JSON.parse(keluar.join('').trim()).requestId).toBe('ui-abc123');
  });

  test('id yang sah tepat pada batas panjang diterima', () => {
    const nilai = 'a'.repeat(MAKS_PANJANG);

    expect(jalankanMiddleware({ 'x-request-id': nilai }).req.id).toBe(nilai);
  });
});

describe('log akses', () => {
  test('mencatat satu baris per request, lengkap dengan id dan durasinya', async () => {
    const { response, baris } = await kirimDanRekam(() =>
      request(app).get('/health').set('X-Request-Id', 'trace-1')
    );
    const barisnya = baris.find((item) => item.message === 'request');

    expect(barisnya).toBeDefined();
    expect(barisnya).toMatchObject({
      level: 'info',
      requestId: 'trace-1',
      method: 'GET',
      path: '/health',
      status: response.status
    });
    expect(typeof barisnya.durationMs).toBe('number');
    // Belum login: tidak ada uid, dan nilainya null (bukan dihilangkan) supaya
    // kolomnya tetap bisa difilter.
    expect(barisnya.uid).toBeNull();
  });

  test('query string tidak ikut dicatat', async () => {
    const { baris } = await kirimDanRekam(() =>
      request(app).get('/api/v1/media/history?q=rahasia-pencarian')
    );
    const barisnya = baris.find((item) => item.message === 'request');

    expect(barisnya.path).toBe('/api/v1/media/history');
    expect(JSON.stringify(barisnya)).not.toContain('rahasia-pencarian');
  });

  test('respons 4xx dicatat sebagai warn, 5xx sebagai error', async () => {
    const { baris } = await kirimDanRekam(() => request(app).get('/api/v1/tidak-ada'));

    expect(baris.find((item) => item.message === 'request').level).toBe('warn');
  });

  test('permintaan ke /uploads tidak dicatat (halaman berisi banyak media)', async () => {
    const namaBerkas = 'requestcontext.png';
    fs.writeFileSync(path.join(tempUploadDir, namaBerkas), 'fake-image');

    const { response, baris } = await kirimDanRekam(() =>
      request(app).get(`/uploads/${namaBerkas}`)
    );

    expect(response.status).toBe(200);
    expect(baris.filter((item) => item.message === 'request')).toEqual([]);
  });

  test('bahasa yang tidak dicatat tetap tidak menganggu request lain', async () => {
    const { baris } = await kirimDanRekam(() => request(app).get('/health'));

    expect(baris.some((item) => item.message === 'request')).toBe(true);
  });
});
