import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithGoogle } from '../config/firebase'
import { authAPI } from '../config/api'
import { GoogleIcon } from '../components/icons'

const LoginPage = ({ setUser }) => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
      
      // 3. Simpan sesi
      localStorage.setItem('authToken', token)
      localStorage.setItem('user', JSON.stringify(user))
      setUser(user)
      
      // 4. Redirect sesuai role
      if (user.role === 'admin') {
        navigate('/admin')
      } else if (user.isApproved) {
        navigate('/dashboard')
      } else {
        navigate('/pending-approval')
      }
      
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
      </div>
    </div>
  )
}

export default LoginPage