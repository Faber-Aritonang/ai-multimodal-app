/**
 * Pembuat id request sisi browser.
 *
 * Dipakai axios (lihat config/api.js) untuk mengirim header `X-Request-Id` pada
 * SETIAP permintaan. Backend memakai nilai itu apa adanya sebagai id request-nya
 * (lihat backend/middleware/requestContext.js), sehingga satu pencarian id di
 * log server langsung menemukan baris request yang dimaksud.
 *
 * Kenapa tidak mengandalkan id dari backend saja: laporan dari user biasanya
 * berbunyi "waktu klik tombol, gagal" — tanpa id itu yang bisa dicocokkan hanya
 * perkiraan waktu. Dengan id yang dibuat browser, id tersebut sudah terlihat di
 * DevTools saat kejadian, dan permintaan yang gagal sebelum sampai ke server
 * (timeout, jaringan) tetap punya id yang bisa dilaporkan.
 */

export const buatRequestId = () => {
  // randomUUID hanya ada di secure context (https / localhost) — dua-duanya
  // tempat aplikasi ini berjalan, tetapi fallback tetap disediakan supaya id
  // tidak pernah kosong (mis. saat dibuka lewat IP lokal dalam mode http).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export default buatRequestId
