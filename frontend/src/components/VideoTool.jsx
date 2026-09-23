import { useState, useEffect, useRef } from 'react'
import { memberAPI, mediaAPI, resolveMediaUrl } from '../config/api'
import Layout from '../components/Layout'
import MediaVideo from '../components/MediaVideo'
import { GlassPanel, PageHeader, SectionTitle } from '../components/ui'

/**
 * Kerangka bersama halaman Text to Video & Image to Video.
 *
 * Kedua halaman hampir seluruhnya sama (form, polling, panel hasil, riwayat) dan
 * hanya berbeda pada input tambahannya (gambar pertama) serta endpoint yang
 * dipanggil. Menyalinnya menjadi dua berkas berarti setiap perbaikan polling
 * harus dikerjakan dua kali — dan justru polling inilah bagian yang paling
 * sering salah. Jadi yang berbeda dikirim lewat props.
 *
 * Cara kerja fiturnya berbeda dari fitur lain dan itu memengaruhi UI:
 * endpoint-nya membalas 202 segera, sementara videonya baru selesai 1-5 menit
 * kemudian di server. Karena itu panel hasil TIDAK diisi dari respons, melainkan
 * dari riwayat yang dipolling sampai record pekerjaan itu berubah status.
 */

// Batas sisi gambar pertama di browser. Provider tidak menyebut batasnya, tetapi
// 1280px sudah cukup tajam untuk video 720p/1080p dan menjaga unggahannya kecil.
const MAX_IMAGE_EDGE = 1280
const MAX_FILE_BYTES = 10 * 1024 * 1024

/** Baca file gambar, kecilkan ke <= MAX_IMAGE_EDGE, lalu kembalikan data URL. */
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
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height))
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

const VideoTool = ({
  user,
  setUser,
  type,
  eyebrow,
  title,
  description,
  promptPlaceholder,
  emptyHistory,
  requiresImage = false
}) => {
  const [options, setOptions] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [resolution, setResolution] = useState('')
  const [duration, setDuration] = useState('')
  const [image, setImage] = useState(null)
  const [imageError, setImageError] = useState('')
  const [loadingImage, setLoadingImage] = useState(false)
  const [dragging, setDragging] = useState(false)
  // `pending` adalah contentId pekerjaan yang sedang berjalan. Menyimpannya
  // (bukan sekadar flag boolean) membuat panel hasil hanya menampilkan hasil
  // pekerjaan INI — bukan record lama yang kebetulan sudah selesai.
  const [pending, setPending] = useState(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [quota, setQuota] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const fileInputRef = useRef(null)

  const generating = pending !== null
  const remainingVideos = quota?.videoGeneration ?? null
  const outOfQuota = remainingVideos !== null && remainingVideos <= 0
  const maxPromptLength = options?.maxPromptLength || 2000
  const canGenerate =
    prompt.trim().length > 0 && (!requiresImage || Boolean(image)) && !generating && !outOfQuota

  useEffect(() => {
    fetchHistory()
    fetchQuota()
    fetchOptions()
  }, [])

  const fetchQuota = async () => {
    try {
      const response = await memberAPI.getQuota()
      setQuota(response.data.quota)
    } catch (err) {
      console.error('Failed to fetch quota:', err)
    }
  }

  // Aturan yang ditampilkan ke user (resolusi, durasi, batas prompt) datang dari
  // server supaya tidak bisa menyimpang dari yang benar-benar divalidasi.
  const fetchOptions = async () => {
    try {
      const response = await mediaAPI.getVideoOptions()
      setOptions(response.data)
      setResolution((sebelumnya) => sebelumnya || response.data.defaultResolution)
      // Durasi awal dari server (bisa diubah lewat VIDEO_DURATION); user tetap
      // bebas memilih nilai lain di rentang 3-15 detik.
      setDuration((sebelumnya) => sebelumnya || response.data.defaultDuration)
    } catch (err) {
      console.error('Failed to fetch video options:', err)
    }
  }

  const fetchHistory = async () => {
    try {
      const response = await mediaAPI.getHistory({ type, limit: 12 })
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

  // Polling berhenti sendiri setelah ±12 menit. Provider menyelesaikan video
  // dalam 1-5 menit, jadi lewat batas ini artinya pekerjanya memang sudah tidak
  // akan menutup record-nya (mis. kontainer backend di-restart).
  const MAX_POLL = 144

  useEffect(() => {
    if (!pending) return undefined

    let sisa = MAX_POLL
    const timer = setInterval(async () => {
      if (sisa-- <= 0) {
        clearInterval(timer)
        setPending(null)
        setError(
          'The video is taking longer than expected. Check your history in a moment — ' +
            'if it finished, it will show up there.'
        )
        return
      }

      const items = await fetchHistory()
      const pekerjaan = (items || []).find((item) => item.contentId === pending)

      if (!pekerjaan) return

      if (pekerjaan.outputUrl) {
        setResult(pekerjaan)
        setPending(null)
        // Kuota baru berkurang setelah server menyimpan videonya, jadi angkanya
        // harus diambil ulang di sini.
        fetchQuota()
        return
      }

      if (pekerjaan.status === 'failed') {
        setPending(null)
        setError(pekerjaan.error?.message || 'Video generation failed. Please try again.')
      }
    }, 5000)

    return () => clearInterval(timer)
  }, [pending])

  // Tanpa penanda waktu, tombol yang diam selama beberapa menit terlihat seperti
  // macet — dan user memuat ulang halaman di tengah proses.
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
    } catch (err) {
      setImage(null)
      setImageError(err.message)
    } finally {
      setLoadingImage(false)
    }
  }

  const handleGenerate = async () => {
    if (!canGenerate) return

    setError('')
    setResult(null)

    try {
      const response = requiresImage
        ? await mediaAPI.imageToVideo({
            prompt: prompt.trim(),
            image: image.dataUrl,
            resolution,
            duration
          })
        : await mediaAPI.textToVideo({
            prompt: prompt.trim(),
            resolution,
            ratio: options?.defaultRatio,
            duration
          })

      const record = response.data.media
      setHistory((items) => [record, ...items.filter((item) => item.contentId !== record.contentId)])
      // Pekerjaan berjalan di server; panel hasil menunggu record ini selesai.
      setPending(record.contentId)
    } catch (err) {
      console.error('Video generation failed:', err)

      // Respons yang gagal sampai ke browser tidak berarti servernya ikut gagal:
      // record-nya bisa saja sudah dibuat. Riwayat diambil ulang supaya pekerjaan
      // yang benar-benar berjalan tetap terlihat dan ikut dipolling.
      const items = await fetchHistory()
      const tersimpan = items?.[0]

      if (tersimpan?.status === 'processing') setPending(tersimpan.contentId)

      const detail = err.response?.data?.message
      const reason = err.response?.data?.error

      // Sebab teknis ditampilkan (mis. provider salah konfigurasi), tapi
      // kredensial disaring agar tidak mungkin muncul di UI.
      const safeReason =
        typeof reason === 'string' && reason !== detail && !/(gsk_|AIza|sk-[A-Za-z0-9]{12,})/.test(reason)
          ? reason
          : null

      setError(`${detail || err.message || 'Video generation failed. Please try again.'}${safeReason ? ` (${safeReason})` : ''}`)
    }
  }

  const handleDelete = async (contentId) => {
    if (!window.confirm('Delete this video?')) return

    try {
      await mediaAPI.deleteMedia(contentId)
      setHistory((items) => items.filter((item) => item.contentId !== contentId))
      if (result?.contentId === contentId) setResult(null)
    } catch (err) {
      console.error('Delete failed:', err)
      setError('Failed to delete this video.')
    }
  }

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-5">
        <PageHeader
          eyebrow={eyebrow}
          title={title}
          description={description}
          actions={
            remainingVideos !== null && (
              <div className="glass-panel flex items-center gap-3 px-4 py-2.5">
                <span className="hud">sisa video</span>
                <span data-testid="video-quota" className="font-mono text-xl font-semibold text-rose-300">
                  {remainingVideos}
                </span>
              </div>
            )
          }
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* ------------------------------- Formulir ------------------------------- */}
          <GlassPanel className="rise h-fit p-5 sm:p-6 lg:sticky lg:top-24">
            {requiresImage && (
              <div className="mb-5">
                <span className="hud mb-2 block">gambar pertama</span>

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
                      alt="Selected first frame"
                      className="max-h-48 w-full rounded-lg object-contain"
                    />
                  ) : (
                    <div className="py-8">
                      <p className="text-sm text-slate-300">
                        {loadingImage ? 'Preparing image…' : 'Klik atau jatuhkan gambar di sini'}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-slate-500">
                        PNG · JPEG · WEBP · maks 10 MB
                      </p>
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
                  </p>
                )}

                {imageError && <p className="mt-2 text-xs text-rose-300">{imageError}</p>}
              </div>
            )}

            <SectionTitle hint="Sebutkan gerakan kamera dan suasana supaya hasilnya lebih terarah.">
              Prompt
            </SectionTitle>

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
              maxLength={maxPromptLength}
              rows={4}
              placeholder={promptPlaceholder}
              className="field resize-none"
            />
            <p className="mt-1.5 font-mono text-[10px] text-slate-500">
              {prompt.length}/{maxPromptLength} characters · Ctrl/⌘ + Enter to generate
            </p>

            <div className="mt-5">
              <span className="hud mb-2 block">resolusi</span>
              <div className="grid grid-cols-2 gap-2">
                {(options?.resolutions || ['720p']).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setResolution(option)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                      // `border-primary-500` sengaja dipertahankan supaya penanda
                      // pilihan aktifnya sama dengan halaman fitur lain.
                      resolution === option
                        ? 'border-primary-500 bg-cyan-300/10 text-cyan-100 shadow-glow-cyan'
                        : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <span className="hud mb-2 block">durasi</span>
              <div data-testid="duration-options" className="grid grid-cols-5 gap-2 sm:grid-cols-7">
                {(options?.durations || [5]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    data-testid={`duration-option-${option}`}
                    onClick={() => setDuration(option)}
                    className={`rounded-xl border px-2 py-2 text-sm font-medium transition-all duration-200 ${
                      duration === option
                        ? 'border-primary-500 bg-cyan-300/10 text-cyan-100 shadow-glow-cyan'
                        : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}
                  >
                    {option}s
                  </button>
                ))}
              </div>
            </div>

            {/* Durasi menentukan biaya/pulsa per pekerjaan, jadi nilainya ditampilkan
                ulang bersama kuota sebelum user menekan Generate. */}
            <p className="mt-4 text-xs text-slate-500">
              <span className="text-slate-300">{duration || options?.defaultDuration || 5} detik</span>{' '}
              per video, pada {resolution || '720p'}
              {options?.model ? ` · model ${options.model}` : ''}. Setiap video yang selesai
              memakai satu jatah kuota video — jatahnya tidak berkurang kalau pembuatannya gagal.
            </p>

            {outOfQuota && (
              <p className="mt-4 text-xs text-rose-300">
                Video quota exhausted. Ask an admin to increase it before generating more videos.
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
              className="btn btn-primary mt-5 w-full py-3"
            >
              {generating ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" />
                  Generating... {elapsed}s
                </>
              ) : (
                'Generate video'
              )}
            </button>

            {generating && (
              <p data-testid="generate-progress" className="mt-3 text-xs text-slate-500">
                Video membutuhkan 1-5 menit. Biarkan halaman ini terbuka — pekerjaannya
                berjalan di server dan hasilnya akan muncul sendiri di sini, jadi tidak
                perlu memuat ulang.
              </p>
            )}
          </GlassPanel>

          <div className="space-y-5">
            {/* ------------------------------ Hasil terbaru ---------------------------- */}
            {result?.outputUrl ? (
              <GlassPanel data-testid="latest-result" className="rise rise-1 p-5 sm:p-6">
                <SectionTitle action={<span className="chip chip-ok">baru</span>}>
                  Latest result
                </SectionTitle>

                <MediaVideo
                  url={result.outputUrl}
                  poster={result.inputFile || null}
                  className="rounded-xl border border-white/10"
                />

                <p className="mt-3 text-sm text-slate-300">{result.prompt}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-500">
                  {result.metadata?.resolution}
                  {result.metadata?.duration ? ` · ${result.metadata.duration}s` : ''}
                  {result.metadata?.aspectRatio ? ` · ${result.metadata.aspectRatio}` : ''}
                  {result.metadata?.mode ? ` · ${result.metadata.mode}` : ''}
                  {result.metadata?.provider ? ` · via ${result.metadata.provider}` : ''}
                </p>

                <a
                  href={resolveMediaUrl(result.outputUrl)}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost mt-4 text-xs"
                >
                  Download video
                </a>
              </GlassPanel>
            ) : generating ? (
              <GlassPanel data-testid="video-progress-panel" className="rise rise-1 p-5 sm:p-6">
                <SectionTitle action={<span className="chip">{elapsed}s</span>}>
                  Rendering
                </SectionTitle>
                <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.02]">
                  <div className="flex flex-col items-center gap-3">
                    <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" />
                    <p className="hud">video sedang dibuat di server…</p>
                  </div>
                </div>
              </GlassPanel>
            ) : null}

            {/* --------------------------------- Riwayat ------------------------------- */}
            <GlassPanel className="rise rise-2 p-5 sm:p-6">
              <SectionTitle hint="12 video terakhir Anda.">Your videos</SectionTitle>

              {historyLoading ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[1, 2].map((item) => (
                    <div
                      key={item}
                      className="aspect-video animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]"
                    />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-500">{emptyHistory}</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {history.map((item) => (
                    <figure key={item.contentId} data-testid="history-item" className="group">
                      <div className="relative">
                        {item.outputUrl ? (
                          <MediaVideo
                            url={item.outputUrl}
                            poster={item.inputFile || null}
                            compact
                            className="aspect-video rounded-xl border border-white/10 object-cover"
                          />
                        ) : (
                          <div
                            className={`flex aspect-video w-full items-center justify-center rounded-xl border p-3 text-center text-xs ${
                              item.status === 'failed'
                                ? 'border-rose-400/30 bg-rose-500/10 text-rose-200'
                                : 'border-white/10 bg-white/[0.02] text-slate-400'
                            }`}
                          >
                            {item.status === 'failed'
                              ? item.error?.message || 'Generation failed'
                              : 'Rendering…'}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDelete(item.contentId)}
                          title="Delete"
                          aria-label="Hapus video"
                          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-ink-950/80 text-rose-300 transition-all hover:border-rose-400/50 hover:bg-rose-500/20 md:opacity-0 md:group-hover:opacity-100"
                        >
                          ×
                        </button>
                      </div>

                      <figcaption className="mt-2 line-clamp-2 text-xs text-slate-400">
                        {item.prompt}
                      </figcaption>
                      {(item.metadata?.resolution || item.metadata?.provider) && (
                        <p className="mt-1 font-mono text-[10px] text-slate-500">
                          {item.metadata?.resolution}
                          {item.metadata?.duration ? ` · ${item.metadata.duration}s` : ''}
                          {item.metadata?.provider ? ` · via ${item.metadata.provider}` : ''}
                        </p>
                      )}
                    </figure>
                  ))}
                </div>
              )}
            </GlassPanel>
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default VideoTool
