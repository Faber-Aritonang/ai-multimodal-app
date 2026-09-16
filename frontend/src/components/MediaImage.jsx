import { useEffect, useRef, useState } from 'react'
import { resolveMediaUrl } from '../config/api'

/**
 * Gambar hasil generate, dengan penjelasan jujur saat berkasnya sudah tidak ada.
 *
 * Berkas lama bisa hilang dari server: penyimpanan sebelumnya berada di
 * filesystem container yang dihapus setiap kali aplikasi di-deploy. Tanpa
 * penanganan ini yang terlihat hanya ikon gambar rusak berisi teks `alt`,
 * sehingga terkesan generate-nya gagal — padahal gambarnya sempat berhasil dan
 * kuota user tetap terpakai.
 *
 * Catatan penting soal `onError` React: permintaan gambar bisa sudah gagal
 * sebelum handler React terpasang (terukur pada berkas di object storage yang
 * diblokir), dan saat itu onError tidak pernah dipanggil. Karena itu elemennya
 * juga diperiksa langsung: gambar yang sudah selesai dimuat tanpa dimensi
 * berarti gagal.
 */

const PESAN_GAGAL =
  'Berkas gambar ini sudah tidak ada di server. Gambar lama tersimpan di penyimpanan ' +
  'sementara yang ikut terhapus saat aplikasi di-deploy ulang, jadi gambar ini perlu dibuat ulang.'

const MediaImage = ({ url, alt, className, compact = false }) => {
  const [gagal, setGagal] = useState(false)
  const imgRef = useRef(null)

  // URL baru (mis. hasil generate berikutnya) harus dicoba lagi, bukan mewarisi
  // status gagal dari gambar sebelumnya.
  useEffect(() => {
    setGagal(false)
  }, [url])

  useEffect(() => {
    if (gagal) return undefined

    const element = imgRef.current
    if (!element) return undefined

    const periksa = () => {
      if (element.complete && element.naturalWidth === 0) setGagal(true)
    }

    periksa()
    const timer = setTimeout(periksa, 1500)

    return () => clearTimeout(timer)
  }, [url, gagal])

  if (!url) return null

  if (gagal) {
    return (
      <div
        data-testid="media-missing"
        title={PESAN_GAGAL}
        className={
          compact
            ? 'flex aspect-square w-full items-center justify-center rounded-xl border border-amber-300/30 bg-amber-300/[0.08] p-2 text-center text-[11px] leading-snug text-amber-200'
            : 'w-full max-w-xl rounded-xl border border-amber-300/30 bg-amber-300/[0.08] p-4 text-sm text-amber-200'
        }
      >
        {compact ? 'Berkas gambar sudah tidak ada di server' : PESAN_GAGAL}
      </div>
    )
  }

  return (
    <img
      ref={imgRef}
      src={resolveMediaUrl(url)}
      alt={alt}
      className={className}
      onError={() => setGagal(true)}
      onLoad={() => setGagal(false)}
    />
  )
}

export default MediaImage
