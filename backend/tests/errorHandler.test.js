/**
 * Test: penangan galat terpusat (middleware/errorHandler.js).
 *
 * Handler ini adalah tempat terakhir sebelum kesalahan berubah menjadi respons
 * mentah, jadi dua janji di sini yang paling penting:
 *   1. pesan INTERNAL tidak dikirim ke klien di production (pesan MongoDB dan
 *      pesan provider pernah muncul di respons), tetapi di luar production
 *      pesannya tetap ada supaya bisa didiagnosis;
 *   2. galatnya tetap tercatat (log + daftar galat admin) dengan requestId, jadi
 *      laporan user bisa ditelusuri.
 */

const { errorHandler, normalisasiStatus, pesanBawaan } = require('../middleware/errorHandler');
const { getRecentErrors, clearErrors } = require('../config/errorLog');

const envAsli = process.env.NODE_ENV;

const buatReq = (tambahan = {}) => ({
  method: 'POST',
  originalUrl: '/api/v1/media/text-to-image?debug=1',
  id: 'req-uji-1',
  headers: {},
  log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
  ...tambahan
});

const buatRes = () => ({
  headersSent: false,
  statusCode: 200,
  body: null,
  status(kode) {
    this.statusCode = kode;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  }
});

beforeEach(() => {
  clearErrors();
});

afterEach(() => {
  if (envAsli === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = envAsli;
});

describe('normalisasiStatus', () => {
  test('memakai status galat yang sah', () => {
    expect(normalisasiStatus(413)).toBe(413);
    expect(normalisasiStatus(418)).toBe(418);
  });

  test.each([
    ['kosong', undefined],
    ['bukan angka', 'server-error'],
    ['di bawah 400', 200],
    ['di atas 599', 700]
  ])('status %s dinormalkan menjadi 500', (_nama, nilai) => {
    // Status aneh yang lolos apa adanya akan membuat Express melempar galat baru
    // dari dalam handler galat — dan pesan aslinya hilang.
    expect(normalisasiStatus(nilai)).toBe(500);
  });
});

describe('pesanBawaan', () => {
  test('menerjemahkan body yang terlalu besar', () => {
    expect(pesanBawaan({ type: 'entity.too.large' })).toMatch(/too large/i);
  });

  test('menerjemahkan JSON yang rusak', () => {
    expect(pesanBawaan({ type: 'entity.parse.failed' })).toBe('Invalid JSON body.');
  });

  test('galat lain tidak punya padanan khusus', () => {
    expect(pesanBawaan({ type: 'entity.verify.failed' })).toBeNull();
    expect(pesanBawaan(null)).toBeNull();
  });
});

describe('respons galat 5xx', () => {
  test('di production hanya pesan umum, tanpa pesan internal', () => {
    process.env.NODE_ENV = 'production';

    const req = buatReq();
    const res = buatRes();
    errorHandler(new Error('MongooseError: connection to 10.0.0.5 refused'), req, res, jest.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Internal Server Error');
    // Pesan mentahnya TIDAK boleh ikut, dalam bentuk apa pun.
    expect(JSON.stringify(res.body)).not.toContain('MongooseError');
    expect(res.body.error).toBeUndefined();
    // requestId justru wajib, itulah yang dikutip user saat melapor.
    expect(res.body.requestId).toBe('req-uji-1');
  });

  test('di luar production pesan aslinya ikut supaya bisa didiagnosis', () => {
    process.env.NODE_ENV = 'test';

    const res = buatRes();
    errorHandler(new Error('detail internal'), buatReq(), res, jest.fn());

    expect(res.body.message).toBe('detail internal');
    expect(res.body.error).toBe('detail internal');
  });

  test('galatnya tercatat di daftar galat admin beserta konteksnya', () => {
    process.env.NODE_ENV = 'production';
    const req = buatReq({ user: { uid: 'user-1' } });

    errorHandler(new Error('gagal simpan'), req, buatRes(), jest.fn());

    const catatan = getRecentErrors();

    expect(catatan).toHaveLength(1);
    expect(catatan[0]).toMatchObject({
      source: 'server',
      message: 'gagal simpan',
      status: 500,
      method: 'POST',
      path: '/api/v1/media/text-to-image',
      requestId: 'req-uji-1',
      uid: 'user-1'
    });
  });

  test('dicatat sebagai error di log, bukan warn', () => {
    const req = buatReq();
    errorHandler(new Error('gagal'), req, buatRes(), jest.fn());

    expect(req.log.error).toHaveBeenCalledWith('request_failed', expect.any(Object));
    expect(req.log.warn).not.toHaveBeenCalled();
  });
});

describe('respons galat 4xx', () => {
  test('body terlalu besar dijawab 413 dengan pesan yang bisa ditindaklanjuti', () => {
    const req = buatReq();
    const galat = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large'
    });

    const res = buatRes();
    errorHandler(galat, req, res, jest.fn());

    expect(res.statusCode).toBe(413);
    expect(res.body.message).toMatch(/too large/i);
    // 4xx bukan kegagalan server: dicatat sebagai warn supaya tidak membangunkan
    // alarm, tetapi tetap terlihat.
    expect(req.log.warn).toHaveBeenCalledWith('request_failed', expect.any(Object));
  });

  test('status dari galat dipakai apa adanya, termasuk saat di production', () => {
    process.env.NODE_ENV = 'production';

    const res = buatRes();
    errorHandler(
      Object.assign(new Error('payload invalid'), { status: 422 }),
      buatReq(),
      res,
      jest.fn()
    );

    expect(res.statusCode).toBe(422);
    // Pesan 4xx menjelaskan kesalahan PEMANGGIL, jadi tidak perlu disamarkan;
    // yang disamarkan hanyalah pesan internal 5xx.
    expect(res.body.message).toBe('payload invalid');
  });
});

describe('respons yang sudah terkirim', () => {
  test('diserahkan ke penangan bawaan Express', () => {
    const next = jest.fn();
    const res = buatRes();
    res.headersSent = true;
    const galat = new Error('gagal saat streaming');

    errorHandler(galat, buatReq(), res, next);

    expect(next).toHaveBeenCalledWith(galat);
    // Tidak boleh menulis respons kedua: itu melempar ERR_HTTP_HEADERS_SENT dan
    // menyembunyikan galat aslinya.
    expect(res.body).toBeNull();
  });
});
