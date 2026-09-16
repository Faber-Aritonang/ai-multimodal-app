/**
 * Test: config/cors
 *
 * Mengunci perilaku daftar origin CORS. Kasus nyata yang pernah menggagalkan
 * produksi: `FRONTEND_URL` hanya berisi satu domain, sementara frontend
 * diakses lewat domain lain, sehingga setiap permintaan API diblokir browser
 * dengan pesan CORS — server sendiri membalas 204 dan terlihat "normal".
 */

const { getAllowedOrigins, DEFAULT_ORIGIN } = require('../config/cors');

describe('getAllowedOrigins', () => {
  test('satu origin dikembalikan sebagai daftar berisi satu nilai', () => {
    expect(getAllowedOrigins('https://example.com')).toEqual(['https://example.com']);
  });

  test('beberapa origin dipisah koma, spasi di sekitarnya dibuang', () => {
    expect(
      getAllowedOrigins('https://a.example.com , https://b.example.com')
    ).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  test('duplikat dibuang tapi urutan asli dipertahankan', () => {
    expect(
      getAllowedOrigins('https://b.example.com,https://a.example.com,https://b.example.com')
    ).toEqual(['https://b.example.com', 'https://a.example.com']);
  });

  test('koma berlebih atau hanya spasi tidak menghasilkan origin kosong', () => {
    expect(getAllowedOrigins('https://a.example.com, ,')).toEqual(['https://a.example.com']);
  });

  test('nilai kosong kembali ke origin pengembangan lokal', () => {
    expect(getAllowedOrigins('')).toEqual([DEFAULT_ORIGIN]);
    expect(getAllowedOrigins('   ')).toEqual([DEFAULT_ORIGIN]);
    expect(getAllowedOrigins(undefined)).toEqual([DEFAULT_ORIGIN]);
  });

  test('membaca process.env.FRONTEND_URL bila argumen tidak diberikan', () => {
    const previous = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://a.example.com,https://b.example.com';

    expect(getAllowedOrigins()).toEqual(['https://a.example.com', 'https://b.example.com']);

    if (previous === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previous;
  });
});
