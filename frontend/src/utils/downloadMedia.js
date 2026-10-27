import { resolveMediaUrl } from '../config/api'

/**
 * Nama berkas untuk dialog "Simpan sebagai".
 *
 * URL media biasanya sudah berakhir dengan nama yang benar (mis.
 * `media_1793066160554_uvf8lu.png`), jadi nama itu yang dipakai. Kalau URL-nya
 * tidak punya nama (mis. berakhir dengan `/`), pakai cadangan dari pemanggil.
 */
const namaBerkas = (url, cadangan) => {
  try {
    const { pathname } = new URL(url)
    const nama = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '')

    return nama || cadangan
  } catch {
    return cadangan
  }
}

// Jeda minimum antar laporan kemajuan. Stream video datang dalam potongan
// puluhan per detik; tanpa penundaan ini setiap potongan memicu render ulang
// React dan unduhannya sendiri jadi tersendat.
const JEDA_LAPOR_MS = 120

/**
 * Baca isi respons sambil melaporkan kemajuannya, lalu gabungkan menjadi Blob.
 *
 * `total` bisa 0 kalau server tidak mengirim `Content-Length` (mis. respons
 * chunked). Dalam keadaan itu kemajuannya tetap dilaporkan dalam byte, tetapi
 * persentasenya `null` — lebih baik "sudah 12 MB" daripada persentase yang
 * dikarang dari angka yang tidak diketahui.
 */
const bacaDenganProgress = async (respons, total, lapor, signal) => {
  const tipe = respons.headers.get('content-type') || ''

  if (!respons.body || typeof respons.body.getReader !== 'function') {
    const blob = await respons.blob()
    lapor({ loaded: blob.size, total: total || blob.size, percent: 100 })

    return blob
  }

  const pembaca = respons.body.getReader()
  const potongan = []
  let termuat = 0
  let terakhirLapor = 0

  for (;;) {
    if (signal?.aborted) {
      await pembaca.cancel()
      throw new DOMException('Unduhan dibatalkan', 'AbortError')
    }

    const { done, value } = await pembaca.read()
    if (done) break

    potongan.push(value)
    termuat += value.length

    const sekarang = Date.now()
    if (sekarang - terakhirLapor >= JEDA_LAPOR_MS) {
      terakhirLapor = sekarang
      lapor({
        loaded: termuat,
        total,
        // Ditahan di 99% sampai berkasnya benar-benar utuh: persentase yang
        // menyentuh 100 sebelum penyimpanan dimulai membuat user mengira
        // unduhan sudah selesai padahal masih menulis ke disk.
        percent: total ? Math.min(99, Math.round((termuat / total) * 100)) : null
      })
    }
  }

  const blob = new Blob(potongan, { type: tipe })
  lapor({ loaded: blob.size, total: total || blob.size, percent: 100 })

  return blob
}

/**
 * Unduh satu berkas media, termasuk yang disajikan dari origin lain.
 *
 * Kenapa tidak cukup `<a href="..." download>`: atribut `download` DIABAIKAN
 * browser bila URL-nya beda origin (frontend di Vercel, media di backend
 * Render/Cloudinary). Tanpa `target`, browser membuka gambarnya di tab yang
 * sama — meninggalkan aplikasi; dengan `target="_blank"`, hasilnya tab baru
 * berisi gambar, bukan berkas yang tersimpan. Itu yang terjadi pada tombol
 * "Download gambar".
 *
 * Solusinya: ambil isinya dulu sebagai blob. Blob URL selalu same-origin,
 * sehingga `download` benar-benar dipakai dan berkasnya tersimpan.
 *
 * Berkas besar (video 1-5 menit) dibaca sebagai stream supaya kemajuannya bisa
 * dilaporkan; `onProgress` dipanggil beberapa kali per detik dengan
 * `{ loaded, total, percent }`. `percent` bernilai `null` selama `total` belum
 * diketahui.
 *
 * @param {string} url URL media (relatif `/uploads/...` atau absolut)
 * @param {string} [namaCadangan] nama berkas bila tidak bisa dibaca dari URL
 * @param {object} [opsi]
 * @param {(info: {loaded: number, total: number, percent: number|null}) => void} [opsi.onProgress]
 * @param {AbortSignal} [opsi.signal] untuk membatalkan saat halaman ditinggalkan
 * @param {boolean} [opsi.fallbackToTab] buka URL di tab baru bila pengambilan
 *   gagal (default `true`). Pemanggil yang punya pesan + tombol "Coba lagi"
 *   sendiri sebaiknya mematikannya supaya kegagalan tidak membuka tab ganda.
 * @returns {Promise<boolean>} `true` bila unduhan dimulai
 */
export const downloadMedia = async (url, namaCadangan = 'media', opsi = {}) => {
  if (!url) return false

  const { onProgress, signal, fallbackToTab = true } = opsi
  const absolut = resolveMediaUrl(url)
  const lapor = (info) => {
    if (typeof onProgress !== 'function') return

    try {
      onProgress(info)
    } catch {
      // Pelaporan kemajuan tidak boleh menggagalkan unduhan yang sudah berjalan.
    }
  }

  try {
    const respons = await fetch(absolut, { signal })

    if (!respons.ok) {
      throw new Error(`HTTP ${respons.status}`)
    }

    const total = Number(respons.headers.get('content-length')) || 0
    const blob = await bacaDenganProgress(respons, total, lapor, signal)
    const objectUrl = URL.createObjectURL(blob)
    const tautan = document.createElement('a')

    tautan.href = objectUrl
    tautan.download = namaBerkas(absolut, namaCadangan)
    tautan.style.display = 'none'

    document.body.appendChild(tautan)
    tautan.click()
    tautan.remove()

    // Blob URL harus tetap hidup sampai browser sempat memulai unduhannya;
    // mencabutnya langsung bisa membuat unduhan gagal di sebagian browser.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)

    return true
  } catch {
    // Dibatalkan bukan kegagalan: jangan buka tab apa pun.
    if (!signal?.aborted && fallbackToTab) {
      // Fetch ditolak (CORS bucket penyimpanan, gangguan jaringan, atau berkas
      // sudah hilang). Membuka URL-nya di tab baru lebih berguna daripada tombol
      // yang diam saja: user masih bisa menyimpannya lewat menu browser.
      window.open(absolut, '_blank', 'noopener,noreferrer')
    }

    return false
  }
}

export default downloadMedia
