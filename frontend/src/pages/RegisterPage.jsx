import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { signInWithGoogle } from '../config/firebase'
import { authAPI } from '../config/api'
import { getDeviceId } from '../utils/deviceId'
import { GoogleIcon, UserIcon } from '../components/icons'
import { GlassPanel, Alert } from '../components/ui'

const RegisterPage = ({ setUser }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const inviteCode = (searchParams.get('ref') || '').trim().toUpperCase()

  // Sesi Google yang dibawa dari halaman login (login 404 -> navigate('/register', { state })).
  // Selama konteks ini ada, tombol Google tidak perlu diklik lagi.
  const [pendingFirebase, setPendingFirebase] = useState(() => {
    const state = location.state
    return state?.firebaseToken && state?.firebaseUser
      ? { user: state.firebaseUser, token: state.firebaseToken }
      : null
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [referrer, setReferrer] = useState(null)
  const [referrerError, setReferrerError] = useState('')
  const [formData, setFormData] = useState({
    displayName: pendingFirebase?.user?.displayName || '',
    email: pendingFirebase?.user?.email || '',
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
      // 1. Pakai sesi Google yang sudah dibawa dari halaman login; kalau tidak ada
      //    (mis. halaman di-refresh), sign in dengan Google seperti biasa.
      let firebase = pendingFirebase

      if (!firebase) {
        const result = await signInWithGoogle()

        if (!result.success) {
          throw new Error(result.error)
        }

        firebase = { user: result.user, token: result.token }
      }

      // 2. Register ke backend
      const registerResponse = await authAPI.register({
        email: firebase.user?.email || formData.email,
        displayName: formData.displayName || firebase.user?.displayName,
        photoURL: firebase.user?.photoURL,
        firebaseToken: firebase.token,
        referralCode: formData.referralCode || undefined,
        // Jejak device: backend menandai bila pendaftar lain memakai browser
        // atau IP yang sama (review admin, bukan blokir).
        deviceId: getDeviceId()
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

      // Token yang dibawa dari halaman login kedaluwarsa (401): buang konteks lama
      // supaya klik tombol berikutnya menjalankan sign-in Google yang baru.
      if (pendingFirebase && err.response?.status === 401) {
        setPendingFirebase(null)
      }

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
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <GlassPanel className="w-full max-w-xl p-6 sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-aurora-cyan to-aurora-violet font-mono text-sm font-bold text-ink-950">
            AI
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-100">AI Multimodal App</p>
            <p className="hud">pendaftaran</p>
          </div>
        </div>

        <p className="hud mb-2">langkah 1 dari 2</p>
        <h1 className="text-grad mb-1 text-2xl font-bold tracking-tight">Buat akun Anda</h1>
        <p className="mb-6 text-sm text-slate-400">
          {pendingFirebase
            ? 'Sesi Google Anda sudah dibawa dari halaman masuk. Lengkapi data di bawah, lalu selesaikan pendaftaran.'
            : 'Lengkapi data di bawah, lalu lanjutkan dengan Google.'}
        </p>

        {referrer && (
          <div className="alert alert-ok mb-4 flex items-center gap-3">
            {referrer.photoURL ? (
              <img
                src={referrer.photoURL}
                alt={referrer.displayName}
                className="h-10 w-10 rounded-xl object-cover ring-1 ring-emerald-300/30"
              />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 font-semibold text-ink-950">
                {referrer.displayName?.charAt(0) || '?'}
              </span>
            )}
            <p>
              You were invited by <strong className="font-semibold">{referrer.displayName}</strong>.
            </p>
          </div>
        )}

        {referrerError && (
          <Alert tone="warn" className="mb-4">
            {referrerError}
          </Alert>
        )}

        <div className="space-y-4">
          <div>
            <label htmlFor="displayName" className="hud mb-1.5 block">
              display name
            </label>
            <input
              id="displayName"
              type="text"
              name="displayName"
              value={formData.displayName}
              onChange={handleChange}
              className="field"
              placeholder="John Doe"
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="hud mb-1.5 block">
              email
            </label>
            <input
              id="email"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="field"
              placeholder="john@example.com"
              required
            />
          </div>

          <div>
            <label htmlFor="referralCode" className="hud mb-1.5 block">
              kode undangan (opsional)
            </label>
            <input
              id="referralCode"
              type="text"
              name="referralCode"
              value={formData.referralCode}
              onChange={handleChange}
              className="field font-mono uppercase tracking-widest"
              placeholder="MASUKKAN KODE"
            />
          </div>
        </div>

        {error && (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        )}

        <button
          type="button"
          onClick={handleGoogleRegister}
          disabled={loading}
          className="btn btn-primary mt-6 w-full py-3"
        >
          {loading ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" />
          ) : (
            <GoogleIcon className="h-5 w-5" />
          )}
          <span>
            {loading
              ? 'Registering...'
              : pendingFirebase
                ? 'Selesaikan pendaftaran'
                : 'Sign up with Google'}
          </span>
        </button>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="link-accent text-sm font-medium"
          >
            Already have an account? Sign in
          </button>
        </div>

        <div className="alert alert-info mt-6 flex items-start gap-3">
          <UserIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            <strong className="font-semibold">Catatan:</strong> akun Anda menunggu persetujuan admin.
            Fitur chat bisa dipakai lebih dulu; alat gambar terbuka setelah disetujui.
          </p>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          <strong className="font-semibold text-slate-400">Privasi:</strong>{' '}
          saat mendaftar kami menyimpan alamat IP dan perkiraan lokasi
          (kota/negara/ISP) dari browser Anda, untuk menandai bila satu perangkat
          dipakai mendaftar berkali-kali. Data ini hanya ditinjau admin saat
          memeriksa pendaftaran, tidak ditampilkan publik, dan tidak dibagikan
          ke pihak lain.
        </p>
      </GlassPanel>
    </div>
  )
}

export default RegisterPage
