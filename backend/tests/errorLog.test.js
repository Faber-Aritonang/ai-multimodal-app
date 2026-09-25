/**
 * Test: penyimpan galat terakhir (config/errorLog.js).
 *
 * Dua hal yang dikunci:
 *   1. galat yang sama TIDAK menghabiskan tempat daftar (dihitung, bukan
 *      diulang) — ini yang membedakan daftar berguna dari banjir baris identik;
 *   2. isi daftarnya bisa dibaca admin tanpa membocorkan hal yang tidak perlu,
 *      dan batas jumlahnya benar-benar berlaku (proses tidak tumbuh tanpa batas).
 */

const {
  recordError,
  getRecentErrors,
  getErrorStats,
  clearErrors
} = require('../config/errorLog');

const ukuranAsli = process.env.ERROR_LOG_SIZE;

beforeEach(() => {
  delete process.env.ERROR_LOG_SIZE;
  clearErrors();
});

afterAll(() => {
  if (ukuranAsli === undefined) delete process.env.ERROR_LOG_SIZE;
  else process.env.ERROR_LOG_SIZE = ukuranAsli;
});

describe('recordError', () => {
  test('mencatat galat terbaru lebih dulu', () => {
    recordError({ source: 'server', message: 'pertama' });
    recordError({ source: 'server', message: 'kedua' });

    const daftar = getRecentErrors();

    expect(daftar.map((item) => item.message)).toEqual(['kedua', 'pertama']);
  });

  test('galat yang sama dihitung, bukan menambah baris', () => {
    recordError({ source: 'server', message: 'gagal', status: 502, path: '/api/v1/media/text-to-image' });
    recordError({ source: 'server', message: 'gagal', status: 502, path: '/api/v1/media/text-to-image' });
    recordError({ source: 'server', message: 'gagal', status: 502, path: '/api/v1/media/text-to-image' });

    const daftar = getRecentErrors();

    expect(daftar).toHaveLength(1);
    expect(daftar[0].count).toBe(3);
    // Total tetap melaporkan seluruh kejadian: itulah angka yang menunjukkan
    // apakah ada lonjakan setelah deploy.
    expect(getErrorStats().total).toBe(3);
    expect(getErrorStats().tracked).toBe(1);
  });

  test('galat berbeda dianggap baris berbeda walau pesannya sama', () => {
    recordError({ source: 'server', message: 'gagal', path: '/api/v1/media/history' });
    recordError({ source: 'server', message: 'gagal', path: '/api/v1/media/text-to-image' });

    expect(getRecentErrors()).toHaveLength(2);
  });

  test('laporan dari klien dipisahkan dari galat server', () => {
    recordError({ source: 'server', message: 'gagal', path: '/' });
    recordError({ source: 'client', message: 'gagal', path: '/' });

    const sumber = getRecentErrors().map((item) => item.source);

    expect(sumber).toContain('server');
    expect(sumber).toContain('client');
  });

  test('sumber yang tidak dikenal diperlakukan sebagai galat server', () => {
    recordError({ source: 'aneh', message: 'gagal' });

    expect(getRecentErrors()[0].source).toBe('server');
  });

  test('id request TERBARU dipakai saat galat yang sama diulang', () => {
    // Id terbaru adalah yang paling berguna saat mencari jejaknya di log.
    recordError({ source: 'server', message: 'gagal', requestId: 'lama' });
    recordError({ source: 'server', message: 'gagal', requestId: 'baru' });

    expect(getRecentErrors()[0].requestId).toBe('baru');
  });

  test('pesan tanpa isi tetap tercatat sebagai galat tak dikenal', () => {
    recordError({});

    expect(getRecentErrors()[0].message).toBe('Unknown error');
  });

  test('pesan yang sangat panjang dipotong', () => {
    recordError({ source: 'server', message: 'x'.repeat(5000) });

    expect(getRecentErrors()[0].message.length).toBeLessThan(600);
  });

  test('jumlah entri dibatasi ERROR_LOG_SIZE', () => {
    process.env.ERROR_LOG_SIZE = '3';

    for (let i = 0; i < 10; i += 1) {
      recordError({ source: 'server', message: `galat-${i}` });
    }

    expect(getRecentErrors()).toHaveLength(3);
    // Yang tersisa adalah yang terbaru; yang paling lama terdorong keluar.
    expect(getRecentErrors()[0].message).toBe('galat-9');
    expect(getErrorStats().capacity).toBe(3);
  });

  test('ERROR_LOG_SIZE yang tidak masuk akal diabaikan', () => {
    process.env.ERROR_LOG_SIZE = 'nol';

    expect(getErrorStats().capacity).toBe(50);
  });
});

describe('getRecentErrors', () => {
  test('mengembalikan salinan, sehingga pemanggil tidak bisa mengubah isinya', () => {
    recordError({ source: 'server', message: 'gagal' });

    const daftar = getRecentErrors();
    daftar[0].message = 'diubah dari luar';
    daftar.push({ message: 'disisipkan' });

    expect(getRecentErrors()).toHaveLength(1);
    expect(getRecentErrors()[0].message).toBe('gagal');
  });
});

describe('clearErrors', () => {
  test('mengosongkan daftar dan hitungannya', () => {
    recordError({ source: 'server', message: 'gagal' });
    clearErrors();

    expect(getRecentErrors()).toEqual([]);
    expect(getErrorStats().total).toBe(0);
  });
});
