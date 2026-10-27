import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadMedia } from '../utils/downloadMedia'

// Setelah berkas tersimpan, tombol dikembalikan ke keadaan semula. Pesan
// "Tersimpan" yang menetap akan terlihat seperti status, padahal itu kejadian
// sekali jalan.
const JEDA_SELESAI_MS = 3000

const AWAL = { status: 'idle', loaded: 0, total: 0, percent: null }

/**
 * Unduh berkas media dengan kemajuan dan kegagalan yang bisa diulang.
 *
 * Kenapa berupa hook, bukan sekadar memanggil `downloadMedia` di dalam onClick:
 * video berukuran puluhan MB butuh beberapa detik, dan selama itu tombol harus
 * memberi tahu bahwa ada yang sedang berjalan — bukan diam lalu tiba-tiba
 * memunculkan berkas. Kegagalan (koneksi putus, berkas hilang di server) juga
 * perlu satu tempat untuk ditampilkan beserta tombol "Coba lagi".
 *
 * Unduhan dibatalkan saat komponennya dilepas, sehingga pindah halaman tidak
 * meninggalkan permintaan yang tetap mengunduh di latar belakang.
 *
 * @param {object} [opsi]
 * @param {string} [opsi.namaCadangan] nama berkas bila URL tidak memuat nama
 */
export const useMediaDownload = ({ namaCadangan = 'media' } = {}) => {
  const [unduhan, setUnduhan] = useState(AWAL)
  const pengendali = useRef(null)
  const hidup = useRef(true)
  const pewaktu = useRef(null)

  useEffect(() => {
    hidup.current = true

    return () => {
      hidup.current = false
      clearTimeout(pewaktu.current)
      pengendali.current?.abort()
    }
  }, [])

  const mulai = useCallback(
    async (url, nama = namaCadangan) => {
      if (!url) return false

      clearTimeout(pewaktu.current)
      pengendali.current?.abort()

      const baru = new AbortController()
      pengendali.current = baru
      setUnduhan({ ...AWAL, status: 'downloading' })

      const berhasil = await downloadMedia(url, nama, {
        signal: baru.signal,
        // Pesan gagal + "Coba lagi" sudah disediakan UI; membuka tab baru
        // sekaligus membuat user kehilangan konteks tombol yang dia tekan.
        fallbackToTab: false,
        onProgress: (info) => {
          if (hidup.current && !baru.signal.aborted) {
            setUnduhan({ status: 'downloading', ...info })
          }
        }
      })

      if (!hidup.current || baru.signal.aborted) return berhasil

      setUnduhan((sebelumnya) => ({
        ...sebelumnya,
        status: berhasil ? 'done' : 'error',
        percent: berhasil ? 100 : sebelumnya.percent
      }))

      if (berhasil) {
        pewaktu.current = setTimeout(() => {
          if (hidup.current) setUnduhan(AWAL)
        }, JEDA_SELESAI_MS)
      }

      return berhasil
    },
    [namaCadangan]
  )

  // "Coba lagi" memakai URL yang sama dengan percobaan terakhir, jadi pemanggil
  // tidak perlu menyimpannya sendiri.
  const terakhir = useRef('')
  const ulangi = useCallback(() => mulai(terakhir.current), [mulai])

  const unduh = useCallback(
    (url, nama) => {
      terakhir.current = url
      return mulai(url, nama)
    },
    [mulai]
  )

  return { ...unduhan, unduh, ulangi, reset: () => setUnduhan(AWAL) }
}

export default useMediaDownload
