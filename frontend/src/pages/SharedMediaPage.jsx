import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { shareAPI } from '../config/api'
import MediaImage from '../components/MediaImage'
import MediaAudio from '../components/MediaAudio'
import MediaVideo from '../components/MediaVideo'
import { GlassPanel } from '../components/ui'

/**
 * Halaman tautan baca-saja (`/share/:token`).
 *
 * Ini satu-satunya halaman yang dibuka TANPA login, jadi keputusannya berbeda
 * dari halaman lain:
 *   - tidak memakai <Layout>: menu samping, kuota, dan profil hanya bermakna
 *     untuk pemilik akun, dan menampilkannya kepada penerima tautan justru
 *     menyesatkan;
 *   - yang ditampilkan hanya bidang yang dikirim backend lewat daftar putih
 *     (`getSharedMedia`) — nama pemilik tampil, identitas akunnya tidak;
 *   - tidak ada tombol hapus/bagikan: halaman ini memang baca-saja.
 *
 * Keadaan gagal dibedakan dengan sengaja. Tautan bisa mati karena dua sebab
 * yang berbeda bagi user: tokennya salah salin, atau pemiliknya mencabut
 * tautannya. Pesannya tidak bisa memastikan yang mana (dan tidak perlu), tetapi
 * kedua-duanya dijelaskan supaya penerima tidak mengira aplikasinya rusak.
 */

const LABEL = {
  'text-to-image': 'Text to Image',
  'image-to-image': 'Image to Image',
  'text-to-video': 'Text to Video',
  'image-to-video': 'Image to Video',
  'text-to-sound': 'Text to Sound',
  'sound-to-text': 'Transkrip'
}

const SharedMediaPage = () => {
  const { token } = useParams()
  const [media, setMedia] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let dibatalkan = false

    const muat = async () => {
      try {
        const response = await shareAPI.getShared(token)

        if (!dibatalkan) setMedia(response.data.media)
      } catch (err) {
        if (dibatalkan) return

        setError(
          err.response?.status === 404
            ? 'Tautan ini tidak ditemukan atau sudah dicabut pemiliknya.'
            : err.response?.data?.message || 'Gagal memuat tautan ini.'
        )
      } finally {
        if (!dibatalkan) setLoading(false)
      }
    }

    muat()

    return () => {
      dibatalkan = true
    }
  }, [token])

  const renderMedia = () => {
    if (!media?.outputUrl) {
      return (
        <div className="flex h-48 items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] text-sm text-slate-400">
          Berkas hasilnya tidak tersedia.
        </div>
      )
    }

    if (media.type === 'text-to-image' || media.type === 'image-to-image') {
      return (
        <MediaImage
          url={media.outputUrl}
          alt={media.prompt}
          className="w-full rounded-xl border border-white/10 object-contain"
        />
      )
    }

    if (media.type === 'text-to-video' || media.type === 'image-to-video') {
      return (
        <MediaVideo
          url={media.outputUrl}
          poster={media.inputUrl || null}
          className="w-full rounded-xl border border-white/10"
        />
      )
    }

    if (media.type === 'text-to-sound') {
      return <MediaAudio url={media.outputUrl} />
    }

    // sound-to-text tidak punya berkas keluaran: yang dibagikan transkripnya
    // (berada di `prompt`, sama seperti di halaman Riwayat).
    return (
      <p className="glass-inset max-h-80 overflow-y-auto whitespace-pre-wrap p-4 text-sm text-slate-200">
        {media.prompt}
      </p>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-10">
      <GlassPanel className="rise p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="hud mb-1">tautan dibagikan</p>
            <h1 className="text-xl font-semibold text-slate-100">
              {loading ? 'Memuat…' : LABEL[media?.type] || 'Hasil generate'}
            </h1>
          </div>
          <span className="chip">baca-saja</span>
        </div>

        {loading && (
          <div className="mt-6 h-64 animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]" />
        )}

        {!loading && error && (
          <div data-testid="share-error" className="alert alert-danger mt-6" role="alert">
            <p>{error}</p>
            <p className="mt-2 text-xs opacity-90">
              Minta ulang tautannya kepada yang mengirimkannya.
            </p>
          </div>
        )}

        {!loading && !error && media && (
          <>
            <div className="mt-5">{renderMedia()}</div>

            {/* Prompt adalah isi yang menjelaskan hasilnya; untuk transkrip ia
                sudah ditampilkan di atas, jadi tidak diulang. */}
            {media.type !== 'sound-to-text' && (
              <p className="mt-4 whitespace-pre-wrap text-sm text-slate-300">{media.prompt}</p>
            )}

            <p className="mt-3 font-mono text-[11px] text-slate-500">
              {media.metadata?.resolution}
              {media.metadata?.duration ? ` · ${media.metadata.duration}s` : ''}
              {media.metadata?.aspectRatio ? ` · ${media.metadata.aspectRatio}` : ''}
              {media.metadata?.model ? ` · ${media.metadata.model}` : ''}
              {media.createdAt ? ` · ${new Date(media.createdAt).toLocaleString()}` : ''}
            </p>

            <p className="mt-4 text-xs text-slate-500">
              {media.sharedBy ? `Dibagikan oleh ${media.sharedBy}. ` : ''}
              Tautan ini bisa dicabut kapan saja oleh pemiliknya, dan hanya bisa dilihat — tidak
              ada cara mengubah atau menghapus isinya dari halaman ini.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              <a
                href={media.outputUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost text-xs"
              >
                Unduh berkas
              </a>
              <Link to="/" className="btn btn-primary text-xs">
                Buka aplikasinya
              </Link>
            </div>
          </>
        )}
      </GlassPanel>
    </div>
  )
}

export default SharedMediaPage
