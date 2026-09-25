/**
 * Id perangkat untuk jejak pendaftaran.
 *
 * Disimpan di localStorage dan bertahan selama data situs tidak dihapus, jadi
 * pendaftaran kedua dari browser MELIHAT perangkat yang sama lewat id ini.
 * Backend menyimpannya di registrationMeta dan menandai pendaftar yang
 * device/IP-nya sudah dipakai akun lain (lihat backend/controllers/
 * authController.js) — penanda untuk review admin, bukan blokir.
 *
 * Sifatnya sinyal terbaik-effort, bukan keamanan: user yang menghapus data
 * situs akan mendapat id baru, dan itu tidak bisa dicegah dari sisi browser.
 * Karena itu id ini tidak pernah dipakai untuk menolak pendaftaran sendiri.
 */

const STORAGE_KEY = 'deviceId'

const buatIdBaru = () => {
  // randomUUID hanya ada di secure context (https / localhost) — dua-duanya
  // tempat aplikasi ini berjalan; fallback disimpan supaya id tetap ada
  // saat dibuka lewat IP lokal dalam mode http.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * @returns {string} id stabil per browser; kosong bila localStorage tidak
 *   tersedia (mode privat ketat) — backend menoleransi nilai kosong.
 */
export const getDeviceId = () => {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY)
    if (existing) return existing

    const fresh = buatIdBaru()
    window.localStorage.setItem(STORAGE_KEY, fresh)
    return fresh
  } catch (error) {
    // localStorage diblokir (privasi/konfigurasi browser): tanpa id, jejak
    // device hanya mengandalkan IP.
    console.warn('deviceId tidak tersedia:', error)
    return ''
  }
}

export default getDeviceId
