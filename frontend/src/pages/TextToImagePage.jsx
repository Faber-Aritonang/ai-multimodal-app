import { useState, useEffect } from 'react'
import { memberAPI, mediaAPI, resolveMediaUrl } from '../config/api'
import Layout from '../components/Layout'
import MediaImage from '../components/MediaImage'
import { GlassPanel, PageHeader, SectionTitle } from '../components/ui'

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
      <div className="space-y-5">
        <PageHeader
          eyebrow="alat 03 · gambar"
          title="Text to Image"
          description="Tuliskan deskripsi yang Anda inginkan, lalu AI akan menggambarnya."
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

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* ------------------------------- Formulir ------------------------------- */}
          <GlassPanel className="rise h-fit p-5 sm:p-6 lg:sticky lg:top-24">
            <SectionTitle hint="Semakin spesifik deskripsinya, semakin dekat hasilnya.">
              Prompt
            </SectionTitle>

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
              className="field resize-none"
            />
            <p className="mt-1.5 font-mono text-[10px] text-slate-500">
              {prompt.length}/{MAX_PROMPT_LENGTH} characters · Ctrl/⌘ + Enter to generate
            </p>

            <div className="mt-5">
              <span className="hud mb-2 block">ukuran</span>
              <div className="grid grid-cols-3 gap-2">
                {SIZES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSize(option.value)}
                    className={`rounded-xl border px-3 py-2.5 text-center text-sm transition-all duration-200 ${
                      // `border-primary-500` sengaja dipertahankan: spec browser
                      // mendeteksi pilihan aktif lewat kelas itu.
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
            </div>

            <div className="mt-5">
              {/* Parameter quality hanya dikenal model DALL-E; provider gratis mengabaikannya */}
              <span className="hud mb-2 block">
                quality <span className="normal-case tracking-normal text-slate-500">(DALL·E only)</span>
              </span>
              <div className="grid grid-cols-2 gap-2">
                {['standard', 'hd'].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setQuality(option)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                      quality === option
                        ? 'border-primary-500 bg-cyan-300/10 text-cyan-100'
                        : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}
                  >
                    {option === 'hd' ? 'HD (slower)' : 'Standard'}
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-4 text-xs text-slate-500">
              Ukuran di atas hanya permintaan ke provider. Provider gratis sering mengembalikan
              ukuran berbeda — resolusi aslinya ditampilkan pada hasil.
            </p>

            {error && (
              <div data-testid="error-message" className="alert alert-danger mt-4" role="alert">
                <p>{error}</p>
              </div>
            )}

            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              className="btn btn-primary mt-5 w-full py-3"
            >
              {generating ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" />
                  Generating...
                </>
              ) : (
                'Generate image'
              )}
            </button>
          </GlassPanel>

          <div className="space-y-5">
            {/* ------------------------------ Hasil terbaru ---------------------------- */}
            {result?.outputUrl && (
              <GlassPanel data-testid="latest-result" className="rise rise-1 p-5 sm:p-6">
                <SectionTitle action={<span className="chip chip-ok">baru</span>}>
                  Latest result
                </SectionTitle>

                <MediaImage
                  url={result.outputUrl}
                  alt={result.prompt}
                  className="w-full rounded-xl border border-white/10"
                />

                <p className="mt-3 text-sm text-slate-300">{result.prompt}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-500">
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
                  className="btn btn-ghost mt-4 text-xs"
                >
                  Download image
                </a>
              </GlassPanel>
            )}

            {/* --------------------------------- Riwayat ------------------------------- */}
            <GlassPanel className="rise rise-2 p-5 sm:p-6">
              <SectionTitle hint="12 gambar terakhir yang Anda buat.">Your generations</SectionTitle>

              {historyLoading ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="aspect-square animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]"
                    />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No images yet. Generate your first one above!
                </p>
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
                            {item.status === 'failed' ? 'Generation failed' : 'No preview'}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDelete(item.contentId)}
                          title="Delete"
                          aria-label="Hapus gambar"
                          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-ink-950/80 text-rose-300 transition-all hover:border-rose-400/50 hover:bg-rose-500/20 md:opacity-0 md:group-hover:opacity-100"
                        >
                          ×
                        </button>
                      </div>

                      <figcaption className="mt-2 line-clamp-2 text-xs text-slate-400">
                        {item.prompt}
                      </figcaption>
                      {/* Resolusi asli + provider yang dipakai, supaya riwayat tidak
                          menyembunyikan bahwa ukuran hasil bisa beda dari permintaan */}
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
        </div>
      </div>
    </Layout>
  )
}

export default TextToImagePage
