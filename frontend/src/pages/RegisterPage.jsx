import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithGoogle } from '../config/firebase'
import { authAPI } from '../config/api'
import { GoogleIcon } from '../components/icons'

const RegisterPage = ({ setUser }) => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteCode = (searchParams.get('ref') || '').trim().toUpperCase()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [referrer, setReferrer] = useState(null)
  const [referrerError, setReferrerError] = useState('')
  const [formData, setFormData] = useState({
    displayName: '',
    email: '',
    referralCode: inviteCode
  })

  // Tampilkan siapa yang mengundang (dari link /register?ref=CODE)
  useEffect(() => {
    if (!inviteCode) return

    let cancelled = false

    const fetchReferrer = async () => {
      try {
        const response = await authAPI.getReferralInfo(inviteCode)
        if (!cancelled) setReferrer(response.data.member)
      } catch (err) {
        if (!cancelled) {
          setReferrerError('Kode undangan tidak ditemukan. Anda tetap bisa mendaftar tanpa kode.')
        }
        console.error('Failed to fetch referral info:', err)
      }
    }

    fetchReferrer()

    return () => {
      cancelled = true
    }
  }, [inviteCode])

  const handleGoogleRegister = async () => {
    setLoading(true)
    setError('')
    
    try {
      // 1. Sign in with Firebase
      const result = await signInWithGoogle()
      
      if (!result.success) {
        throw new Error(result.error)
      }
      
      // 2. Register ke backend
      const registerResponse = await authAPI.register({
        email: result.user.email,
        displayName: formData.displayName || result.user.displayName,
        photoURL: result.user.photoURL,
        firebaseToken: result.token,
        referralCode: formData.referralCode || undefined
      })
      
      if (registerResponse.data.success) {
        const { token, user } = registerResponse.data
        localStorage.setItem('authToken', token)
        localStorage.setItem('user', JSON.stringify(user))
        setUser(user)
        
        // Redirect ke pending approval
        navigate('/pending-approval')
      }
      
    } catch (err) {
      console.error('Register error:', err)
      
      if (err.response?.data?.message?.includes('already registered')) {
        navigate('/login')
      } else {
        setError(err.response?.data?.message || err.message || 'Registration failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-600 to-primary-800">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-dark-800 mb-2">AI Multimodal App</h1>
          <p className="text-dark-500">Register your account</p>
        </div>

        {referrer && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 flex items-center gap-3">
            {referrer.photoURL ? (
              <img
                src={referrer.photoURL}
                alt={referrer.displayName}
                className="w-10 h-10 rounded-full"
              />
            ) : (
              <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                <span className="text-white font-bold">
                  {referrer.displayName?.charAt(0) || '?'}
                </span>
              </div>
            )}
            <p className="text-green-800 text-sm">
              You were invited by <strong>{referrer.displayName}</strong>.
            </p>
          </div>
        )}

        {referrerError && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
            <p className="text-yellow-800 text-sm">{referrerError}</p>
          </div>
        )}
        
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-dark-700 mb-1">
              Display Name
            </label>
            <input
              type="text"
              name="displayName"
              value={formData.displayName}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="John Doe"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-dark-700 mb-1">
              Email
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="john@example.com"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-dark-700 mb-1">
              Referral Code (optional)
            </label>
            <input
              type="text"
              name="referralCode"
              value={formData.referralCode}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Enter referral code"
            />
          </div>
        </div>
        
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}
        
        <button
          onClick={handleGoogleRegister}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white border border-dark-200 rounded-lg px-4 py-3 hover:bg-dark-50 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-500 border-t-transparent"></div>
          ) : (
            <GoogleIcon className="w-5 h-5" />
          )}
          <span className="text-dark-700 font-medium">
            {loading ? 'Registering...' : 'Sign up with Google'}
          </span>
        </button>
        
        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/login')}
            className="text-primary-600 hover:text-primary-700 text-sm font-medium"
          >
            Already have an account? Sign in
          </button>
        </div>
        
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-blue-800 text-sm">
            <strong>Note:</strong> Your account will be pending admin approval.
            You&apos;ll be able to use the chat feature immediately, but other AI features
            will be unlocked once approved.
          </p>
        </div>
      </div>
    </div>
  )
}

export default RegisterPage