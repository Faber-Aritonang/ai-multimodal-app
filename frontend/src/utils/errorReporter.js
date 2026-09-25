/**
 * Pelapor galat frontend.
 *
 * Sebelum ini galat di browser hanya berakhir di console DevTools milik user
 * yang mengalaminya. Artinya satu-satunya cara mengetahuinya adalah user
 * melapor, dan laporannya hampir selalu tanpa konteks: halaman mana, galat apa,
 * permintaan mana. Fungsi di sini mengirimkannya ke backend
 * (POST /api/v1/client-errors), tempat ia masuk ke log terstruktur dan ke daftar
 * galat yang bisa dilihat admin — sama seperti galat server.
 *
 * Tiga batas yang sengaja dipasang, karena pengirimnya adalah browser dan
 * penerimanya endpoint publik:
 *
 *   1. Maksimal `MAKS_LAPORAN_PER_SESI` laporan per muat halaman. Satu galat
 *      render bisa terjadi puluhan kali per detik (mis. di dalam loop animasi);
 *      tanpa batas ini aplikasi sibuk melaporkan dirinya sendiri.
 *   2. Galat yang sama hanya dikirim sekali per sesi (dikunci dari jenis +
 *      pesannya).
 *   3. Pelaporan TIDAK PERNAH melempar dan tidak pernah melaporkan kegagalan
 *      pelaporannya sendiri — kalau melempar, ia mengubah galat kecil menjadi
 *      galat baru, dan kalau melaporkan dirinya sendiri ia berputar tanpa henti.
 *
 * Nilai yang dikirim sengaja terbatas: pesan, stack, halaman, dan id request.
 * Isi form, token, dan data user tidak pernah ikut.
 */

import api from '../config/api'

const MAKS_LAPORAN_PER_SESI = 20
const MAX_MESSAGE = 500
const MAX_STACK = 2000

let jumlahTerkirim = 0
const sudahDilaporkan = new Set()

/** Pesan yang bisa dibaca manusia dari apa pun yang dilempar JavaScript. */
const ambilPesan = (error) => {
  if (!error) return ''
  if (typeof error === 'string') return error.slice(0, MAX_MESSAGE)
  if (typeof error.message === 'string' && error.message) return error.message.slice(0, MAX_MESSAGE)
  // `throw { status: 500 }` atau promise yang ditolak dengan objek.
  try {
    return JSON.stringify(error).slice(0, MAX_MESSAGE)
  } catch {
    return String(error).slice(0, MAX_MESSAGE)
  }
}

const ambilStack = (error) => {
  if (!error || typeof error.stack !== 'string') return undefined
  return error.stack.slice(0, MAX_STACK)
}

/**
 * Kirim satu galat ke backend.
 *
 * @param {unknown} error apa pun yang dilempar (Error, string, objek)
 * @param {object} [konteks]
 * @param {'error'|'unhandledrejection'|'boundary'|'api'} [konteks.kind] asal galatnya
 * @param {string} [konteks.componentStack] stack komponen React (dari error boundary)
 * @param {string} [konteks.requestId] id request backend yang gagal, bila ada
 */
export const reportError = (error, konteks = {}) => {
  try {
    const message = ambilPesan(error)
    if (!message) return

    const kind = konteks.kind || 'error'
    const kunci = `${kind}|${message}`

    if (sudahDilaporkan.has(kunci) || jumlahTerkirim >= MAKS_LAPORAN_PER_SESI) return

    sudahDilaporkan.add(kunci)
    jumlahTerkirim += 1

    // Tetap dicetak ke console: saat mengembangkan, DevTools jauh lebih cepat
    // daripada membuka daftar galat di panel admin, dan pesan aslinya (beserta
    // objeknya) hanya utuh di sana.
    console.error(`[error-report:${kind}]`, message, error)

    api
      .post('/client-errors', {
        message,
        kind,
        stack: ambilStack(error),
        componentStack: konteks.componentStack,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        // Diisi axios di config/api.js dari header request yang gagal; inilah
        // yang menyambungkan laporan ini ke baris log di server.
        requestId: konteks.requestId
      })
      // Kegagalan mengirim laporan sengaja diabaikan sepenuhnya: kalau ia
      // dilaporkan lagi, satu kegagalan jaringan berubah menjadi loop.
      .catch(() => {})
  } catch {
    // Lihat catatan di atas modul: pelapor tidak boleh menjadi sumber galat baru.
  }
}

/**
 * Pasang penangkap galat global.
 *
 * Dipanggil sekali dari main.jsx. Dua kejadian yang ditangkap adalah yang paling
 * sering luput dari mata developer: galat di luar React (mis. di event handler
 * yang tidak dibungkus) dan promise yang ditolak tanpa `catch`.
 */
export const pasangPelaporGalatGlobal = () => {
  if (typeof window === 'undefined' || window.__pelaporGalatTerpasang) return

  window.__pelaporGalatTerpasang = true

  window.addEventListener('error', (event) => reportError(event.error || event.message, { kind: 'error' }))

  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { kind: 'unhandledrejection' })
  })
}

/** Diekspos untuk test/utilitas: mengosongkan penghitung sesi. */
export const resetPelapor = () => {
  jumlahTerkirim = 0
  sudahDilaporkan.clear()
}
