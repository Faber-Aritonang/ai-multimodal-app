import { useState, useEffect, useRef } from 'react'
import { memberAPI, mediaAPI, resolveMediaUrl } from '../config/api'
import MediaImage from '../components/MediaImage'
import Layout from '../components/Layout'
import { GlassPanel, PageHeader, SectionTitle } from '../components/ui'

/**
 * Batas dari provider: semua gambar input untuk FLUX.2 [klein] harus < 512x512.
 * Foto dari ponsel hampir selalu lebih besar, jadi gambar diperkecil di browser
 * (pakai canvas) sebelum dikirim — backend memvalidasi ulang batas yang sama.
 */
const MAX_EDGE = 512
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_PROMPT_LENGTH = 1000

const SIZES = [
  { value: '1024x1024', label: 'Square', hint: '1024 × 1024', ratio: 1 },
  { value: '1792x1024', label: 'Landscape', hint: '1792 × 1024', ratio: 16 / 9 },
  { value: '1024x1792', label: 'Portrait', hint: '1024 × 1792', ratio: 9 / 16 }
]

/**
 * Baca file gambar, kecilkan supaya sisi terpanjang <= MAX_EDGE, lalu kembalikan
 * data URL siap kirim.
 *
 * @returns {Promise<{dataUrl: string, width: number, height: number, originalWidth: number, originalHeight: number}>}
 */
const downscaleImage = (file) =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file (PNG, JPEG, or WEBP).'))
      return
    }

    if (file.size > MAX_FILE_BYTES) {
      reject(new Error(`File is too large (${Math.round(file.size / 1024)} KB). Max ${MAX_FILE_BYTES / (1024 * 1024)} MB.`))
      return
    }

    const reader = new FileReader()

    reader.onerror = () => reject(new Error('Failed to read the file.'))
    reader.onload = () => {
      const image = new Image()

      image.onerror = () => reject(new Error('That file is not a valid image.'))
      image.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height))
        const width = Math.max(1, Math.round(image.width * scale))
        const height = Math.max(1, Math.round(image.height * scale))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const context = canvas.getContext('2d')

        if (!context) {
          reject(new Error('Your browser does not support image resizing.'))
          return
        }

        context.drawImage(image, 0, 0, width, height)

        // JPEG supaya payload tetap kecil; ini juga format yang paling aman
        // kalau file aslinya WEBP/PNG berukuran besar.
        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', 0.9),
          width,
          height,
          originalWidth: image.width,
          originalHeight: image.height
        })
      }

      image.src = String(reader.result)
    }

    reader.readAsDataURL(file)
  })

/** Pilih preset ukuran yang paling dekat dengan bentuk gambar input. */
const closestSize = (width, height) => {
  const ratio = width / height

  return SIZES.reduce((closest, option) =>
    Math.abs(option.ratio - ratio) < Math.abs(closest.ratio - ratio) ? option : closest
  ).value
}

const ImageToImagePage = ({ user, setUser }) => {
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [image, setImage] = useState(null)
  const [imageError, setImageError] = useState('')
  const [loadingImage, setLoadingImage] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [quota, setQuota] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const fileInputRef = useRef(null)

  const remainingImages = quota?.imageGeneration ?? null
  const outOfQuota = remainingImages !== null && remainingImages <= 0
  const canGenerate = Boolean(image) && prompt.trim().length > 0 && !generating && !outOfQuota

  useEffect(() => {
    fetchHistory()
    fetchQuota()
  }, [])

  const fetchQuota = async () => {
    try {
      const response = await memberAPI.getQuota()
      setQuota(response.data.quota)
    } catch (err) {
      console.error('Failed to fetch quota:', err)
    }
  }

  // Hasil terbaru dikembalikan ke pemanggil supaya kegagalan jaringan di tengah
  // proses masih bisa memunculkan gambar yang sudah tersimpan di server.
  const fetchHistory = async () => {
    try {
      const response = await mediaAPI.getHistory({ type: 'image-to-image', limit: 12 })
      const items = response.data.media || []
      setHistory(items)
      return items
    } catch (err) {
      console.error('Failed to fetch media history:', err)
      return null
    } finally {
      setHistoryLoading(false)
    }
  }

  // Riwayat diambil ulang berkala selama masih ada proses berjalan.
  //
  // Alasannya sama dengan halaman Text to Image: respons edit bisa tidak sampai
  // ke browser (koneksi putus, atau halaman dimuat ulang di tengah proses 20-60
  // detik) padahal server menyimpan hasilnya. Tanpa polling ini user melihat
  // tidak ada apa-apa sampai dia memuat ulang halaman — dan itu yang dilaporkan
  // sebagai "harus refresh dulu baru gambarnya muncul". Item berstatus
  // `processing` di riwayat juga jadi pemicu, supaya halaman yang baru dimuat
  // ulang tetap menyusul hasilnya sendiri.
  const adaProses = generating || history.some((item) => item.status === 'processing')

  useEffect(() => {
    if (!adaProses) return undefined

    // Batas aman: kalau ada record yang tertinggal dalam status `processing`
    // (mis. proses server mati), polling berhenti sendiri setelah ±5 menit.
    let sisa = 60
    const timer = setInterval(async () => {
      if (sisa-- <= 0) {
        clearInterval(timer)
        return
      }

      const items = await fetchHistory()
      const terbaru = items?.find((item) => item.outputUrl)

      if (terbaru) {
        setResult((sebelumnya) => (sebelumnya?.contentId === terbaru.contentId ? sebelumnya : terbaru))
      }

      // Kuota dikurangi server setelah hasilnya tersimpan, jadi angkanya baru
      // benar kalau ikut diambil ulang.
      fetchQuota()
    }, 5000)

    return () => clearInterval(timer)
  }, [adaProses])

  // Provider bisa butuh 20-60 detik per gambar. Tanpa penanda waktu, tombol yang
  // diam terlihat seperti macet dan user memuat ulang halaman di tengah proses —
  // permintaan ikut batal, padahal server tetap menuntaskannya.
  useEffect(() => {
    if (!generating) {
      setElapsed(0)
      return undefined
    }

    const mulai = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - mulai) / 1000)), 1000)

    return () => clearInterval(timer)
  }, [generating])

  const handleFile = async (file) => {
    if (!file) return

    setLoadingImage(true)
    setImageError('')
    setError('')

    try {
      const prepared = await downscaleImage(file)
      setImage({ ...prepared, name: file.name })

      // Bentuk gambar menentukan ukuran hasil yang paling masuk akal
      setSize(closestSize(prepared.originalWidth, prepared.originalHeight))
    } catch (err) {
      setImage(null)
      setImageError(err.message)
    } finally {
      setLoadingImage(false)
    }
  }

  const handleGenerate = async () => {
    if (!canGenerate) return

    setGenerating(true)
    setError('')

    try {
      const response = await mediaAPI.imageToImage({
        prompt: prompt.trim(),
        image: image.dataUrl,
        size
      })

      setResult(response.data.media)
      setQuota(response.data.quota)
      setHistory((items) => [response.data.media, ...items.filter((item) => item.contentId !== response.data.media.contentId)])
    } catch (err) {
      console.error('Image transformation failed:', err)

      // Respons yang gagal sampai ke browser tidak berarti server ikut gagal:
      // hasilnya sudah disimpan lebih dulu, dan permintaan bisa putus sesudahnya.
      // Riwayat diambil ulang agar gambar yang benar-benar ada tetap terlihat.
      const items = await fetchHistory()
      const tersimpan = items?.find((item) => item.outputUrl)

      if (tersimpan) setResult(tersimpan)

      const detail = err.response?.data?.message
      const reason = err.response?.data?.error

      // Sebab teknis ditampilkan (mis. provider salah konfigurasi), tapi
      // kredensial disaring agar tidak mungkin muncul di UI.
      const safeReason =
        typeof reason === 'string' && reason !== detail && !/(gsk_|AIza|sk-[A-Za-z0-9]{12,})/.test(reason)
          ? reason
          : null

      setError(`${detail || err.message || 'Image transformation failed. Please try again.'}${safeReason ? ` (${safeReason})` : ''}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = async (contentId) => {
    if (!window.confirm('Delete this result?')) return

    try {
      await mediaAPI.deleteMedia(contentId)
      setHistory((items) => items.filter((item) => item.contentId !== contentId))
      if (result?.contentId === contentId) setResult(null)
    } catch (err) {
      console.error('Delete failed:', err)
      setError('Failed to delete this result.')
    }
  }

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-5">
        <PageHeader
          eyebrow="alat 04 · transformasi"
          title="Image to Image"
          description="Unggah gambar, tuliskan perubahannya, lalu biarkan AI mengolahnya."
          actions={
            remainingImages !== null && (
              <div className="glass-panel flex items-center gap-3 px-4 py-2.5">
                <span className="hud">sisa gambar</span>
                <span data-testid="image-quota" className="font-mono text-xl font-semibold text-cyan-300">
                  {remainingImages}
                </span>
              </div>
            )
          }
        />

        {/* -------------------------- Sumber + perintah --------------------------- */}
        <GlassPanel className="rise p-5 sm:p-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Unggah */}
            <div>
              <span className="hud mb-2 block">gambar sumber</span>

              <div
                data-testid="drop-zone"
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  handleFile(event.dataTransfer.files?.[0])
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-all duration-200 ${
                  dragging
                    ? 'border-cyan-300/60 bg-cyan-300/10'
                    : 'border-white/15 bg-white/[0.02] hover:border-cyan-300/35 hover:bg-cyan-300/[0.05]'
                }`}
              >
                {image ? (
                  <img
                    data-testid="input-preview"
                    src={image.dataUrl}
                    alt="Selected source"
                    className="max-h-56 w-full rounded-lg object-contain"
                  />
                ) : (
                  <div className="py-8">
                    <p className="text-sm text-slate-300">
                      {loadingImage ? 'Preparing image…' : 'Klik atau jatuhkan gambar di sini'}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-slate-500">PNG · JPEG · WEBP · maks 10 MB</p>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  handleFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />

              {image && (
                <p className="mt-2 font-mono text-[10px] text-slate-500">
                  {image.name} · processed at {image.width} × {image.height}
                  {image.originalWidth > MAX_EDGE || image.originalHeight > MAX_EDGE
                    ? ` (resized from ${image.originalWidth} × ${image.originalHeight}; the model accepts up to ${MAX_EDGE}px)`
                    : ''}
                </p>
              )}

              {imageError && <p className="mt-2 text-xs text-rose-300">{imageError}</p>}
            </div>

            {/* Prompt + ukuran */}
            <div className="flex flex-col">
              <label htmlFor="prompt" className="hud mb-2 block">
                apa yang ingin diubah?
              </label>
              <textarea
                id="prompt"
                data-testid="prompt-input"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    handleGenerate()
                  }
                }}
                maxLength={MAX_PROMPT_LENGTH}
                rows={4}
                placeholder="Turn it into a watercolor painting at sunset"
                className="field resize-none"
              />
              <p className="mt-1.5 font-mono text-[10px] text-slate-500">
                {prompt.length}/{MAX_PROMPT_LENGTH} characters · Ctrl/⌘ + Enter to transform
              </p>

              <span className="hud mb-2 mt-5 block">ukuran hasil</span>
              <div className="grid grid-cols-3 gap-2">
                {SIZES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSize(option.value)}
                    className={`rounded-xl border px-3 py-2.5 text-center text-sm transition-all duration-200 ${
                      // `border-primary-500` sengaja dipertahankan: spec browser
                      // mendeteksi preset aktif lewat kelas itu.
                      size === option.value
                        ? 'border-primary-500 bg-cyan-300/10 text-cyan-100 shadow-glow-cyan'
                        : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}
                  >
                    <span className="block font-medium">{option.label}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-slate-500">{option.hint}</span>
                  </button>
                ))}
              </div>

              <p className="mt-4 text-xs text-slate-500">
                Gambar diperkecil otomatis ke maksimum {MAX_EDGE}px sebelum dikirim, sesuai batas provider.
              </p>
            </div>
          </div>

          {outOfQuota && (
            <p className="mt-4 text-xs text-rose-300">
              Image quota exhausted. Ask an admin to increase it before transforming more pictures.
            </p>
          )}

          {error && (
            <div data-testid="error-message" className="alert alert-danger mt-4" role="alert">
              <p>{error}</p>
            </div>
          )}

          <button
            type="button"
            data-testid="generate-button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="btn btn-primary mt-5 w-full py-3 md:w-auto"
          >
            {generating ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" />
                Transforming... {elapsed}s
              </>
            ) : (
              'Transform image'
            )}
          </button>

          {generating && (
            <p data-testid="generate-progress" className="mt-3 text-xs text-slate-500">
              Provider bisa butuh 20-60 detik per gambar. Biarkan halaman ini terbuka —
              hasilnya tersimpan di server dan akan muncul sendiri di sini, jadi tidak perlu
              memuat ulang.
            </p>
          )}
        </GlassPanel>

        {/* ------------------------------ Hasil terbaru ---------------------------- */}
        {result?.outputUrl && (
          <GlassPanel data-testid="latest-result" className="rise rise-1 p-5 sm:p-6">
            <SectionTitle action={<span className="chip chip-ok">baru</span>}>
              Latest result
            </SectionTitle>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {result.inputFile && (
                <figure>
                  <MediaImage
                    url={result.inputFile}
                    alt="Before"
                    className="w-full rounded-xl border border-white/10"
                  />
                  <figcaption className="hud mt-2">before</figcaption>
                </figure>
              )}
              <figure>
                <MediaImage
                  url={result.outputUrl}
                  alt={result.prompt}
                  className="w-full rounded-xl border border-white/10"
                />
                <figcaption className="hud mt-2">after</figcaption>
              </figure>
            </div>

            <p className="mt-3 text-sm text-slate-300">{result.prompt}</p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              {result.metadata?.resolution}
              {result.metadata?.requestedResolution &&
              result.metadata.requestedResolution !== result.metadata.resolution
                ? ` (requested ${result.metadata.requestedResolution})`
                : ''}
              {result.metadata?.inputResolution ? ` · from ${result.metadata.inputResolution}` : ''}
              {result.metadata?.provider ? ` · via ${result.metadata.provider}` : ''}
            </p>

            <a
              href={resolveMediaUrl(result.outputUrl)}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost mt-4 text-xs"
            >
              Download result
            </a>
          </GlassPanel>
        )}

        {/* --------------------------------- Riwayat ------------------------------- */}
        <GlassPanel className="rise rise-2 p-5 sm:p-6">
          <SectionTitle hint="12 transformasi terakhir Anda.">Your transformations</SectionTitle>

          {historyLoading ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[1, 2, 3, 4].map((item) => (
                <div
                  key={item}
                  className="aspect-square animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]"
                />
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-slate-500">No transformations yet. Upload a picture to start.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {history.map((item) => (
                <figure key={item.contentId} data-testid="history-item" className="group">
                  <div className="relative">
                    {item.outputUrl ? (
                      <MediaImage
                        url={item.outputUrl}
                        alt={item.prompt}
                        compact
                        className="aspect-square w-full rounded-xl border border-white/10 object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-rose-400/30 bg-rose-500/10 p-2 text-center text-xs text-rose-200">
                        {item.status === 'failed' ? 'Transformation failed' : 'No preview'}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDelete(item.contentId)}
                      title="Delete"
                      aria-label="Hapus hasil"
                      className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-ink-950/80 text-rose-300 transition-all hover:border-rose-400/50 hover:bg-rose-500/20 md:opacity-0 md:group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>

                  <figcaption className="mt-2 line-clamp-2 text-xs text-slate-400">{item.prompt}</figcaption>
                  {(item.metadata?.resolution || item.metadata?.provider) && (
                    <p className="mt-1 font-mono text-[10px] text-slate-500">
                      {item.metadata?.resolution}
                      {item.metadata?.provider ? ` · via ${item.metadata.provider}` : ''}
                    </p>
                  )}
                </figure>
              ))}
            </div>
          )}
        </GlassPanel>
      </div>
    </Layout>
  )
}

export default ImageToImagePage
