import { useState, useEffect, useRef } from 'react'
import { memberAPI, mediaAPI, resolveMediaUrl } from '../config/api'
import MediaImage from '../components/MediaImage'
import Layout from '../components/Layout'

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

  const fetchHistory = async () => {
    try {
      const response = await mediaAPI.getHistory({ type: 'image-to-image', limit: 12 })
      setHistory(response.data.media || [])
    } catch (err) {
      console.error('Failed to fetch media history:', err)
    } finally {
      setHistoryLoading(false)
    }
  }

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
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-white dark-glass rounded-2xl p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-dark-800 mb-1">Image to Image</h1>
              <p className="text-dark-500">
                Upload a picture, describe the change, and let the AI rework it.
              </p>
            </div>

            {remainingImages !== null && (
              <div className="text-right">
                <p className="text-xs text-dark-500">Images left</p>
                <p data-testid="image-quota" className="text-2xl font-bold text-primary-600">
                  {remainingImages}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Upload + prompt */}
        <div className="bg-white dark-glass rounded-2xl p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Upload */}
            <div>
              <span className="block text-sm font-medium text-dark-700 mb-2">Source image</span>

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
                className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                  dragging ? 'border-primary-500 bg-primary-50' : 'border-dark-200 hover:bg-dark-50'
                }`}
              >
                {image ? (
                  <img
                    data-testid="input-preview"
                    src={image.dataUrl}
                    alt="Selected source"
                    className="w-full max-h-56 object-contain rounded-lg"
                  />
                ) : (
                  <p className="text-sm text-dark-500 py-8">
                    {loadingImage ? 'Preparing image…' : 'Click or drop an image here (PNG, JPEG, WEBP)'}
                  </p>
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
                <p className="text-xs text-dark-400 mt-2">
                  {image.name} · processed at {image.width} × {image.height}
                  {image.originalWidth > MAX_EDGE || image.originalHeight > MAX_EDGE
                    ? ` (resized from ${image.originalWidth} × ${image.originalHeight}; the model accepts up to ${MAX_EDGE}px)`
                    : ''}
                </p>
              )}

              {imageError && (
                <p className="text-xs text-red-600 mt-2">{imageError}</p>
              )}
            </div>

            {/* Prompt */}
            <div className="flex flex-col">
              <label htmlFor="prompt" className="block text-sm font-medium text-dark-700 mb-2">
                What should change?
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
                className="w-full px-4 py-3 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
              <p className="text-xs text-dark-400 mt-1">
                {prompt.length}/{MAX_PROMPT_LENGTH} characters · Ctrl/⌘ + Enter to transform
              </p>

              <span className="block text-sm font-medium text-dark-700 mt-4 mb-2">Output size</span>
              <div className="flex gap-2">
                {SIZES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSize(option.value)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      size === option.value
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-dark-200 text-dark-600 hover:bg-dark-50'
                    }`}
                  >
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-xs text-dark-400">{option.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {outOfQuota && (
            <p className="text-xs text-red-600">
              Image quota exhausted. Ask an admin to increase it before transforming more pictures.
            </p>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          <button
            type="button"
            data-testid="generate-button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full md:w-auto bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white font-medium rounded-lg px-6 py-3 transition-colors flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Transforming...
              </>
            ) : (
              'Transform image'
            )}
          </button>
        </div>

        {/* Latest result */}
        {result?.outputUrl && (
          <div data-testid="latest-result" className="bg-white dark-glass rounded-2xl p-6">
            <h2 className="text-lg font-bold text-dark-800 mb-4">Latest result</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {result.inputFile && (
                <figure>
                  <MediaImage
                    url={result.inputFile}
                    alt="Before"
                    className="w-full rounded-xl border border-dark-200"
                  />
                  <figcaption className="text-xs text-dark-400 mt-1">Before</figcaption>
                </figure>
              )}
              <figure>
                <MediaImage
                  url={result.outputUrl}
                  alt={result.prompt}
                  className="w-full rounded-xl shadow-md border border-dark-200"
                />
                <figcaption className="text-xs text-dark-400 mt-1">After</figcaption>
              </figure>
            </div>

            <p className="text-sm text-dark-500 mt-3">{result.prompt}</p>
            <p className="text-xs text-dark-400 mt-1">
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
              className="inline-block mt-3 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              Download result
            </a>
          </div>
        )}

        {/* History */}
        <div className="bg-white dark-glass rounded-2xl p-6">
          <h2 className="text-lg font-bold text-dark-800 mb-4">Your transformations</h2>

          {historyLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="aspect-square bg-dark-100 rounded-xl animate-pulse"></div>
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="text-dark-400 text-sm">No transformations yet. Upload a picture to start.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {history.map((item) => (
                <figure key={item.contentId} data-testid="history-item" className="group">
                  <div className="relative">
                    {item.outputUrl ? (
                      <MediaImage
                        url={item.outputUrl}
                        alt={item.prompt}
                        compact
                        className="w-full aspect-square object-cover rounded-xl border border-dark-200"
                      />
                    ) : (
                      <div className="w-full aspect-square rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-xs text-red-500 p-2 text-center">
                        {item.status === 'failed' ? 'Transformation failed' : 'No preview'}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(item.contentId)}
                      className="absolute top-2 right-2 bg-white/90 hover:bg-white text-red-600 rounded-lg w-8 h-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                  <figcaption className="text-xs text-dark-500 mt-2 line-clamp-2">{item.prompt}</figcaption>
                  {(item.metadata?.resolution || item.metadata?.provider) && (
                    <p className="text-xs text-dark-400 mt-1">
                      {item.metadata?.resolution}
                      {item.metadata?.provider ? ` · via ${item.metadata.provider}` : ''}
                    </p>
                  )}
                </figure>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}

export default ImageToImagePage
