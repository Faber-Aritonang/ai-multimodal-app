import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authAPI } from '../config/api'
import { CheckIcon, SignOutButton } from '../components/icons'
import { GlassPanel } from '../components/ui'

// Tiga langkah yang ditampilkan sebagai garis waktu, supaya jelas di mana
// posisi user sekarang dan apa yang masih menunggu.
const STEPS = [
  { key: 'created', label: 'Akun dibuat', done: true },
  { key: 'review', label: 'Menunggu persetujuan admin', done: false, active: true },
  { key: 'access', label: 'Semua alat terbuka', done: false }
]

const PendingApproval = ({ user, setUser }) => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  // Cek status setiap 30 detik
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const response = await authAPI.getStatus()
        const freshUser = response.data.user

        if (response.data.isAuthenticated && freshUser?.isApproved) {
          // State `user` di App.jsx masih berisi nilai saat login
          // (isApproved: false). Kalau tidak diperbarui di sini, ProtectedRoute
          // akan langsung melempar balik ke halaman ini dan user terjebak di
          // sini selamanya sampai ia refresh manual sendiri.
          setUser?.(freshUser)
          localStorage.setItem('user', JSON.stringify(freshUser))
          navigate('/dashboard')
        }
      } catch (error) {
        console.error('Status check failed:', error)
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [navigate, setUser])

  const handleLogout = async () => {
    setLoading(true)
    try {
      await authAPI.logout()
      localStorage.removeItem('authToken')
      localStorage.removeItem('user')
      navigate('/login')
    } catch (error) {
      console.error('Logout failed:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <GlassPanel className="w-full max-w-lg p-6 text-center sm:p-8">
        <div className="mb-6 flex justify-center">
          <div className="relative grid h-16 w-16 place-items-center rounded-2xl border border-amber-300/30 bg-amber-300/10">
            {/* Cincin berdenyut: penanda bahwa statusnya sedang dipantau. */}
            <span className="absolute inset-0 animate-ping rounded-2xl border border-amber-300/20" />
            <svg className="h-7 w-7 text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>

        <p className="hud mb-2">status akun</p>
        <h1 className="text-grad mb-2 text-2xl font-bold tracking-tight">Pending Approval</h1>
        <p className="text-sm text-slate-400">
          Akun Anda sedang menunggu persetujuan admin.
        </p>

        {/* Garis waktu langkah akun */}
        <ol className="mt-7 space-y-3 text-left">
          {STEPS.map((step) => (
            <li
              key={step.key}
              className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 ${
                step.active
                  ? 'border-amber-300/30 bg-amber-300/[0.07]'
                  : 'border-white/10 bg-white/[0.02]'
              }`}
            >
              <span
                className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg border text-[11px] font-semibold ${
                  step.done
                    ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-300'
                    : step.active
                      ? 'border-amber-300/40 bg-amber-300/10 text-amber-300'
                      : 'border-white/10 bg-white/[0.03] text-slate-500'
                }`}
              >
                {step.done ? <CheckIcon className="h-4 w-4" /> : step.active ? '•' : ''}
              </span>
              <span className={`text-sm ${step.active ? 'text-amber-100' : 'text-slate-400'}`}>
                {step.label}
              </span>
              {step.active && <span className="chip chip-warn ml-auto">berjalan</span>}
            </li>
          ))}
        </ol>

        <div className="glass-inset mt-5 flex items-center gap-3 p-3 text-left">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt="Profile"
              className="h-11 w-11 rounded-xl object-cover ring-1 ring-white/15"
            />
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-aurora-cyan to-aurora-violet text-base font-bold text-ink-950">
              {user?.displayName?.charAt(0) || '?'}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-100">{user?.displayName}</p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Halaman ini memeriksa status setiap 30 detik dan akan berpindah sendiri begitu
          disetujui — tidak perlu refresh manual.
        </p>

        <button
          type="button"
          onClick={handleLogout}
          disabled={loading}
          className="btn btn-ghost mt-6 w-full"
        >
          <SignOutButton className="h-4 w-4" />
          <span>{loading ? 'Logging out...' : 'Logout'}</span>
        </button>
      </GlassPanel>
    </div>
  )
}

export default PendingApproval
