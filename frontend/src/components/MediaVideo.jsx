import { useEffect, useRef, useState } from 'react'
import { resolveMediaUrl } from '../config/api'

/**
 * Pemutar video hasil text-to-video / image-to-video.
 *
 * Alasannya sama dengan MediaImage & MediaAudio: berkas lama bisa hilang dari
 * server (dulu disimpan di filesystem container yang ikut terhapus setiap
 * deploy), dan tanpa penanganan ini yang terlihat hanya pemutar kosong —
 * terkesan generasinya gagal, padahal videonya sempat berhasil dan kuota user
 * tetap terpakai.
 *
 * Pemeriksaan langsung setelah elemen terpasang diperlukan karena peristiwa
 * `error` bisa terlewat bila permintaannya sudah gagal sebelum React memasang
 * handler-nya.
 */

const PESAN_GAGAL =
  'Berkas video ini sudah tidak ada di server. Hasil lama tersimpan di penyimpanan ' +
  'sementara yang ikut terhapus saat aplikasi di-deploy ulang, jadi video ini perlu dibuat ulang.'

const MediaVideo = ({ url, className = '', compact = false, poster = null }) => {
  const [gagal, setGagal] = useState(false)
  const videoRef = useRef(null)

  // URL baru (mis. hasil video berikutnya) harus dicoba lagi, bukan mewarisi
  // status gagal dari video sebelumnya.
  useEffect(() => {
    setGagal(false)
  }, [url])

  useEffect(() => {
    if (gagal) return undefined

    const element = videoRef.current
    if (!element) return undefined

    const periksa = () => {
      // `error` terisi (mis. MEDIA_ERR_SRC_NOT_SUPPORTED untuk 404) atau elemen
      // sudah selesai memuat tanpa metadata sama sekali.
      if (element.error) setGagal(true)
      else if (element.readyState === 0 && element.networkState === 3) setGagal(true)
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
            ? 'w-full rounded-xl border border-amber-300/30 bg-amber-300/[0.08] p-3 text-center text-[11px] leading-snug text-amber-200'
            : 'w-full rounded-xl border border-amber-300/30 bg-amber-300/[0.08] p-4 text-sm text-amber-200'
        }
      >
        {compact ? 'Berkas video sudah tidak ada di server' : PESAN_GAGAL}
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      data-testid="media-video"
      src={resolveMediaUrl(url)}
      poster={poster ? resolveMediaUrl(poster) : undefined}
      controls
      // `metadata` saja supaya daftar riwayat tidak mengunduh seluruh berkas
      // video setiap kali halaman dibuka.
      preload="metadata"
      playsInline
      className={`w-full ${className}`}
      onError={() => setGagal(true)}
      onLoadedMetadata={() => setGagal(false)}
    />
  )
}

export default MediaVideo
