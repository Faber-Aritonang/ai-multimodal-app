import { useEffect, useRef, useState } from 'react'
import { resolveMediaUrl } from '../config/api'

/**
 * Pemutar audio hasil text-to-sound.
 *
 * Alasannya sama dengan MediaImage: berkas lama bisa hilang dari server (dulu
 * disimpan di filesystem container yang ikut terhapus setiap deploy), dan tanpa
 * penanganan ini yang terlihat hanya pemutar yang diam — terkesan sintesisnya
 * gagal, padahal audionya sempat berhasil dan kuota user tetap terpakai.
 *
 * Pemeriksaan langsung setelah elemen terpasang diperlukan karena peristiwa
 * `error` bisa terlewat bila permintaannya sudah gagal sebelum React memasang
 * handler-nya: elemen media yang sudah selesai memuat namun tidak punya metadata
 * dan tidak punya error yang terlaporkan tetap tidak bisa diputar.
 */

const PESAN_GAGAL =
  'Berkas audio ini sudah tidak ada di server. Hasil lama tersimpan di penyimpanan ' +
  'sementara yang ikut terhapus saat aplikasi di-deploy ulang, jadi audio ini perlu dibuat ulang.'

const MediaAudio = ({ url, className = '', compact = false }) => {
  const [gagal, setGagal] = useState(false)
  const audioRef = useRef(null)

  // URL baru (mis. hasil sintesis berikutnya) harus dicoba lagi, bukan mewarisi
  // status gagal dari audio sebelumnya.
  useEffect(() => {
    setGagal(false)
  }, [url])

  useEffect(() => {
    if (gagal) return undefined

    const element = audioRef.current
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
        {compact ? 'Berkas audio sudah tidak ada di server' : PESAN_GAGAL}
      </div>
    )
  }

  return (
    <audio
      ref={audioRef}
      data-testid="media-audio"
      src={resolveMediaUrl(url)}
      controls
      preload="metadata"
      className={`w-full ${className}`}
      onError={() => setGagal(true)}
      onLoadedMetadata={() => setGagal(false)}
    />
  )
}

export default MediaAudio
