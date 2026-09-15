import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithGoogle, isFirebaseConfigured } from '../config/firebase'
import { authAPI } from '../config/api'
import { GoogleIcon } from '../components/icons'

// Panel dev-login hanya muncul saat `npm run dev` (mode development Vite).
// Backend juga menolak endpoint ini saat NODE_ENV=production.
const DEV_LOGIN_AVAILABLE = import.meta.env.DEV

const ROLES = [
  { value: 'member', label: 'Member (disetujui)' },
  { value: 'guest', label: 'Belum disetujui' }
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-600 to-primary-800">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-dark-800 mb-2">AI Multimodal App</h1>
          <p className="text-dark-500">Sign in to access AI tools</p>
        </div>
        
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {!isFirebaseConfigured && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <p className="text-amber-800 text-sm">
              Firebase belum dikonfigurasi, jadi tombol di bawah belum bisa dipakai.
              Isi <code className="font-mono">frontend/.env.local</code> lalu restart dev server
              (lihat <code className="font-mono">docs/setup-kredensial.md</code>).
              {DEV_LOGIN_AVAILABLE && ' Sementara itu, pakai Dev login di bagian bawah.'}
            </p>
          </div>
        )}
        
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white border border-dark-200 rounded-lg px-4 py-3 hover:bg-dark-50 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-500 border-t-transparent"></div>
          ) : (
            <GoogleIcon className="w-5 h-5" />
          )}
          <span className="text-dark-700 font-medium">
            {loading ? 'Signing in...' : 'Continue with Google'}
          </span>
        </button>
        
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-dark-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-3 bg-white text-dark-400">Or</span>
          </div>
        </div>
        
        <p className="text-center text-sm text-dark-500">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>

        {DEV_LOGIN_AVAILABLE && (
          <div className="mt-6 pt-5 border-t border-dashed border-dark-200">
            <button
              type="button"
              onClick={() => setShowDevLogin((open) => !open)}
              className="w-full text-left text-xs font-semibold text-dark-400 uppercase tracking-wide hover:text-dark-600"
            >
              {showDevLogin ? '▾' : '▸'} Dev login (tanpa Firebase)
            </button>

            {showDevLogin && (
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="dev-email" className="block text-xs text-dark-500 mb-1">
                    Email (otomatis dibuat sebagai member jika belum ada)
                  </label>
                  <input
                    id="dev-email"
                    type="email"
                    value={devEmail}
                    onChange={(e) => setDevEmail(e.target.value)}
                    className="w-full border border-dark-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="dev.member@example.com"
                  />
                </div>

                <div>
                  <label htmlFor="dev-role" className="block text-xs text-dark-500 mb-1">
                    Role
                  </label>
                  <select
                    id="dev-role"
                    value={devRole}
                    onChange={(e) => setDevRole(e.target.value)}
                    className="w-full border border-dark-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                  className="w-full bg-dark-800 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-dark-700 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Memproses...' : 'Masuk (dev)'}
                </button>

                <p className="text-xs text-dark-400">
                  Email yang sama dengan akun admin (koleksi <code className="font-mono">admins</code>)
                  akan masuk sebagai admin.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default LoginPage
