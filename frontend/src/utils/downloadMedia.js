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
 * @param {string} url URL media (relatif `/uploads/...` atau absolut)
 * @param {string} [namaCadangan] nama berkas bila tidak bisa dibaca dari URL
 * @returns {Promise<boolean>} `true` bila unduhan dimulai
 */
export const downloadMedia = async (url, namaCadangan = 'media') => {
  if (!url) return false

  const absolut = resolveMediaUrl(url)

  try {
    const respons = await fetch(absolut)

    if (!respons.ok) {
      throw new Error(`HTTP ${respons.status}`)
    }

    const blob = await respons.blob()
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
    // Fetch ditolak (CORS bucket penyimpanan, gangguan jaringan, atau berkas
    // sudah hilang). Membuka URL-nya di tab baru lebih berguna daripada tombol
    // yang diam saja: user masih bisa menyimpannya lewat menu browser.
    window.open(absolut, '_blank', 'noopener,noreferrer')
    return false
  }
}

export default downloadMedia
