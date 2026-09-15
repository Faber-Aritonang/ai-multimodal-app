import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { memberAPI } from '../config/api'
import Layout from '../components/Layout'

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

  return (
    <Layout user={user} setUser={setUser}>
      <div className="flex gap-4 h-[calc(100vh-120px)]">
        {/* Sidebar */}
        <div className="w-72 bg-white dark-glass rounded-xl border border-dark-200 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-dark-200 flex items-center justify-between">
            <h3 className="font-bold text-dark-800">Chat History</h3>
            <button
              onClick={startNewChat}
              className="bg-primary-500 hover:bg-primary-600 text-white rounded-lg px-3 py-1 text-sm transition-colors"
            >
              + New Chat
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2">
            {sessions.length > 0 ? (
              sessions.map((session) => (
                <div
                  key={session.sessionId}
                  onClick={() => navigate(`/chat/${session.sessionId}`)}
                  className={`
                    p-3 rounded-lg cursor-pointer mb-1 transition-all
                    ${session.sessionId === currentSession?.sessionId 
                      ? 'bg-primary-50 text-primary-700' 
                      : 'hover:bg-dark-50'
                    }
                  `}
                >
                  <p className="font-medium text-sm truncate">
                    {session.title || 'New Chat'}
                  </p>
                  <p className="text-xs text-dark-400 mt-1">
                    {new Date(session.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-center text-dark-400 p-4">No conversations yet</p>
            )}
          </div>
          
          <div className="p-3 border-t border-dark-200">
            <button
              onClick={() => navigate('/profile')}
              className="w-full text-left p-2 text-sm text-dark-600 hover:bg-dark-50 rounded-lg transition-colors"
            >
              Profile & Settings
            </button>
          </div>
        </div>
        
        {/* Main Chat Area */}
        <div className="flex-1 bg-white dark-glass rounded-xl border border-dark-200 overflow-hidden flex flex-col">
          {/* Chat Header */}
          <div className="p-4 border-b border-dark-200 flex items-center justify-between gap-3">
            <h3 className="font-bold text-dark-800 truncate">
              {currentSession?.title || 'New Chat'}
            </h3>
            <div className="flex items-center gap-3 shrink-0">
              {/* Kuota selalu terlihat supaya user tidak kaget saat habis */}
              {chatQuotaLeft !== null && (
                <span
                  data-testid="chat-quota"
                  className={`text-xs px-2 py-1 rounded-full border ${
                    outOfQuota
                      ? 'bg-red-50 border-red-200 text-red-600'
                      : 'bg-dark-50 border-dark-200 text-dark-500'
                  }`}
                  title="Chat messages left in your quota"
                >
                  {chatQuotaLeft} {chatQuotaLeft === 1 ? 'message' : 'messages'} left
                </span>
              )}
              {currentSession?.sessionId && (
                <button
                  onClick={() => deleteSession(currentSession.sessionId)}
                  className="text-red-500 hover:text-red-600 text-sm"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
          
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4">
            {currentSession?.messages && currentSession.messages.length > 0 ? (
              <div className="space-y-4">
                {currentSession.messages.map((message, index) => (
                  <div
                    key={index}
                    data-testid="chat-message"
                    data-role={message.role}
                    className={`
                      max-w-[80%] p-3 rounded-lg
                      ${message.role === 'user' 
                        ? 'bg-primary-500 text-white ml-auto' 
                        : 'bg-dark-50 text-dark-800'
                      }
                    `}
                  >
                    {message.role === 'user' ? (
                      // Pesan user ditampilkan apa adanya: markdown hanya dirender
                      // untuk balasan AI, supaya input user tidak mengubah layout.
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                    ) : (
                      <Suspense
                        fallback={
                          <p className="text-sm whitespace-pre-wrap break-words">
                            {message.content}
                          </p>
                        }
                      >
                        <MarkdownMessage content={message.content} />
                      </Suspense>
                    )}
                    <p className="text-xs opacity-70 mt-1">
                      {new Date(message.timestamp).toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </p>
                    {/* Label per balasan: provider bisa berganti di tengah
                        percakapan, jadi ditampilkan dari data pesan itu sendiri */}
                    {message.role === 'assistant' && message.provider && (
                      <p className="text-xs text-dark-400 mt-1">
                        via {message.provider}
                        {message.model ? ` · ${message.model}` : ''}
                      </p>
                    )}
                  </div>
                ))}
                {loading && typing && (
                  <div className="bg-dark-50 text-dark-800 p-3 rounded-lg max-w-[80%]">
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 bg-dark-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                      <div className="w-2 h-2 bg-dark-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="w-2 h-2 bg-dark-400 rounded-full animate-bounce"></div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-center">
                <div>
                  <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">💬</span>
                  </div>
                  <h3 className="text-xl font-bold text-dark-700 mb-2">
                    Start a new conversation
                  </h3>
                  <p className="text-dark-400 max-w-md">
                    Ask me anything! I&apos;m here to help with questions, explanations, 
                    coding assistance, creative writing, and more.
                  </p>
                </div>
              </div>
            )}
          </div>
          
          {/* Input Area */}
          <div className="p-4 border-t border-dark-200">
            {outOfQuota && (
              <p className="text-xs text-red-600 mb-2">
                Chat quota exhausted. Ask an admin to increase it before sending new messages.
              </p>
            )}
            <div className="flex gap-2">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={outOfQuota ? 'Chat quota exhausted' : 'Type a message...'}
                className="flex-1 px-4 py-2 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
              />
              <button
                onClick={handleSendMessage}
                disabled={loading || !inputValue.trim() || outOfQuota}
                className="bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg px-4 py-2 transition-colors flex items-center justify-center"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9-7-9-7-9 7 9 7z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default ChatPage