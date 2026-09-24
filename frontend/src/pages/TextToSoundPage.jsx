import { useState, useEffect } from 'react'
import { memberAPI, mediaAPI, resolveMediaUrl } from '../config/api'
import Layout from '../components/Layout'
import MediaAudio from '../components/MediaAudio'
import { GlassPanel, PageHeader, SectionTitle } from '../components/ui'

// Cadangan kalau GET /media/sound-voices tidak bisa dihubungi. Daftar yang
// benar-benar ditampilkan datang dari backend (config/soundProviders.js),
// karena providernya bisa ditukar lewat env — dan tiap provider memakai nama
// voice yang sama sekali berbeda. Yang dipakai sebagai cadangan adalah suara
// Indonesia milik provider default tanpa kunci (Edge), karena itulah yang
// melayani permintaan kalau tidak ada kredensial apa pun yang diisi.
const FALLBACK_VOICES = [
  { value: 'id-ID-GadisNeural', label: 'Gadis', hint: 'wanita ID' },
  { value: 'id-ID-ArdiNeural', label: 'Ardi', hint: 'pria ID' }
]

// Cadangan kalau GET /media/sound-voices tidak bisa dihubungi. Format yang sah
// bergantung provider: Gemini TTS hanya menghasilkan WAV (PCM yang dibungkus),
// Edge hanya MP3, sedangkan ElevenLabs/OpenAI bisa keduanya.
const FALLBACK_FORMATS = [
  { value: 'wav', label: 'WAV', hint: 'kualitas penuh' },
  { value: 'mp3', label: 'MP3', hint: 'berkas kecil' }
]

const LABEL_FORMAT = {
  wav: { label: 'WAV', hint: 'kualitas penuh' },
  mp3: { label: 'MP3', hint: 'berkas kecil' }
}

const MAX_TEXT_LENGTH = 2000
const MAX_STYLE_LENGTH = 300

const TextToSoundPage = ({ user, setUser }) => {
  const [text, setText] = useState('')
  const [voices, setVoices] = useState(FALLBACK_VOICES)
  const [voice, setVoice] = useState(FALLBACK_VOICES[0].value)
  const [style, setStyle] = useState('')
  const [format, setFormat] = useState(FALLBACK_FORMATS[0].value)
  const [formats, setFormats] = useState(FALLBACK_FORMATS)
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
    fetchVoices()
  }, [])

  // Daftar voice diambil dari backend supaya dropdown tidak pernah menawarkan
  // nilai yang pasti ditolak provider yang aktif (dan tidak perlu dijaga manual
  // setiap kali provider ditukar). Kegagalannya tidak fatal: daftar cadangan
  // tetap dipakai supaya halaman tidak menampilkan dropdown kosong.
  const fetchVoices = async () => {
    try {
      const response = await mediaAPI.getSoundVoices()
      const daftar = response.data.voices

      if (!Array.isArray(daftar) || daftar.length === 0) return

      setVoices(daftar)

      // Format yang sah ikut provider yang aktif; pilihan yang sedang dipakai
      // dipindahkan kalau providernya ternyata tidak sanggup menghasilkannya
      // (mis. Gemini TTS + MP3).
      const daftarFormat = (response.data.formats || [])
        .map((value) => ({ value, ...(LABEL_FORMAT[value] || { label: value.toUpperCase() }) }))

      if (daftarFormat.length > 0) {
        const bawaan = response.data.defaultFormat

        setFormats(daftarFormat)
        setFormat((sebelumnya) => {
          if (daftarFormat.some((option) => option.value === sebelumnya)) return sebelumnya
          // Format bawaan provider dipakai lebih dulu daripada urutan daftar:
          // provider yang hanya sanggup satu format tidak selalu menaruhnya di
          // depan, dan memilih yang salah berarti permintaannya ditolak 400.
          return daftarFormat.some((option) => option.value === bawaan)
            ? bawaan
            : daftarFormat[0].value
        })
      }
      // Pilihan yang sedang aktif tidak boleh hilang saat daftarnya diganti.
      setVoice((sebelumnya) =>
        daftar.some((option) => option.value === sebelumnya)
          ? sebelumnya
          : response.data.defaultVoice || daftar[0].value
      )
    } catch (err) {
      console.error('Failed to fetch sound voices:', err)
    }
  }

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

  // Panel "Latest result" adalah CERMIN riwayat: audio terbaru yang berkasnya
  // sudah ada selalu tampil di panel.
  //
  // Sebelumnya panel hanya diisi oleh respons POST dan oleh polling selama
  // prosesnya masih berjalan. Begitu keduanya tidak sampai ke browser — respons
  // putus di tengah jalan, koneksinya tersendat, atau halaman sempat dimuat
  // ulang — audionya cuma muncul di daftar "Your generations" sementara panelnya
  // kosong sampai user memuat ulang halaman; itulah yang dilaporkan sebagai
  // "harus refresh dulu baru hasilnya keluar". Dengan satu sumber kebenaran ini,
  // apa pun yang sudah terlihat di riwayat otomatis terlihat di panel, termasuk
  // tepat setelah halaman dibuka, tanpa menekan generate lagi.
  useEffect(() => {
    const terbaru = history.find((item) => item.outputUrl)

    // Dibandingkan lewat contentId supaya objek yang sama tidak dipasang ulang
    // di setiap putaran. `terbaru` null berarti tidak ada audio yang bisa
    // diputar (mis. hasilnya baru saja dihapus) — panelnya ikut dikosongkan.
    setResult((sebelumnya) =>
      sebelumnya?.contentId === terbaru?.contentId ? sebelumnya : terbaru || null
    )
  }, [history])

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

      // Panelnya tidak diisi di sini: `setHistory` di dalam fetchHistory sudah
      // memicunya lewat efek cermin di atas, memakai satu aturan yang sama.
      await fetchHistory()

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

      setQuota(response.data.quota)
      // Hasilnya masuk daftar dulu; panel mengikutinya lewat efek cermin di atas.
      setHistory((items) => [
        response.data.media,
        ...items.filter((item) => item.contentId !== response.data.media.contentId)
      ])
    } catch (err) {
      console.error('Speech generation failed:', err)

      // Respons yang gagal sampai ke browser TIDAK berarti audionya gagal:
      // server menyimpan hasilnya lebih dulu, dan permintaan bisa putus setelah
      // itu. Riwayat diambil ulang supaya audio yang benar-benar tersimpan tetap
      // muncul — di daftar maupun di panel (lihat efek cermin di atas) — bukan
      // hanya kotak error yang menyuruh menekan tombol lagi.
      await fetchHistory()

      // Pesan dari server dipakai apa adanya: di situ ada penjelasan yang bisa
      // ditindaklanjuti (mis. "Text-to-sound dimatikan di server"). Kalau
      // permintaannya putus sebelum server menjawab, `err.message` hanya berisi
      // kalimat teknis axios ("Network Error", "timeout of 180000ms exceeded")
      // yang menyesatkan: hasilnya seringkali sudah tersimpan, jadi yang
      // dijelaskan adalah apa yang sedang terjadi, bukan seolah sintesisnya gagal.
      setError(
        err.response?.data?.message ||
          'Koneksi ke server terputus sebelum jawabannya diterima. Halaman ini ' +
            'memeriksa riwayat secara berkala, jadi audio yang sudah tersimpan ' +
            'tetap muncul di bawah tanpa perlu memuat ulang.'
      )
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = async (contentId) => {
    if (!window.confirm('Delete this audio?')) return

    try {
      await mediaAPI.deleteMedia(contentId)
      // Panelnya tidak perlu dikosongkan sendiri: efek cermin mengikuti daftar
      // ini, jadi panel otomatis menampilkan audio terbaru yang masih ada — atau
      // kosong kalau memang tidak ada sisa audionya.
      setHistory((items) => items.filter((item) => item.contentId !== contentId))
    } catch (err) {
      console.error('Delete failed:', err)
      setError('Failed to delete audio.')
    }
  }

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-5">
        <PageHeader
          eyebrow="alat 07 · audio"
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
                className="field"
              >
                {voices.map((option) => (
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
                Isi kolom ini untuk mengatur gaya bicara (contoh: “hangat, santai,
                tempo lambat”). Voice di atas tetap dipakai.
              </p>
            </div>

            <div className="mt-5">
              <span className="hud mb-2 block">format</span>
              <div className="grid grid-cols-2 gap-2">
                {formats.map((option) => (
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
                  {result.metadata?.voice ? ` · voice ${result.metadata.voice}` : ''}
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
