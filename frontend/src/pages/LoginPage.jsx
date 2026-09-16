import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithGoogle, isFirebaseConfigured } from '../config/firebase'
import { authAPI } from '../config/api'
import { GoogleIcon, ChatIcon, ImageIcon, TransformIcon } from '../components/icons'
import { GlassPanel, Alert } from '../components/ui'

// Panel dev-login hanya muncul saat `npm run dev` (mode development Vite).
// Backend juga menolak endpoint ini saat NODE_ENV=production.
const DEV_LOGIN_AVAILABLE = import.meta.env.DEV

const ROLES = [
  { value: 'member', label: 'Member (disetujui)' },
  { value: 'guest', label: 'Belum disetujui' }
]

// Ditampilkan di kolom kiri (layar besar) sebagai gambaran isi aplikasi.
const HIGHLIGHTS = [
  { icon: ChatIcon, title: 'Chat multimodal', desc: 'Tanya jawab dengan jawaban berformat rapi.' },
  { icon: ImageIcon, title: 'Text to Image', desc: 'Ubah deskripsi teks menjadi gambar.' },
  { icon: TransformIcon, title: 'Image to Image', desc: 'Ubah gaya gambar yang sudah ada.' }
]

const LoginPage = ({ setUser }) => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [showDevLogin, setShowDevLogin] = useState(false)
  const [devEmail, setDevEmail] = useState('dev.member@example.com')
  const [devRole, setDevRole] = useState('member')

  // Arahkan user ke halaman yang sesuai setelah sesi tersimpan
  const finishLogin = (token, user) => {
    localStorage.setItem('authToken', token)
    localStorage.setItem('user', JSON.stringify(user))
    setUser(user)

    if (user.role === 'admin') {
      navigate('/admin')
    } else if (user.isApproved) {
      navigate('/dashboard')
    } else {
      navigate('/pending-approval')
    }
  }

  const handleGoogleLogin = async () => {
    setLoading(true)
    setError('')

    try {
      // 1. Sign in with Firebase
      const result = await signInWithGoogle()

      if (!result.success) {
        throw new Error(result.error)
      }

      // 2. Kirim Firebase token ke backend untuk verifikasi & dapat JWT
      //    Backend mengecek koleksi Admin dulu: jika uid terdaftar sebagai
      //    admin, response berisi role 'admin'.
      const loginResponse = await authAPI.login({
        firebaseToken: result.token
      })

      const { token, user } = loginResponse.data

      // 3. Simpan sesi & redirect sesuai role
      finishLogin(token, user)

    } catch (err) {
      console.error('Login error:', err)

      // Jika user belum ada di backend, arahkan ke register
      if (err.response?.status === 404 || err.message?.includes('not registered')) {
        navigate('/register')
      } else {
        setError(err.response?.data?.message || err.message || 'Login failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDevLogin = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await authAPI.devLogin({
        email: devEmail,
        role: devRole
      })

      const { token, user } = response.data
      finishLogin(token, user)
    } catch (err) {
      console.error('Dev login error:', err)

      if (err.response?.status === 404) {
        setError('Dev login tidak tersedia. Pastikan backend berjalan dengan NODE_ENV=development.')
      } else {
        setError(err.response?.data?.message || err.message || 'Dev login gagal.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.05fr_minmax(0,26rem)]">
        {/* Kolom kiri: identitas + gambaran fitur. Hanya di layar lebar. */}
        <aside className="hidden flex-col gap-8 lg:flex">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-aurora-cyan via-aurora-blue to-aurora-violet font-mono text-sm font-bold text-ink-950 shadow-glow-cyan">
              AI
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-100">AI Multimodal App</p>
              <p className="hud">workspace</p>
            </div>
          </div>

          <div>
            <p className="hud mb-3">satu ruang kerja</p>
            <h1 className="text-grad text-4xl font-bold leading-tight tracking-tight">
              Chat, gambar, dan transformasi gambar dalam satu tempat.
            </h1>
            <p className="mt-4 max-w-md text-sm text-slate-400 text-balance">
              Masuk dengan akun Google Anda. Setiap akun baru menunggu persetujuan admin
              sebelum alat gambar terbuka.
            </p>
          </div>

          <ul className="space-y-3">
            {HIGHLIGHTS.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.title} className="glass-inset flex items-start gap-3 p-3.5">
                  <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{item.title}</p>
                    <p className="text-xs text-slate-400">{item.desc}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </aside>

        {/* Kolom kanan: formulir masuk. */}
        <GlassPanel className="p-6 sm:p-8">
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-aurora-cyan to-aurora-violet font-mono text-sm font-bold text-ink-950">
              AI
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-100">AI Multimodal App</p>
              <p className="hud">workspace</p>
            </div>
          </div>

          <p className="hud mb-2">masuk</p>
          <h2 className="text-grad mb-1 text-2xl font-bold tracking-tight">Selamat datang kembali</h2>
          <p className="mb-6 text-sm text-slate-400">Masuk untuk memakai alat AI Anda.</p>

          {error && (
            <Alert tone="danger" className="mb-4">
              {error}
            </Alert>
          )}

          {!isFirebaseConfigured && (
            <Alert tone="warn" className="mb-4">
              Firebase belum dikonfigurasi, jadi tombol di bawah belum bisa dipakai.
              Isi <code className="font-mono">frontend/.env.local</code> lalu restart dev server
              (lihat <code className="font-mono">docs/setup-kredensial.md</code>).
              {DEV_LOGIN_AVAILABLE && ' Sementara itu, pakai Dev login di bagian bawah.'}
            </Alert>
          )}

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="btn btn-ghost w-full py-3"
          >
            {loading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-cyan-300" />
            ) : (
              <GoogleIcon className="h-5 w-5" />
            )}
            <span>{loading ? 'Signing in...' : 'Continue with Google'}</span>
          </button>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" />
            <span className="hud">atau</span>
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
          </div>

          <p className="text-center text-sm text-slate-500">
            Belum punya akun?{' '}
            <button
              type="button"
              onClick={() => navigate('/register')}
              className="link-accent font-medium"
            >
              Daftar sekarang
            </button>
          </p>

          <p className="mt-6 text-center text-xs text-slate-600">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>

          {DEV_LOGIN_AVAILABLE && (
            <div className="mt-6 border-t border-dashed border-white/10 pt-5">
              <button
                type="button"
                onClick={() => setShowDevLogin((open) => !open)}
                aria-expanded={showDevLogin}
                className="hud w-full text-left transition-colors hover:text-slate-200"
              >
                {showDevLogin ? '▾' : '▸'} Dev login (tanpa Firebase)
              </button>

              {showDevLogin && (
                <div className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="dev-email" className="hud mb-1.5 block">
                      email (dibuat otomatis bila belum ada)
                    </label>
                    <input
                      id="dev-email"
                      type="email"
                      value={devEmail}
                      onChange={(e) => setDevEmail(e.target.value)}
                      className="field font-mono text-xs"
                      placeholder="dev.member@example.com"
                    />
                  </div>

                  <div>
                    <label htmlFor="dev-role" className="hud mb-1.5 block">
                      role
                    </label>
                    <select
                      id="dev-role"
                      value={devRole}
                      onChange={(e) => setDevRole(e.target.value)}
                      className="field"
                    >
                      {ROLES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleDevLogin}
                    disabled={loading || !devEmail.trim()}
                    className="btn btn-primary w-full"
                  >
                    {loading ? 'Memproses...' : 'Masuk (dev)'}
                  </button>

                  <p className="text-xs text-slate-500">
                    Email yang sama dengan akun admin (koleksi <code className="font-mono">admins</code>)
                    akan masuk sebagai admin.
                  </p>
                </div>
              )}
            </div>
          )}
        </GlassPanel>
      </div>
    </div>
  )
}

export default LoginPage
