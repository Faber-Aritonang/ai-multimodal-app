import { useState, useEffect } from 'react'
import { memberAPI, mediaAPI, resolveMediaUrl } from '../config/api'
import Layout from '../components/Layout'
import MediaAudio from '../components/MediaAudio'
import { GlassPanel, PageHeader, SectionTitle } from '../components/ui'

// Voice bawaan model `mimo-v2.5-tts`. Daftar ini harus sama dengan yang
// divalidasi backend (config/soundProviders.js) — nilai yang tidak dikenal
// dijawab 400 dengan daftar yang benar.
const VOICES = [
  { value: 'mimo_default', label: 'Default', hint: 'netral' },
  { value: 'Mia', label: 'Mia', hint: 'female' },
  { value: 'Chloe', label: 'Chloe', hint: 'female' },
  { value: 'Milo', label: 'Milo', hint: 'male' },
  { value: 'Dean', label: 'Dean', hint: 'male' },
  { value: '冰糖', label: '冰糖', hint: '中文' },
  { value: '茉莉', label: '茉莉', hint: '中文' },
  { value: '苏打', label: '苏打', hint: '中文' },
  { value: '白桦', label: '白桦', hint: '中文' }
]

const FORMATS = [
  { value: 'wav', label: 'WAV', hint: 'kualitas penuh' },
  { value: 'mp3', label: 'MP3', hint: 'berkas kecil' }
]

const MAX_TEXT_LENGTH = 2000
const MAX_STYLE_LENGTH = 300

const TextToSoundPage = ({ user, setUser }) => {
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('mimo_default')
  const [style, setStyle] = useState('')
  const [format, setFormat] = useState('wav')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [quota, setQuota] = useState(null)
  const [elapsed, setElapsed] = useState(0)

  const remainingAudio = quota?.videoGeneration ?? null
  const outOfQuota = remainingAudio !== null && remainingAudio <= 0
  const canGenerate = text.trim().length > 0 && !generating && !outOfQuota

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

  // Dijalankan juga setiap kali sintesis selesai atau gagal, karena server bisa
  // sudah menyimpan audionya walaupun responsnya tidak pernah sampai ke browser.
  // Hasil terbaru dikembalikan supaya pemanggilnya bisa memakainya.
  const fetchHistory = async () => {
    try {
      const response = await mediaAPI.getHistory({ type: 'text-to-sound', limit: 12 })
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
  // Kasus yang ditangani sama dengan fitur gambar: respons sintesis bisa tidak
  // sampai ke browser (koneksi putus, atau halaman dimuat ulang di tengah proses)
  // padahal server tetap menyimpan hasilnya. Tanpa polling ini user melihat tidak
  // ada apa-apa sampai dia memuat ulang halaman.
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
      // Hanya record TERBARU yang dipakai supaya hasil lama tidak terangkat ke
      // panel "Latest result" selama permintaan baru masih diproses.
      const terbaru = items?.[0]

      if (terbaru?.outputUrl) {
        setResult((sebelumnya) => (sebelumnya?.contentId === terbaru.contentId ? sebelumnya : terbaru))
      }

      // Kuota dikurangi server setelah hasilnya tersimpan, jadi angkanya baru
      // benar kalau ikut diambil ulang.
      fetchQuota()
    }, 5000)

    return () => clearInterval(timer)
  }, [adaProses])

  // Tanpa penanda waktu, tombol yang diam terlihat seperti macet dan user memuat
  // ulang halaman di tengah proses — permintaan ikut batal, padahal server tetap
  // menuntaskannya.
  useEffect(() => {
    if (!generating) {
      setElapsed(0)
      return undefined
    }

    const mulai = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - mulai) / 1000)), 1000)

    return () => clearInterval(timer)
  }, [generating])

  const handleGenerate = async () => {
    if (!canGenerate) return

    setGenerating(true)
    setError('')

    try {
      const response = await mediaAPI.textToSound({
        text: text.trim(),
        voice,
        style: style.trim(),
        format
      })

      setResult(response.data.media)
      setQuota(response.data.quota)
      setHistory((items) => [
        response.data.media,
        ...items.filter((item) => item.contentId !== response.data.media.contentId)
      ])
    } catch (err) {
      console.error('Speech generation failed:', err)

      // Respons yang gagal sampai ke browser TIDAK berarti audionya gagal:
      // server menyimpan hasilnya lebih dulu, dan permintaan bisa putus setelah
      // itu. Riwayat diambil ulang supaya audio yang benar-benar tersimpan tetap
      // muncul, bukan hanya kotak error yang menyuruh menekan tombol lagi.
      const items = await fetchHistory()
      const tersimpan = items?.[0]

      if (tersimpan?.outputUrl) setResult(tersimpan)

      setError(
        err.response?.data?.message ||
          err.message ||
          'Failed to generate sound. Please try again.'
      )
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = async (contentId) => {
    if (!window.confirm('Delete this audio?')) return

    try {
      await mediaAPI.deleteMedia(contentId)
      setHistory((items) => items.filter((item) => item.contentId !== contentId))
      if (result?.contentId === contentId) setResult(null)
    } catch (err) {
      console.error('Delete failed:', err)
      setError('Failed to delete audio.')
    }
  }

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-5">
        <PageHeader
          eyebrow="alat 05 · audio"
          title="Text to Sound"
          description="Tuliskan teks yang ingin diucapkan, pilih suaranya, lalu AI akan membacakannya."
          actions={
            remainingAudio !== null && (
              <div className="glass-panel flex items-center gap-3 px-4 py-2.5">
                <span className="hud">sisa audio</span>
                <span data-testid="sound-quota" className="font-mono text-xl font-semibold text-cyan-300">
                  {remainingAudio}
                </span>
              </div>
            )
          }
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* ------------------------------- Formulir ------------------------------- */}
          <GlassPanel className="rise h-fit p-5 sm:p-6 lg:sticky lg:top-24">
            <SectionTitle hint="Teks yang Anda tulis akan diucapkan apa adanya.">
              Text
            </SectionTitle>

            <textarea
              id="text"
              data-testid="text-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleGenerate()
                }
              }}
              maxLength={MAX_TEXT_LENGTH}
              rows={4}
              placeholder="Selamat pagi! Ini contoh suara yang dihasilkan dari teks."
              className="field resize-none"
            />
            <p className="mt-1.5 font-mono text-[10px] text-slate-500">
              {text.length}/{MAX_TEXT_LENGTH} characters · Ctrl/⌘ + Enter to generate
            </p>

            <div className="mt-5">
              <label htmlFor="voice" className="hud mb-2 block">
                voice
              </label>
              <select
                id="voice"
                data-testid="voice-select"
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                disabled={style.trim().length > 0}
                className="field disabled:cursor-not-allowed disabled:opacity-50"
              >
                {VOICES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.hint})
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-5">
              <label htmlFor="style" className="hud mb-2 block">
                voice style{' '}
                <span className="normal-case tracking-normal text-slate-500">(opsional)</span>
              </label>
              <input
                id="style"
                data-testid="style-input"
                type="text"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                maxLength={MAX_STYLE_LENGTH}
                placeholder="suara pria muda yang hangat dan santai"
                className="field"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Isi kolom ini untuk membuat suara baru dari deskripsi — pilihan voice di atas
                diabaikan karena provider memakai model voice design.
              </p>
            </div>

            <div className="mt-5">
              <span className="hud mb-2 block">format</span>
              <div className="grid grid-cols-2 gap-2">
                {FORMATS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    data-testid={`format-${option.value}`}
                    onClick={() => setFormat(option.value)}
                    className={`rounded-xl border px-3 py-2.5 text-center text-sm transition-all duration-200 ${
                      // `border-primary-500` sengaja dipertahankan: spec browser
                      // mendeteksi pilihan aktif lewat kelas itu.
                      format === option.value
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

            {outOfQuota && (
              <p className="mt-4 text-xs text-rose-300">
                Audio quota exhausted. Ask an admin to increase it before generating more sound.
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
                'Generate sound'
              )}
            </button>

            {generating && (
              <p data-testid="generate-progress" className="mt-3 text-xs text-slate-500">
                Sintesis suara bisa butuh 10-40 detik. Biarkan halaman ini terbuka —
                hasilnya tersimpan di server dan akan muncul sendiri di sini, jadi tidak
                perlu memuat ulang.
              </p>
            )}
          </GlassPanel>

          <div className="space-y-5">
            {/* ------------------------------ Hasil terbaru ---------------------------- */}
            {result?.outputUrl && (
              <GlassPanel data-testid="latest-result" className="rise rise-1 p-5 sm:p-6">
                <SectionTitle action={<span className="chip chip-ok">baru</span>}>
                  Latest result
                </SectionTitle>

                <MediaAudio url={result.outputUrl} className="rounded-xl border border-white/10 bg-ink-950/40 p-2" />

                <p className="mt-3 text-sm text-slate-300">{result.prompt}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-500">
                  {/* Durasi hanya terbaca dari header WAV; untuk MP3 tidak ditampilkan. */}
                  {result.metadata?.duration ? `${result.metadata.duration}s · ` : ''}
                  {result.metadata?.format?.toUpperCase()}
                  {result.metadata?.voice
                    ? ` · voice ${result.metadata.voice}`
                    : result.metadata?.style
                      ? ` · voice design: ${result.metadata.style}`
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
                  Download audio
                </a>
              </GlassPanel>
            )}

            {/* --------------------------------- Riwayat ------------------------------- */}
            <GlassPanel className="rise rise-2 p-5 sm:p-6">
              <SectionTitle hint="12 audio terakhir yang Anda buat.">Your generations</SectionTitle>

              {historyLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-16 animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]"
                    />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No audio yet. Generate your first one above!
                </p>
              ) : (
                <ul className="space-y-3">
                  {history.map((item) => (
                    <li
                      key={item.contentId}
                      data-testid="history-item"
                      className="glass-inset flex items-start gap-3 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        {item.outputUrl ? (
                          <MediaAudio url={item.outputUrl} compact />
                        ) : (
                          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-center text-xs text-rose-200">
                            {item.status === 'failed'
                              ? 'Generation failed'
                              : item.status === 'processing'
                                ? 'Generating...'
                                : 'No preview'}
                          </div>
                        )}

                        <p className="mt-2 line-clamp-2 text-xs text-slate-400">{item.prompt}</p>
                        {(item.metadata?.format || item.metadata?.provider) && (
                          <p className="mt-1 font-mono text-[10px] text-slate-500">
                            {item.metadata?.duration ? `${item.metadata.duration}s · ` : ''}
                            {item.metadata?.format?.toUpperCase()}
                            {item.metadata?.provider ? ` · via ${item.metadata.provider}` : ''}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDelete(item.contentId)}
                        title="Delete"
                        aria-label="Hapus audio"
                        className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-white/15 bg-ink-950/80 text-rose-300 transition-all hover:border-rose-400/50 hover:bg-rose-500/20"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default TextToSoundPage
