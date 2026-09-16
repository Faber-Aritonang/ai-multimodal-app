import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { memberAPI } from '../config/api'
import Layout from '../components/Layout'
import { SendIcon } from '../components/icons'

// Renderer markdown (+ remark-gfm) berat (±160 kB mentah). Halaman chat berada
// di balik login, jadi pustakanya dimuat terpisah agar tidak membebani bundel
// awal aplikasi. Selama chunk-nya dimuat, teks balasan tampil apa adanya.
const MarkdownMessage = lazy(() => import('../components/MarkdownMessage'))

const ChatPage = ({ user, setUser }) => {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [currentSession, setCurrentSession] = useState(null)
  const [sessions, setSessions] = useState([])
  const [quota, setQuota] = useState(null)
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [typing, setTyping] = useState(false)
  const messagesEndRef = useRef(null)
  // Penjaga agar satu kunjungan ke /chat tidak membuat dua sesi.
  // React StrictMode (development) menjalankan effect dua kali; tanpa ini
  // setiap kunjungan meninggalkan satu sesi kosong di riwayat user.
  const creatingSessionRef = useRef(false)

  // Sisa kuota chat: null selama belum diketahui (jangan menebak "0"), 0 = habis.
  const chatQuotaLeft = quota?.chat ?? null
  const outOfQuota = chatQuotaLeft !== null && chatQuotaLeft <= 0

  useEffect(() => {
    fetchSessions()

    if (sessionId) {
      // Ada session di URL: buka pembuatan sesi berikutnya (tombol "+ New Chat")
      creatingSessionRef.current = false
      fetchSession(sessionId)
      return
    }

    if (creatingSessionRef.current) return
    creatingSessionRef.current = true
    createNewSession()
  }, [sessionId])

  useEffect(() => {
    fetchQuota()
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [currentSession?.messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const fetchSessions = async () => {
    try {
      const response = await memberAPI.getChatSessions()
      setSessions(response.data.sessions || [])
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
    }
  }

  const fetchQuota = async () => {
    try {
      const response = await memberAPI.getQuota()
      setQuota(response.data.quota)
    } catch (error) {
      console.error('Failed to fetch quota:', error)
    }
  }

  const fetchSession = async (sid) => {
    try {
      const response = await memberAPI.getChatSession(sid)
      setCurrentSession(response.data.session)
    } catch (error) {
      console.error('Failed to fetch session:', error)
      if (error.response?.status === 404) {
        navigate('/chat')
      }
    }
  }

  const createNewSession = async () => {
    try {
      const response = await memberAPI.createChatSession()
      const newSession = response.data.session
      setCurrentSession(newSession)
      navigate(`/chat/${newSession.sessionId}`)
      fetchSessions()
    } catch (error) {
      console.error('Failed to create session:', error)
    }
  }

  const deleteSession = async (sid) => {
    try {
      await memberAPI.deleteChatSession(sid)
      setSessions(sessions.filter(s => s.sessionId !== sid))
      if (currentSession?.sessionId === sid) {
        createNewSession()
      }
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !currentSession || loading || outOfQuota) return

    setLoading(true)
    setTyping(true)

    // Tambahkan pesan user ke UI secara optimis (optimistic)
    const userMessage = {
      role: 'user',
      content: inputValue,
      timestamp: new Date().toISOString()
    }

    const updatedSession = {
      ...currentSession,
      messages: [...currentSession.messages, userMessage]
    }
    setCurrentSession(updatedSession)
    setInputValue('')

    try {
      const response = await memberAPI.sendMessage(
        currentSession.sessionId,
        inputValue
      )

      if (response.data.success) {
        setCurrentSession(response.data.session)
        // Kuota terbaru dari server, jadi badge tidak perlu refresh manual
        if (response.data.quota) setQuota(response.data.quota)
      } else {
        setTyping(false)
      }
    } catch (error) {
      console.error('Failed to send message:', error)

      // Backend mengirim pesan spesifik (mis. provider belum dikonfigurasi atau
      // kuota habis) dan menyertakan sesi terbaru — pesan user sudah tersimpan
      // di sana, jadi pakai itu agar UI tidak menampilkan percakapan ganda.
      const detail = error.response?.data?.message
      const reason = error.response?.data?.error

      // Respons gagal pun menyertakan kuota terbaru (kuota tidak berkurang saat
      // provider gagal), jadi badge di header tetap akurat setelah error.
      if (error.response?.data?.quota) setQuota(error.response.data.quota)
      const baseSession = error.response?.data?.session || updatedSession

      // Alasan teknis (mis. "groq: 429 rate limit") ditampilkan supaya mudah
      // didiagnosis, tapi disaring dulu agar kunci API tidak pernah muncul di UI.
      const safeReason =
        typeof reason === 'string' &&
        reason !== detail &&
        !/(gsk_|AIza|sk-[A-Za-z0-9]{12,})/.test(reason)
          ? reason
          : null

      const errorMessage = {
        role: 'assistant',
        content: detail
          ? `⚠️ ${detail}${safeReason ? `\n(${safeReason})` : ''}`
          : '⚠️ Failed to get response. Please try again.',
        timestamp: new Date().toISOString()
      }

      setCurrentSession({
        ...baseSession,
        messages: [...baseSession.messages, errorMessage]
      })
    } finally {
      setLoading(false)
      setTyping(false)
    }
  }

  const startNewChat = () => {
    navigate('/chat')
  }

  const isActiveSession = (session) => session.sessionId === currentSession?.sessionId

  /**
   * Daftar riwayat sesi. Dipakai dua kali dengan bentuk berbeda: panel penuh di
   * layar lebar, dan strip gulir horizontal di layar sempit — supaya navigasi
   * tetap terjangkau tanpa harus menyembunyikan riwayat.
   */
  const SessionList = ({ variant = 'panel' }) => {
    if (sessions.length === 0) {
      return (
        <p className={`text-center text-xs text-slate-500 ${variant === 'panel' ? 'p-6' : 'py-3'}`}>
          Belum ada percakapan
        </p>
      )
    }

    if (variant === 'strip') {
      return (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {sessions.map((session) => (
            <button
              key={session.sessionId}
              type="button"
              onClick={() => navigate(`/chat/${session.sessionId}`)}
              className={`flex-shrink-0 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                isActiveSession(session)
                  ? 'border-cyan-300/35 bg-cyan-300/10 text-cyan-100'
                  : 'border-white/10 bg-white/[0.03] text-slate-400'
              }`}
            >
              <span className="block max-w-[10rem] truncate font-medium">
                {session.title || 'New Chat'}
              </span>
              <span className="text-[10px] text-slate-500">
                {new Date(session.updatedAt).toLocaleDateString()}
              </span>
            </button>
          ))}
        </div>
      )
    }

    return (
      <div className="space-y-1.5">
        {sessions.map((session) => (
          <button
            key={session.sessionId}
            type="button"
            onClick={() => navigate(`/chat/${session.sessionId}`)}
            className={`w-full rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ${
              isActiveSession(session)
                ? 'border-cyan-300/30 bg-cyan-300/[0.08] text-white'
                : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.05] hover:text-slate-100'
            }`}
          >
            <p className="truncate text-sm font-medium">{session.title || 'New Chat'}</p>
            <p className="mt-0.5 font-mono text-[10px] text-slate-500">
              {new Date(session.updatedAt).toLocaleDateString()}
            </p>
          </button>
        ))}
      </div>
    )
  }

  return (
    <Layout user={user} setUser={setUser}>
      {/* `grid-cols-1` (bukan sekadar grid) dipakai karena kolom implisit berukuran
          `auto`: strip riwayat yang bisa digulir akan melebarkan kolomnya sampai
          halaman ikut meluber ke samping. `grid-cols-1` = minmax(0, 1fr). */}
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Riwayat percakapan (layar lebar) */}
        <aside className="glass-panel hidden flex-col overflow-hidden md:flex md:max-h-[calc(100vh-11rem)]">
          <div className="flex items-center justify-between border-b border-white/[0.06] p-4">
            <div>
              <p className="hud">riwayat</p>
              <p className="text-sm font-semibold text-slate-200">Chat History</p>
            </div>
            <button type="button" onClick={startNewChat} className="btn btn-primary px-3 py-1.5 text-xs">
              + New
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            <SessionList />
          </div>

          <div className="border-t border-white/[0.06] p-3">
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-100"
            >
              Profile &amp; Settings
            </button>
          </div>
        </aside>

        {/* Riwayat percakapan (layar sempit): strip gulir di atas chat */}
        <div className="glass-panel min-w-0 p-3 md:hidden">
          <div className="mb-2 flex items-center justify-between">
            <p className="hud">riwayat</p>
            <button type="button" onClick={startNewChat} className="btn btn-ghost px-3 py-1 text-xs">
              + New Chat
            </button>
          </div>
          <SessionList variant="strip" />
        </div>

        {/* Area percakapan */}
        <section className="glass-panel flex h-[calc(100vh-16rem)] min-h-[24rem] min-w-0 flex-col overflow-hidden md:h-[calc(100vh-11rem)]">
          <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] p-4">
            <div className="min-w-0">
              <p className="hud">percakapan</p>
              <h1 className="truncate text-sm font-semibold text-slate-100">
                {currentSession?.title || 'New Chat'}
              </h1>
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              {/* Kuota selalu terlihat supaya user tidak kaget saat habis */}
              {chatQuotaLeft !== null && (
                <span
                  data-testid="chat-quota"
                  className={`chip ${outOfQuota ? 'chip-danger' : ''}`}
                  title="Chat messages left in your quota"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${outOfQuota ? 'bg-rose-400' : 'bg-cyan-400'}`} />
                  {chatQuotaLeft} {chatQuotaLeft === 1 ? 'message' : 'messages'} left
                </span>
              )}

              {currentSession?.sessionId && (
                <button
                  type="button"
                  onClick={() => deleteSession(currentSession.sessionId)}
                  className="btn btn-danger px-3 py-1.5 text-xs"
                >
                  Delete
                </button>
              )}
            </div>
          </header>

          {/* Pesan */}
          <div className="flex-1 overflow-y-auto p-4">
            {currentSession?.messages && currentSession.messages.length > 0 ? (
              <div className="space-y-4">
                {currentSession.messages.map((message, index) => (
                  <div
                    key={index}
                    data-testid="chat-message"
                    data-role={message.role}
                    className={`max-w-[85%] rounded-2xl border px-4 py-3 ${
                      message.role === 'user'
                        ? 'ml-auto border-cyan-300/20 bg-gradient-to-br from-cyan-400/20 to-violet-400/15 text-slate-50'
                        : 'border-white/10 bg-white/[0.04] text-slate-200'
                    }`}
                  >
                    {message.role === 'user' ? (
                      // Pesan user ditampilkan apa adanya: markdown hanya dirender
                      // untuk balasan AI, supaya input user tidak mengubah layout.
                      <p className="whitespace-pre-wrap break-words text-sm">
                        {message.content}
                      </p>
                    ) : (
                      <Suspense
                        fallback={
                          <p className="whitespace-pre-wrap break-words text-sm">
                            {message.content}
                          </p>
                        }
                      >
                        <MarkdownMessage content={message.content} />
                      </Suspense>
                    )}

                    <p className="mt-2 font-mono text-[10px] text-slate-500">
                      {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                    {/* Label per balasan: provider bisa berganti di tengah
                        percakapan, jadi ditampilkan dari data pesan itu sendiri */}
                    {message.role === 'assistant' && message.provider && (
                      <p className="mt-1 font-mono text-[10px] text-slate-500">
                        via {message.provider}
                        {message.model ? ` · ${message.model}` : ''}
                      </p>
                    )}
                  </div>
                ))}

                {loading && typing && (
                  <div className="max-w-[85%] rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-300 [animation-delay:-0.3s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-300/70 [animation-delay:-0.15s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-violet-300/70" />
                      <span className="hud ml-2">menyusun balasan</span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-cyan-300/25 bg-gradient-to-br from-cyan-400/20 to-violet-500/10 text-3xl">
                    💬
                  </div>
                  <h3 className="text-grad mb-2 text-lg font-bold">Start a new conversation</h3>
                  <p className="max-w-md text-sm text-slate-400 text-balance">
                    Ask me anything! I&apos;m here to help with questions, explanations,
                    coding assistance, creative writing, and more.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Kolom kirim */}
          <div className="border-t border-white/[0.06] p-4">
            {outOfQuota && (
              <p className="mb-2 text-xs text-rose-300">
                Chat quota exhausted. Ask an admin to increase it before sending new messages.
              </p>
            )}

            <div className="flex items-end gap-2">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={outOfQuota ? 'Chat quota exhausted' : 'Type a message...'}
                className="field flex-1 resize-none"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
              />
              <button
                type="button"
                onClick={handleSendMessage}
                disabled={loading || !inputValue.trim() || outOfQuota}
                aria-label="Kirim pesan"
                className="btn btn-primary h-11 w-11 flex-shrink-0 p-0"
              >
                {loading ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" />
                ) : (
                  <SendIcon className="h-5 w-5" />
                )}
              </button>
            </div>

            <p className="mt-2 text-center text-[10px] text-slate-600">
              Enter untuk mengirim · Shift + Enter untuk baris baru
            </p>
          </div>
        </section>
      </div>
    </Layout>
  )
}

export default ChatPage
