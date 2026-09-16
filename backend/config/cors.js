/**
 * Daftar origin yang diizinkan untuk CORS.
 *
 * Produksi kerap punya lebih dari satu domain aktif sekaligus: domain utama
 * (mis. `ai-multimodal-app.vercel.app`) plus alias lama yang masih dibuka
 * pengguna. `cors` bisa menerima daftar origin, sedangkan variabel lingkungan
 * hanya berisi satu string — karena itu beberapa origin dipisahkan koma.
 *
 * Nilai kosong dikembalikan ke origin pengembangan lokal supaya `npm start`
 * tanpa `.env` tetap bisa dipakai.
 */

const DEFAULT_ORIGIN = 'http://localhost:5173';

const getAllowedOrigins = (raw = process.env.FRONTEND_URL) => {
  const origins = String(raw || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  // Duplikat dibuang tapi urutan dipertahankan: urutan inilah yang dipakai
  // `cors` saat mencocokkan header Origin dari browser.
  const unique = [...new Set(origins)];

  return unique.length > 0 ? unique : [DEFAULT_ORIGIN];
};

module.exports = { getAllowedOrigins, DEFAULT_ORIGIN };
