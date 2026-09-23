import { useState, useEffect, useRef } from 'react'
import { memberAPI, mediaAPI, resolveMediaUrl } from '../config/api'
import Layout from '../components/Layout'
import { GlassPanel, PageHeader, SectionTitle } from '../components/ui'

/**
 * Halaman sound-to-text: unggah berkas audio atau rekam langsung dari mikrofon,
 * lalu ubah menjadi teks.
 *
 * Dua keputusan yang menjelaskan bentuk halamannya:
 *
 * 1. Rekaman mikrofon DIKONVERSI ke WAV di browser sebelum dikirim. MediaRecorder
 *    menghasilkan WebM/Opus di Chrome dan Ogg di Firefox, dan Gemini (salah satu
 *    provider transkripsi) tidak menerima kedua format itu — tanpa konversi ini,
 *    user yang hanya punya GEMINI_API_KEY tidak akan pernah bisa merekam. WAV
 *    diterima ketiga provider, jadi hasil rekaman selalu bisa diproses.
 *
 * 2. Batas ukuran & format diambil dari backend (GET /media/transcribe-options),
 *    bukan ditulis ulang di sini. Dua daftar yang disimpan terpisah pasti
 *    menyimpang, dan yang terlihat oleh user adalah penolakan yang tidak masuk
 *    akal ("katanya boleh MP3, kok ditolak").
 */

const FALLBACK_LANGUAGES = [
  { value: 'id', label: 'Indonesia', hint: 'default' },
  { value: 'en', label: 'English', hint: 'Inggris' },
  { value: 'auto', label: 'Deteksi otomatis', hint: 'biar provider memilih' }
]

const FALLBACK_MAX_BYTES = 25 * 1024 * 1024
const FALLBACK_MAX_PROMPT = 500

// Batas panjang rekaman di sisi halaman. Batas kerasnya tetap ukuran berkas di
// server (25 MB); ini hanya supaya user tidak merekam 20 menit lalu ditolak di
// akhir. 4 menit mono 16-bit masih di bawah batas itu pada 44,1 maupun 48 kHz.
const MAX_RECORD_SECONDS = 240

/** Ubah AudioBuffer menjadi berkas WAV 16-bit mono. */
const encodeWav = (audioBuffer) => {
  const channels = audioBuffer.numberOfChannels
  const length = audioBuffer.length
  const sampleRate = audioBuffer.sampleRate

  // Campur semua kanal menjadi mono: provider tidak butuh stereo, dan berkasnya
  // jadi setengah ukuran.
  const samples = new Float32Array(length)
  for (let channel = 0; channel < channels; channel += 1) {
    const data = audioBuffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) samples[i] += data[i] / channels
  }

  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byteRate
  view.setUint16(32, 2, true) // blockAlign
  view.setUint16(34, 16, true) // bitsPerSample
  writeString(36, 'data')
  view.setUint32(40, length * 2, true)

  let offset = 44
  for (let i = 0; i < length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }

  return new Blob([view], { type: 'audio/wav' })
}

/**
 * Rekaman WebM/Ogg → berkas WAV.
 * Didekode lewat Web Audio API, jadi tidak ada dependency encoder baru.
 */
const recordingToWavFile = async (blob, name = 'rekaman.wav') => {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext

  if (!AudioContextClass) {
    throw new Error('Browser ini tidak mendukung pemrosesan audio. Unggah berkas audio saja.')
  }

  const context = new AudioContextClass()

  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    return new File([encodeWav(decoded)], name, { type: 'audio/wav' })
  } finally {
    // Context-nya hanya dipakai untuk mendekode; dibiarkan terbuka berarti
    // perangkat audio tetap sibuk.
    if (typeof context.close === 'function') await context.close()
  }
}

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read the file.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })

const formatBytes = (bytes) => {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const SoundToTextPage = ({ user, setUser }) => {
  const [audio, setAudio] = useState(null)
  const [audioError, setAudioError] = useState('')
  const [loadingAudio, setLoadingAudio] = useState(false)
  const [dragging, setDragging] = useState(false)

  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)

  const [language, setLanguage] = useState('id')
  const [languages, setLanguages] = useState(FALLBACK_LANGUAGES)
  const [prompt, setPrompt] = useState('')
  const [maxPrompt, setMaxPrompt] = useState(FALLBACK_MAX_PROMPT)
  const [maxBytes, setMaxBytes] = useState(FALLBACK_MAX_BYTES)
  const [acceptedFormats, setAcceptedFormats] = useState('')

  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [quota, setQuota] = useState(null)
  const [elapsed, setElapsed] = useState(0)

  const fileInputRef = useRef(null)
  const recorderRef = useRef(null)
  const recorderStreamRef = useRef(null)

  const remainingAudio = quota?.videoGeneration ?? null
  const outOfQuota = remainingAudio !== null && remainingAudio <= 0
  const canGenerate =
    Boolean(audio) && !transcribing && !recording && !loadingAudio && !outOfQuota

  const maxMb = Math.round(maxBytes / (1024 * 1024))

  useEffect(() => {
    fetchHistory()
    fetchQuota()
    fetchOptions()
  }, [])

  // Batas & bahasa dari backend. Kegagalannya tidak fatal: nilai cadangan di
  // atas tetap dipakai supaya halaman bisa dibuka walau endpoint itu tumbang.
  const fetchOptions = async () => {
    try {
      const response = await mediaAPI.getTranscribeOptions()

      if (Array.isArray(response.data.languages) && response.data.languages.length > 0) {
        setLanguages(response.data.languages)
      }

      if (response.data.defaultLanguage) setLanguage(response.data.defaultLanguage)
      if (response.data.maxPromptLength) setMaxPrompt(response.data.maxPromptLength)
      if (response.data.maxAudioBytes) setMaxBytes(response.data.maxAudioBytes)
      if (Array.isArray(response.data.acceptedFormats)) {
        setAcceptedFormats(response.data.acceptedFormats.join(' · ').toUpperCase())
      }
    } catch (err) {
      console.error('Failed to fetch transcribe options:', err)
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

  const fetchHistory = async () => {
    try {
      const response = await mediaAPI.getHistory({ type: 'sound-to-text', limit: 12 })
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

  // Panel "Latest result" adalah cermin riwayat: transkrip terbaru yang sudah
  // selesai selalu tampil di sana, termasuk tepat setelah halaman dibuka ulang
  // atau ketika respons POST-nya tidak pernah sampai ke browser.
  useEffect(() => {
    const terbaru = history.find((item) => item.status === 'completed' && item.metadata?.transcript)

    setResult((sebelumnya) =>
      sebelumnya?.contentId === terbaru?.contentId ? sebelumnya : terbaru || null
    )
  }, [history])

  // Riwayat diambil ulang berkala selama masih ada proses berjalan, supaya
  // halaman yang sempat dimuat ulang tetap menyusul hasilnya sendiri.
  const adaProses = transcribing || history.some((item) => item.status === 'processing')

  useEffect(() => {
    if (!adaProses) return undefined

    // Batas aman: kalau ada record yang tertinggal dalam status `processing`,
    // polling berhenti sendiri setelah ±5 menit.
    let sisa = 60
    const timer = setInterval(async () => {
      if (sisa-- <= 0) {
        clearInterval(timer)
        return
      }

      await fetchHistory()
      fetchQuota()
    }, 5000)

    return () => clearInterval(timer)
  }, [adaProses])

  // Penanda waktu selama transkripsi berjalan: tombol yang diam terlihat macet.
  useEffect(() => {
    if (!transcribing) {
      setElapsed(0)
      return undefined
    }

    const mulai = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - mulai) / 1000)), 1000)

    return () => clearInterval(timer)
  }, [transcribing])

  // Penanda waktu rekaman, sekaligus penghenti otomatis di MAX_RECORD_SECONDS.
  useEffect(() => {
    if (!recording) {
      setRecordSeconds(0)
      return undefined
    }

    const mulai = Date.now()
    const timer = setInterval(() => {
      const detik = Math.floor((Date.now() - mulai) / 1000)
      setRecordSeconds(detik)

      if (detik >= MAX_RECORD_SECONDS) recorderRef.current?.stop()
    }, 500)

    return () => clearInterval(timer)
  }, [recording])

  // Mikrofon harus dilepas saat halaman ditinggalkan: kalau tidak, indikator
  // rekam di browser tetap menyala dan perangkat audionya tetap terkunci.
  useEffect(
    () => () => {
      recorderRef.current?.stop()
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop())
    },
    []
  )

  const handleFile = async (file) => {
    if (!file) return

    setLoadingAudio(true)
    setAudioError('')
    setError('')

    try {
      if (!file.type.startsWith('audio/')) {
        throw new Error('Pilih berkas audio (WAV, MP3, M4A, OGG, FLAC, atau WEBM).')
      }

      if (file.size > maxBytes) {
        throw new Error(`Berkas terlalu besar (${formatBytes(file.size)}). Maksimal ${maxMb} MB.`)
      }

      const dataUrl = await readAsDataUrl(file)
      setAudio({ dataUrl, name: file.name, size: file.size })
    } catch (err) {
      setAudio(null)
      setAudioError(err.message)
    } finally {
      setLoadingAudio(false)
    }
  }

  const handleRecordToggle = async () => {
    if (recording) {
      // Tombol yang sama dipakai untuk berhenti; konversi ke WAV dikerjakan di
      // handler `onstop` di bawah.
      recorderRef.current?.stop()
      return
    }

    setAudioError('')
    setError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks = []
      const recorder = new MediaRecorder(stream)

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        recorderStreamRef.current = null
        setRecording(false)
        setLoadingAudio(true)

        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })

          if (blob.size === 0) throw new Error('Rekaman kosong. Coba rekam lagi.')

          const file = await recordingToWavFile(blob, `rekaman-${Date.now()}.wav`)
          await handleFile(file)
        } catch (err) {
          setAudio(null)
          setAudioError(
            `${err.message} Kalau ini terus terjadi, unggah berkas audio saja.`
          )
        } finally {
          setLoadingAudio(false)
        }
      }

      recorderStreamRef.current = stream
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (err) {
      console.error('Recording failed:', err)
      setAudioError(
        'Mikrofon tidak bisa dipakai. Izinkan akses mikrofon di browser, atau unggah berkas audio.'
      )
    }
  }

  const handleGenerate = async () => {
    if (!canGenerate) return

    setTranscribing(true)
    setError('')
    setCopied(false)

    try {
      const response = await mediaAPI.soundToText({
        audio: audio.dataUrl,
        language,
        prompt: prompt.trim()
      })

      setQuota(response.data.quota)
      // Hasilnya masuk daftar dulu; panel mengikutinya lewat efek cermin di atas.
      setHistory((items) => [
        response.data.media,
        ...items.filter((item) => item.contentId !== response.data.media.contentId)
      ])
    } catch (err) {
      console.error('Transcription failed:', err)

      // Respons yang gagal sampai ke browser TIDAK berarti transkripsinya gagal:
      // server menyimpan hasilnya lebih dulu. Riwayat diambil ulang supaya
      // transkrip yang benar-benar tersimpan tetap muncul.
      await fetchHistory()

      setError(
        err.response?.data?.message ||
          'Koneksi ke server terputus sebelum jawabannya diterima. Halaman ini ' +
            'memeriksa riwayat secara berkala, jadi transkrip yang sudah tersimpan ' +
            'tetap muncul di bawah tanpa perlu memuat ulang.'
      )
    } finally {
      setTranscribing(false)
    }
  }

  const handleDelete = async (contentId) => {
    if (!window.confirm('Delete this transcription?')) return

    try {
      await mediaAPI.deleteMedia(contentId)
      setHistory((items) => items.filter((item) => item.contentId !== contentId))
    } catch (err) {
      console.error('Delete failed:', err)
      setError('Failed to delete transcription.')
    }
  }

  const transcriptOf = (item) => item?.metadata?.transcript || item?.prompt || ''

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
      setError('Clipboard tidak bisa dipakai di browser ini. Pilih teksnya manual ya.')
    }
  }

  const handleDownloadTranscript = (item) => {
    const blob = new Blob([transcriptOf(item)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `${item.contentId || 'transcript'}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-5">
        <PageHeader
          eyebrow="alat 06 · audio"
          title="Sound to Text"
          description="Unggah berkas audio atau rekam langsung dari mikrofon, lalu AI akan menuliskannya menjadi teks."
          actions={
            remainingAudio !== null && (
              <div className="glass-panel flex items-center gap-3 px-4 py-2.5">
                <span className="hud">sisa audio</span>
                <span data-testid="transcript-quota" className="font-mono text-xl font-semibold text-cyan-300">
                  {remainingAudio}
                </span>
              </div>
            )
          }
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* ------------------------------ Sumber audio ----------------------------- */}
          <GlassPanel className="rise h-fit p-5 sm:p-6 lg:sticky lg:top-24">
            <SectionTitle hint="Rekaman dari mikrofon dikonversi ke WAV otomatis sebelum dikirim.">
              Audio source
            </SectionTitle>

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
              {audio ? (
                <div onClick={(event) => event.stopPropagation()}>
                  <audio
                    data-testid="input-preview"
                    src={audio.dataUrl}
                    controls
                    className="w-full"
                  />
                </div>
              ) : (
                <div className="py-8">
                  <p className="text-sm text-slate-300">
                    {loadingAudio
                      ? 'Menyiapkan audio…'
                      : 'Klik atau jatuhkan berkas audio di sini'}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-slate-500">
                    {acceptedFormats || 'WAV · MP3 · M4A · OGG · FLAC · WEBM'} · maks {maxMb} MB
                  </p>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              data-testid="file-input"
              className="hidden"
              onChange={(event) => {
                handleFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />

            {audio && (
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="truncate font-mono text-[10px] text-slate-500">
                  {audio.name} · {formatBytes(audio.size)}
                </p>
                <button
                  type="button"
                  onClick={() => setAudio(null)}
                  className="text-[10px] text-slate-400 underline decoration-dotted hover:text-slate-200"
                >
                  ganti
                </button>
              </div>
            )}

            {navigator.mediaDevices?.getUserMedia && (
              <button
                type="button"
                data-testid="record-button"
                onClick={handleRecordToggle}
                disabled={loadingAudio && !recording}
                className={`mt-3 w-full rounded-xl border px-4 py-3 text-sm font-medium transition-all duration-200 ${
                  recording
                    ? 'border-rose-400/50 bg-rose-500/15 text-rose-100'
                    : 'border-white/15 bg-white/[0.03] text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-300/[0.07]'
                }`}
              >
                {recording ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-400" />
                    Stop recording · {recordSeconds}s
                  </span>
                ) : (
                  '🎙️ Rekam dari mikrofon'
                )}
              </button>
            )}

            {audioError && <p data-testid="audio-error" className="mt-2 text-xs text-rose-300">{audioError}</p>}

            <div className="mt-5">
              <label htmlFor="language" className="hud mb-2 block">
                bahasa
              </label>
              <select
                id="language"
                data-testid="language-select"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="field"
              >
                {languages.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.hint})
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-5">
              <label htmlFor="prompt" className="hud mb-2 block">
                konteks{' '}
                <span className="normal-case tracking-normal text-slate-500">(opsional)</span>
              </label>
              <input
                id="prompt"
                data-testid="prompt-input"
                type="text"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={maxPrompt}
                placeholder="nama orang atau istilah yang sulit, mis. Aritonang, neural network"
                className="field"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Isi kolom ini kalau ada nama atau istilah yang sering salah dengar.
              </p>
            </div>

            {outOfQuota && (
              <p className="mt-4 text-xs text-rose-300">
                Audio quota exhausted. Ask an admin to increase it before transcribing more audio.
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
              {transcribing ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" />
                  Transcribing... {elapsed}s
                </>
              ) : (
                'Transcribe audio'
              )}
            </button>

            {transcribing && (
              <p data-testid="generate-progress" className="mt-3 text-xs text-slate-500">
                Transkripsi biasanya selesai dalam hitungan detik sampai satu menit. Biarkan
                halaman ini terbuka — hasilnya tersimpan di server dan akan muncul sendiri di
                sini, jadi tidak perlu memuat ulang.
              </p>
            )}
          </GlassPanel>

          <div className="space-y-5">
            {/* ------------------------------ Hasil terbaru ---------------------------- */}
            {result?.metadata?.transcript && (
              <GlassPanel data-testid="latest-result" className="rise rise-1 p-5 sm:p-6">
                <SectionTitle action={<span className="chip chip-ok">baru</span>}>
                  Latest result
                </SectionTitle>

                <div className="glass-inset p-4">
                  <p
                    data-testid="transcript-output"
                    className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-100"
                  >
                    {transcriptOf(result)}
                  </p>
                </div>

                <p className="mt-3 font-mono text-[11px] text-slate-500">
                  {result.metadata?.duration ? `${result.metadata.duration}s · ` : ''}
                  {result.metadata?.format?.toUpperCase()}
                  {result.metadata?.language ? ` · ${result.metadata.language}` : ''}
                  {result.metadata?.provider ? ` · via ${result.metadata.provider}` : ''}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="copy-button"
                    onClick={() => handleCopy(transcriptOf(result))}
                    className="btn btn-ghost text-xs"
                  >
                    {copied ? 'Tersalin ✓' : 'Copy text'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadTranscript(result)}
                    className="btn btn-ghost text-xs"
                  >
                    Download .txt
                  </button>
                </div>

                {result.inputFile && (
                  <div className="mt-4">
                    <span className="hud mb-1.5 block">audio sumber</span>
                    <audio
                      data-testid="result-audio"
                      src={resolveMediaUrl(result.inputFile)}
                      controls
                      className="w-full"
                    />
                  </div>
                )}
              </GlassPanel>
            )}

            {/* --------------------------------- Riwayat ------------------------------- */}
            <GlassPanel className="rise rise-2 p-5 sm:p-6">
              <SectionTitle hint="12 transkripsi terakhir Anda.">Your transcriptions</SectionTitle>

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
                  No transcriptions yet. Upload or record audio above!
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
                        {item.inputFile ? (
                          <audio
                            data-testid="history-audio"
                            src={resolveMediaUrl(item.inputFile)}
                            controls
                            preload="metadata"
                            className="w-full"
                          />
                        ) : (
                          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-center text-xs text-rose-200">
                            {item.status === 'failed'
                              ? 'Transcription failed'
                              : item.status === 'processing'
                                ? 'Transcribing...'
                                : 'No audio'}
                          </div>
                        )}

                        {item.status === 'completed' ? (
                          <p className="mt-2 line-clamp-3 text-xs text-slate-300">
                            {transcriptOf(item)}
                          </p>
                        ) : (
                          item.status === 'failed' && (
                            <p className="mt-2 line-clamp-2 text-xs text-rose-200">
                              {item.error?.message || 'Transcription failed'}
                            </p>
                          )
                        )}

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
                        aria-label="Hapus transkripsi"
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

export default SoundToTextPage
