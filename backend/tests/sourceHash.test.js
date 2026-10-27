/**
 * Test: sidik isi kode backend (`config/sourceHash`).
 *
 * Nilai ini adalah pembanding job deploy, jadi yang dikunci di sini adalah sifat
 * yang membuatnya berguna sebagai bukti:
 *   1. DETERMINISTIK — dua hitungan atas isi yang sama menghasilkan nilai sama,
 *      kalau tidak, job deploy akan merah walau kodenya identik;
 *   2. PEKA PERUBAHAN — satu byte berbeda, nama berkas berbeda, atau berkas
 *      tambahan harus mengubah nilainya;
 *   3. TIDAK TERGANGGLU LINGKUNGAN — `node_modules`, `uploads/`, `.env*`, dan
 *      berkas log wajar berbeda antara runner CI dan container produksi.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { hitungSourceHash, getSourceHash } = require('../config/sourceHash');

const POLA_SHA256 = /^[0-9a-f]{64}$/;

let akar;

const tulis = (relatif, isi) => {
  const jalur = path.join(akar, relatif);
  fs.mkdirSync(path.dirname(jalur), { recursive: true });
  fs.writeFileSync(jalur, isi);
};

beforeEach(() => {
  akar = fs.mkdtempSync(path.join(os.tmpdir(), 'source-hash-'));
  tulis('server.js', 'console.log("a")\n');
  tulis('config/quota.js', 'module.exports = {}\n');
});

afterEach(() => {
  fs.rmSync(akar, { recursive: true, force: true });
});

describe('hitungSourceHash', () => {
  test('deterministik untuk isi yang sama', () => {
    expect(hitungSourceHash(akar)).toBe(hitungSourceHash(akar));
  });

  test('berbentuk SHA-256', () => {
    expect(hitungSourceHash(akar)).toMatch(POLA_SHA256);
  });

  test('perubahan satu byte mengubah nilainya', () => {
    const sebelum = hitungSourceHash(akar);
    tulis('server.js', 'console.log("b")\n');

    expect(hitungSourceHash(akar)).not.toBe(sebelum);
  });

  test('berkas baru mengubah nilainya', () => {
    const sebelum = hitungSourceHash(akar);
    tulis('config/baru.js', 'module.exports = 1\n');

    expect(hitungSourceHash(akar)).not.toBe(sebelum);
  });

  test('nama berkas ikut dihitung, bukan hanya isinya', () => {
    const sebelum = hitungSourceHash(akar);
    fs.renameSync(path.join(akar, 'server.js'), path.join(akar, 'server-lama.js'));

    expect(hitungSourceHash(akar)).not.toBe(sebelum);
  });

  test.each([
    ['node_modules'],
    ['uploads'],
    ['coverage'],
    ['tmp']
  ])('isi %s/ tidak memengaruhi sidik', (dir) => {
    const sebelum = hitungSourceHash(akar);
    tulis(path.join(dir, 'apa-saja.bin'), 'berbeda di tiap lingkungan');

    expect(hitungSourceHash(akar)).toBe(sebelum);
  });

  test.each([
    ['.env'],
    ['.env.local'],
    ['.env.example'],
    ['npm-debug.log'],
    ['build-meta.json'],
    // Builder yang memakai `npm install` boleh menulis ulang berkas ini tanpa
    // mengubah satu baris kode; menghitungnya membuat job deploy merah tanpa
    // sebab yang bisa diperbaiki dari repo.
    ['package-lock.json']
  ])(
    '%s tidak memengaruhi sidik',
    (nama) => {
      const sebelum = hitungSourceHash(akar);
      tulis(nama, 'rahasia atau penanda yang tidak ada di CI');

      expect(hitungSourceHash(akar)).toBe(sebelum);
    }
  );
});

describe('getSourceHash', () => {
  test('menghitung isi backend repo ini dan mengembalikan SHA-256', () => {
    // Cache dihitung dari `backend/` yang sebenarnya: nilainya harus berbentuk
    // SHA-256, bukan null. Kalau direktori kodenya tidak terbaca, job deploy
    // akan buta — karena itu keadaan itu tidak boleh diam-diam lolos.
    expect(getSourceHash()).toMatch(POLA_SHA256);
  });

  test('nilainya stabil antar pemanggilan', () => {
    expect(getSourceHash()).toBe(getSourceHash());
  });
});
