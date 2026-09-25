import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { mediaAPI, resolveMediaUrl } from '../config/api'
import Layout from '../components/Layout'
import MediaImage from '../components/MediaImage'
import MediaAudio from '../components/MediaAudio'
import MediaVideo from '../components/MediaVideo'
import { GlassPanel, PageHeader, SectionTitle } from '../components/ui'
import { RefreshIcon } from '../components/icons'

/**
 * Halaman Riwayat: semua hasil generate milik user, satu tempat.
 *
 * Sebelumnya riwayat hanya muncul sebagai panel kecil di tiap halaman alat
 * (12 item terakhir, tanpa pencarian). Panel itu tetap ada sebagai tampilan
 * cepat, sedangkan halaman ini dipakai untuk mencari kembali prompt lama,
 * menyaring hasil yang gagal, dan menjalankannya lagi.
 *
 * Pencarian, filter, dan paginasi dikerjakan SERVER (lihat getMediaHistory),
 * bukan disaring di browser: hasil generate bisa ribuan baris, dan menyaringnya
 * di browser berarti mengunduh semuanya dulu — lambat dan boros kuota data.
 */

const PAGE_SIZE = 12

const TYPE_OPTIONS = [
  { value: '', label: 'Semua jenis' },
  { value: 'text-to-image', label: 'Text to Image' },
  { value: 'image-to-image', label: 'Image to Image' },
  { value: 'text-to-video', label: 'Text to Video' },
  { value: 'image-to-video', label: 'Image to Video' },
  { value: 'text-to-sound', label: 'Text to Sound' },
  { value: 'sound-to-text', label: 'Sound to Text' }
]

const STATUS_OPTIONS = [
  { value: '', label: 'Semua status' },
  { value: 'completed', label: 'Selesai' },
  { value: 'processing', label: 'Diproses' },
  { value: 'pending', label: 'Menunggu' },
  { value: 'failed', label: 'Gagal' }
]

const TYPE_LABELS = {
  'text-to-image': 'Text to Image',
  'image-to-image': 'Image to Image',
  'text-to-video': 'Text to Video',
  'image-to-video': 'Image to Video',
  'text-to-sound': 'Text to Sound',
  'sound-to-text': 'Sound to Text'
}

const IMAGE_TYPES = ['text-to-image', 'image-to-image']
const VIDEO_TYPES = ['text-to-video', 'image-to-video']
const AUDIO_TYPES = ['text-to-sound']

/**
 * Ke mana tombol "Generate ulang" mengarah untuk tiap jenis media.
 *
 * Yang dikirim hanya PROMPT-nya, bukan langsung dijalankan: menjalankan
 * pekerjaan (dan memakai kuota) tanpa ditekan user akan mengejutkan, dan untuk
 * jenis yang butuh berkas input gambarnya tetap harus diunggah ulang.
 * `needsImage` dipakai halaman tujuan untuk menampilkan pengingat itu.
 */
const RERUN_TARGETS = {
  'text-to-image': { path: '/tools/text-to-image' },
  'image-to-image': { path: '/tools/image-to-image', needsImage: true },
  'text-to-video': { path: '/tools/text-to-video' },
  'image-to-video': { path: '/tools/image-to-video', needsImage: true },
  'text-to-sound': { path: '/tools/text-to-sound' },
  // Sound to Text tidak bisa diulang dari prompt: yang dibutuhkan berkas
  // audionya. Tombolnya tetap ada, tetapi hanya membuka halamannya.
  'sound-to-text': { path: '/tools/sound-to-text', withoutPrompt: true }
}

const statusChip = (status) => {
  if (status === 'completed') return 'chip chip-ok'
  if (status === 'failed') return 'chip chip-danger'
  return 'chip chip-warn'
}

const statusLabel = (status) =>
  ({ completed: 'selesai', processing: 'diproses', pending: 'menunggu', failed: 'gagal' }[status] ||
  status)

const HistoryPage = ({ user, setUser }) => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Filter jenis boleh datang dari URL (`/history?type=text-to-video`), karena
  // itulah jalur masuk dari tautan "lihat semua riwayat" di setiap halaman alat
  // (lihat components/HistoryLink.jsx). Nilainya divalidasi terhadap daftar yang
  // sah supaya URL yang salah ketik tidak mengirim permintaan yang dijawab 400.
  const tipeDariUrl = searchParams.get('type') || ''
  const tipeSah = TYPE_OPTIONS.some((option) => option.value === tipeDariUrl) ? tipeDariUrl : ''

  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState(tipeSah)
  const [status, setStatus] = useState('')
  // Keadaan tautan baca-saja per item: { [contentId]: { token, tautan, busy, copied, error } }.
  // Disimpan di halaman (bukan di dalam tiap kartu) supaya kartu tetap komponen
  // murni yang hanya membaca state terbaru.
  const [share, setShare] = useState({})
  // Filter yang benar-benar dikirim ke server. Dipisah dari `keyword` supaya
  // pengetikan tidak menjadi satu permintaan per huruf (lihat debounce di bawah).
  const [applied, setApplied] = useState({ q: '', type: tipeSah, status: '' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ media: [], total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchHistory = useCallback(async () => {
    setLoading(true)

    try {
      const response = await mediaAPI.getHistory({ ...applied, page, limit: PAGE_SIZE })

      setData({
        media: response.data.media || [],
        total: response.data.total ?? response.data.count ?? 0,
        pages: response.data.pages ?? 1
      })
      setError('')
    } catch (err) {
      console.error('Failed to fetch media history:', err)
      setError(err.response?.data?.message || err.message || 'Gagal memuat riwayat.')
    } finally {
      setLoading(false)
    }
  }, [applied, page])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // URL bisa berubah tanpa halaman ini di-mount ulang (mis. user menekan tautan
  // "lihat semua riwayat" dari halaman lain sambil halaman ini masih terbuka),
  // jadi filternya ikut disamakan setiap kali query-nya berubah.
  useEffect(() => {
    setType(tipeSah)
    setApplied((prev) => (prev.type === tipeSah ? prev : { ...prev, type: tipeSah }))
    setPage(1)
  }, [tipeSah])

  // Kata kunci dijalankan setelah user berhenti mengetik sebentar.
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = keyword.trim()

      setApplied((prev) => (prev.q === q ? prev : { ...prev, q }))
      // Kembali ke halaman pertama: hasil yang lebih sedikit bisa membuat
      // halaman yang sedang dibuka melewati batas, dan yang terlihat
      // hanya daftar kosong padahal hasilnya ada di halaman awal.
      setPage(1)
    }, 400)

    return () => clearTimeout(timer)
  }, [keyword])

  // Selama masih ada pekerjaan berjalan (video bisa 1-5 menit), daftar disegarkan
  // berkala supaya statusnya berubah sendiri tanpa user memuat ulang halaman.
  const adaProses = data.media.some((item) => item.status === 'processing' || item.status === 'pending')

  useEffect(() => {
    if (!adaProses) return undefined

    const timer = setInterval(fetchHistory, 5000)
    return () => clearInterval(timer)
  }, [adaProses, fetchHistory])

  const ubahType = (value) => {
    setType(value)
    setApplied((prev) => ({ ...prev, type: value }))
    setPage(1)
  }

  const ubahStatus = (value) => {
    setStatus(value)
    setApplied((prev) => ({ ...prev, status: value }))
    setPage(1)
  }

  const handleDelete = async (contentId) => {
    if (!window.confirm('Hapus hasil ini? Berkasnya juga dihapus dari server.')) return

    try {
      await mediaAPI.deleteMedia(contentId)
      // Hapus item terakhir di halaman ini berarti halamannya jadi kosong;
      // mundur satu halaman supaya user tidak melihat daftar kosong.
      if (data.media.length === 1 && page > 1) setPage((prev) => prev - 1)
      else fetchHistory()
    } catch (err) {
      console.error('Delete failed:', err)
      setError('Failed to delete this item.')
    }
  }

  const handleRerun = (item) => {
    const target = RERUN_TARGETS[item.type]
    if (!target) return

    if (target.withoutPrompt) {
      navigate(target.path)
      return
    }

    navigate(target.path, {
      state: { prompt: item.prompt, fromHistory: true, needsImage: Boolean(target.needsImage) }
    })
  }

  /**
   * Tautan baca-saja yang berlaku untuk satu item.
   *
   * `item.shareToken` dibaca dari server supaya keadaan "sudah dibagikan" ikut
   * benar saat halaman dibuka ulang — token yang dibuat di sesi sebelumnya tetap
   * tampil tanpa perlu menekan Bagikan lagi.
   */
  const tautanBagikan = (item) => {
    const dariSesiIni = share[item.contentId]?.tautan
    if (dariSesiIni) return dariSesiIni

    return item.shareToken ? `${window.location.origin}/share/${item.shareToken}` : null
  }

  const ubahShare = (contentId, nilai) =>
    setShare((prev) => ({ ...prev, [contentId]: { ...prev[contentId], ...nilai } }))

  /** Salin ke clipboard. Kegagalan bukan error: tautannya tetap tampil di layar. */
  const salinTautan = async (teks) => {
    try {
      await navigator.clipboard.writeText(teks)
      return true
    } catch {
      // Clipboard butuh konteks aman (https/localhost) dan izin pengguna.
      return false
    }
  }

  const handleShare = async (item) => {
    ubahShare(item.contentId, { busy: true, error: '' })

    try {
      const response = await mediaAPI.shareMedia(item.contentId)
      const token = response.data.shareToken
      // Tautan absolutnya disusun di browser: backend hanya tahu jalurnya, dan
      // itu membuat tautannya benar di lokal maupun di produksi.
      const tautan = `${window.location.origin}/share/${token}`
      const tersalin = await salinTautan(tautan)

      ubahShare(item.contentId, { busy: false, copied: tersalin })
      // Chip "dibagikan" di kartu membaca token dari daftar, jadi record-nya ikut
      // disinkronkan tanpa memuat ulang riwayat.
      setData((prev) => ({
        ...prev,
        media: prev.media.map((media) =>
          media.contentId === item.contentId ? { ...media, shareToken: token } : media
        )
      }))
    } catch (err) {
      ubahShare(item.contentId, {
        busy: false,
        error: err.response?.data?.message || 'Gagal membuat tautan. Coba lagi.'
      })
    }
  }

  const handleCopyShare = async (item) => {
    const tautan = tautanBagikan(item)
    if (!tautan) return

    ubahShare(item.contentId, { copied: await salinTautan(tautan) })
  }

  const handleUnshare = async (item) => {
    if (!window.confirm('Cabut tautan ini? Tautan yang sudah disebar tidak bisa dibuka lagi.')) {
      return
    }

    ubahShare(item.contentId, { busy: true, error: '' })

    try {
      await mediaAPI.unshareMedia(item.contentId)
      ubahShare(item.contentId, { busy: false, copied: false })
      setData((prev) => ({
        ...prev,
        media: prev.media.map((media) =>
          media.contentId === item.contentId ? { ...media, shareToken: undefined } : media
        )
      }))
    } catch (err) {
      ubahShare(item.contentId, {
        busy: false,
        error: err.response?.data?.message || 'Gagal mencabut tautan. Coba lagi.'
      })
    }
  }

  const adaFilter = Boolean(applied.q || applied.type || applied.status)

  const renderPreview = (item) => {
    if (IMAGE_TYPES.includes(item.type) && item.outputUrl) {
      return (
        <MediaImage
          url={item.outputUrl}
          alt={item.prompt}
          className="h-40 w-full rounded-xl border border-white/10 object-cover"
        />
      )
    }

    if (VIDEO_TYPES.includes(item.type) && item.outputUrl) {
      return <MediaVideo url={item.outputUrl} className="rounded-xl border border-white/10" />
    }

    if (AUDIO_TYPES.includes(item.type) && item.outputUrl) {
      return <MediaAudio url={item.outputUrl} />
    }

    if (item.type === 'sound-to-text' && item.status === 'completed') {
      return (
        <p className="glass-inset max-h-40 overflow-y-auto whitespace-pre-wrap p-3 text-sm text-slate-200">
          {item.prompt}
        </p>
      )
    }

    return (
      <div className="flex h-40 w-full items-center justify-center rounded-xl border border-rose-400/30 bg-rose-500/10 p-2 text-center text-xs text-rose-200">
        {item.status === 'failed'
          ? item.error?.message || 'Generation failed'
          : item.status === 'processing'
            ? 'Generating...'
            : 'No preview'}
      </div>
    )
  }

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-5">
        <PageHeader
          eyebrow="arsip"
          title="History"
          description="Cari kembali hasil lama, saring yang gagal, lalu jalankan lagi dengan prompt yang sama."
          actions={
            <button type="button" onClick={fetchHistory} className="btn btn-ghost" disabled={loading}>
              Refresh
            </button>
          }
        />

        <GlassPanel className="rise p-5 sm:p-6">
          <SectionTitle hint="Pencarian hanya mencocokkan prompt, bukan nama berkas.">
            Cari &amp; saring
          </SectionTitle>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <label htmlFor="history-search" className="hud mb-2 block">
                kata kunci prompt
              </label>
              <input
                id="history-search"
                type="search"
                data-testid="history-search"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                className="field"
                placeholder="mis. bangunan, sunset, wajah"
              />
            </div>

            <div>
              <label htmlFor="history-type" className="hud mb-2 block">
                jenis
              </label>
              <select
                id="history-type"
                data-testid="history-type"
                value={type}
                onChange={(event) => ubahType(event.target.value)}
                className="field"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="history-status" className="hud mb-2 block">
                status
              </label>
              <select
                id="history-status"
                data-testid="history-status"
                value={status}
                onChange={(event) => ubahStatus(event.target.value)}
                className="field"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="mt-3 font-mono text-[11px] text-slate-500" data-testid="history-total">
            {data.total} hasil{adaFilter ? ' (hasil penyaringan)' : ''} · halaman {page} dari {data.pages}
          </p>
        </GlassPanel>

        {error && (
          <div data-testid="history-error" className="alert alert-danger" role="alert">
            <p>{error}</p>
          </div>
        )}

        <GlassPanel className="rise rise-1 p-5 sm:p-6">
          <SectionTitle hint={`${PAGE_SIZE} item per halaman.`}>Hasil</SectionTitle>

          {loading && data.media.length === 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-64 animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]"
                />
              ))}
            </div>
          ) : data.media.length === 0 ? (
            <p data-testid="history-empty" className="text-sm text-slate-500">
              {adaFilter
                ? 'Tidak ada hasil yang cocok dengan pencarian/filter ini.'
                : 'Belum ada hasil generate. Buka salah satu alat untuk mulai.'}
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.media.map((item) => {
                const target = RERUN_TARGETS[item.type]

                return (
                  <figure
                    key={item.contentId}
                    data-testid="history-item"
                    data-media-type={item.type}
                    className="glass-inset flex flex-col gap-3 p-3"
                  >
                    {renderPreview(item)}

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip chip-accent">{TYPE_LABELS[item.type] || item.type}</span>
                      <span className={statusChip(item.status)}>{statusLabel(item.status)}</span>
                      {item.shareToken && (
                        <span data-testid="history-shared" className="chip chip-ok">
                          dibagikan
                        </span>
                      )}
                    </div>

                    <figcaption className="line-clamp-3 text-sm text-slate-300">{item.prompt}</figcaption>

                    <p className="font-mono text-[10px] text-slate-500">
                      {new Date(item.createdAt).toLocaleString()}
                      {item.metadata?.resolution ? ` · ${item.metadata.resolution}` : ''}
                      {item.metadata?.duration ? ` · ${item.metadata.duration}s` : ''}
                      {item.metadata?.provider ? ` · via ${item.metadata.provider}` : ''}
                    </p>

                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      {target && (
                        <button
                          type="button"
                          data-testid="history-rerun"
                          onClick={() => handleRerun(item)}
                          className="btn btn-ghost text-xs"
                          title={
                            target.withoutPrompt
                              ? 'Buka alatnya (berkas audio harus dipilih ulang)'
                              : 'Buka alatnya dengan prompt ini sudah terisi'
                          }
                        >
                          <RefreshIcon className="h-3.5 w-3.5" />
                          Generate ulang
                        </button>
                      )}

                      {item.outputUrl && (
                        <a
                          href={resolveMediaUrl(item.outputUrl)}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost text-xs"
                        >
                          Download
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => handleDelete(item.contentId)}
                        className="btn btn-danger px-3 py-1.5 text-xs"
                        aria-label="Hapus hasil ini"
                      >
                        Hapus
                      </button>
                    </div>

                    {
                      // Tautan baca-saja adalah jalan keluar hasil dari aplikasi.
                      // Hanya ditawarkan untuk hasil yang SUDAH selesai: yang
                      // masih diproses belum punya berkas, dan yang gagal tidak
                      // punya apa pun untuk ditampilkan.
                    }
                    {item.outputUrl && item.status === 'completed' && (
                      <div className="space-y-2">
                        {tautanBagikan(item) ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              data-testid="history-share-link"
                              value={tautanBagikan(item)}
                              onFocus={(event) => event.target.select()}
                              className="field min-w-0 flex-1 text-[11px]"
                              aria-label="Tautan baca-saja"
                            />
                            <button
                              type="button"
                              onClick={() => handleCopyShare(item)}
                              className="btn btn-ghost px-3 py-1.5 text-xs"
                            >
                              {share[item.contentId]?.copied ? 'Tersalin' : 'Salin'}
                            </button>
                            <button
                              type="button"
                              data-testid="history-unshare"
                              onClick={() => handleUnshare(item)}
                              disabled={share[item.contentId]?.busy}
                              className="btn btn-danger px-3 py-1.5 text-xs"
                            >
                              Cabut
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            data-testid="history-share"
                            onClick={() => handleShare(item)}
                            disabled={share[item.contentId]?.busy}
                            className="btn btn-ghost text-xs"
                            title="Buat tautan baca-saja untuk dibagikan ke luar aplikasi"
                          >
                            {share[item.contentId]?.busy ? 'Membuat tautan…' : 'Bagikan tautan'}
                          </button>
                        )}

                        {share[item.contentId]?.error && (
                          <p className="text-[11px] text-rose-300">{share[item.contentId].error}</p>
                        )}
                      </div>
                    )}
                  </figure>
                )
              })}
            </div>
          )}

          {data.pages > 1 && (
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
              <button
                type="button"
                data-testid="history-prev"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page <= 1 || loading}
                className="btn btn-ghost"
              >
                ← Sebelumnya
              </button>

              <span className="font-mono text-xs text-slate-500">
                {page} / {data.pages}
              </span>

              <button
                type="button"
                data-testid="history-next"
                onClick={() => setPage((prev) => Math.min(data.pages, prev + 1))}
                disabled={page >= data.pages || loading}
                className="btn btn-ghost"
              >
                Berikutnya →
              </button>
            </div>
          )}
        </GlassPanel>
      </div>
    </Layout>
  )
}

export default HistoryPage
