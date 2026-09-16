import { useState, useEffect } from 'react'
import { memberAPI, mediaAPI, resolveMediaUrl } from '../config/api'
import Layout from '../components/Layout'
import MediaImage from '../components/MediaImage'

const SIZES = [
  { value: '1024x1024', label: 'Square', hint: '1024 × 1024' },
  { value: '1792x1024', label: 'Landscape', hint: '1792 × 1024' },
  { value: '1024x1792', label: 'Portrait', hint: '1024 × 1792' }
]

const MAX_PROMPT_LENGTH = 1000

const TextToImagePage = ({ user, setUser }) => {
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [quality, setQuality] = useState('standard')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [quota, setQuota] = useState(null)

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
      const response = await mediaAPI.getHistory({ type: 'text-to-image', limit: 12 })
      setHistory(response.data.media || [])
    } catch (err) {
      console.error('Failed to fetch media history:', err)
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return

    setGenerating(true)
    setError('')

    try {
      const response = await mediaAPI.textToImage({ prompt: prompt.trim(), size, quality })

      setResult(response.data.media)
      setQuota(response.data.quota)
      setHistory((items) => [response.data.media, ...items])
    } catch (err) {
      console.error('Generate failed:', err)
      setError(
        err.response?.data?.message ||
          err.message ||
          'Failed to generate image. Please try again.'
      )
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = async (contentId) => {
    if (!window.confirm('Delete this image?')) return

    try {
      await mediaAPI.deleteMedia(contentId)
      setHistory((items) => items.filter((item) => item.contentId !== contentId))
      if (result?.contentId === contentId) setResult(null)
    } catch (err) {
      console.error('Delete failed:', err)
      setError('Failed to delete image.')
    }
  }

  const remainingImages = quota?.imageGeneration ?? null

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-white dark-glass rounded-2xl p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-dark-800 mb-1">Text to Image</h1>
              <p className="text-dark-500">
                Describe what you want to see and let the AI draw it for you.
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

        {/* Generator */}
        <div className="bg-white dark-glass rounded-2xl p-6 space-y-4">
          <div>
            <label htmlFor="prompt" className="block text-sm font-medium text-dark-700 mb-2">
              Prompt
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleGenerate()
                }
              }}
              maxLength={MAX_PROMPT_LENGTH}
              rows={4}
              placeholder="A futuristic city skyline at sunset, cinematic lighting, ultra detailed"
              className="w-full px-4 py-3 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
            <p className="text-xs text-dark-400 mt-1">
              {prompt.length}/{MAX_PROMPT_LENGTH} characters · Ctrl/⌘ + Enter to generate
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <span className="block text-sm font-medium text-dark-700 mb-2">Size</span>
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

            <div>
              {/* Parameter quality hanya dikenal model DALL-E; provider gratis mengabaikannya */}
              <span className="block text-sm font-medium text-dark-700 mb-2">
                Quality <span className="font-normal text-dark-400">(DALL·E only)</span>
              </span>
              <div className="flex gap-2">
                {['standard', 'hd'].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setQuality(option)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      quality === option
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-dark-200 text-dark-600 hover:bg-dark-50'
                    }`}
                  >
                    {option === 'hd' ? 'HD (slower)' : 'Standard'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs text-dark-400">
            The size above is a request sent to the provider. Free providers may return a
            different size — the actual resolution is shown on the result.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="w-full md:w-auto bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white font-medium rounded-lg px-6 py-3 transition-colors flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Generating...
              </>
            ) : (
              'Generate image'
            )}
          </button>
        </div>

        {/* Latest result */}
        {result?.outputUrl && (
          <div data-testid="latest-result" className="bg-white dark-glass rounded-2xl p-6">
            <h2 className="text-lg font-bold text-dark-800 mb-4">Latest result</h2>
            <MediaImage
              url={result.outputUrl}
              alt={result.prompt}
              className="w-full max-w-xl rounded-xl shadow-md"
            />
            <p className="text-sm text-dark-500 mt-3">{result.prompt}</p>
            <p className="text-xs text-dark-400 mt-1">
              {/* Ukuran asli dibaca dari header file gambar. Provider gratis sering
                  mengabaikan ukuran yang diminta (mis. minta 1792x1024, dapat
                  1015x580), jadi keduanya ditampilkan agar tidak menyesatkan. */}
              {result.metadata?.resolution}
              {result.metadata?.requestedResolution &&
              result.metadata.requestedResolution !== result.metadata.resolution
                ? ` (requested ${result.metadata.requestedResolution})`
                : ''}
              {result.metadata?.provider ? ` · via ${result.metadata.provider}` : ''}
            </p>
            <a
              href={resolveMediaUrl(result.outputUrl)}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              Download image
            </a>
          </div>
        )}

        {/* History */}
        <div className="bg-white dark-glass rounded-2xl p-6">
          <h2 className="text-lg font-bold text-dark-800 mb-4">Your generations</h2>

          {historyLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="aspect-square bg-dark-100 rounded-xl animate-pulse"></div>
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="text-dark-400 text-sm">
              No images yet. Generate your first one above!
            </p>
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
                        {item.status === 'failed' ? 'Generation failed' : 'No preview'}
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
                  <figcaption className="text-xs text-dark-500 mt-2 line-clamp-2">
                    {item.prompt}
                  </figcaption>
                  {/* Resolusi asli + provider yang dipakai, supaya riwayat tidak
                      menyembunyikan bahwa ukuran hasil bisa beda dari permintaan */}
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

export default TextToImagePage
