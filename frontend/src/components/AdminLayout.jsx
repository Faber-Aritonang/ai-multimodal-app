import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { authAPI } from '../config/api'
import { signOutUser } from '../config/firebase'
import { HomeIcon, UserIcon, SignOutButton } from './icons'

const NAVIGATION = [
  { name: 'Dashboard', href: '/admin', icon: HomeIcon, code: '01' },
  { name: 'Members', href: '/admin/members', icon: UserIcon, code: '02' }
]

/**
 * Shell khusus admin.
 *
 * Sengaja dipisah dari `Layout.jsx`: navigasinya berbeda seluruhnya (tidak ada
 * menu member), dan aksennya diberi warna berbeda supaya admin selalu sadar
 * sedang berada di area yang berdampak ke akun orang lain.
 */
const AdminLayout = ({ children }) => {
  const location = useLocation()
  const [loggingOut, setLoggingOut] = useState(false)

  const isActive = (href) =>
    location.pathname === href || (href !== '/admin' && location.pathname.startsWith(`${href}/`))

  const handleLogout = async () => {
    if (loggingOut) return

    setLoggingOut(true)

    // Hapus sesi lokal terlebih dahulu supaya tombol logout tetap berhasil
    // walaupun request logout backend sedang gagal atau lambat.
    localStorage.removeItem('authToken')
    localStorage.removeItem('user')

    // Logout backend tidak boleh menahan navigasi. JWT disimpan di localStorage,
    // jadi pembersihan lokal adalah bagian terpenting untuk mengakhiri sesi.
    void authAPI.logout().catch((error) => {
      console.error('Admin logout API failed:', error)
    })

    // Putus sesi Firebase agar App tidak menghidupkan kembali sesi Google lama.
    // Batas waktu mencegah tombol terasa macet jika Firebase sedang bermasalah.
    await Promise.race([
      signOutUser(),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ])

    // Reload penuh mengosongkan state `user` di App.jsx. `navigate()` saja tidak
    // cukup karena GuestRoute masih melihat state admin yang lama.
    window.location.replace('/login')
  }

  const activeItem = NAVIGATION.find((item) => isActive(item.href))

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="glass-bar z-30 flex flex-col border-b md:fixed md:inset-y-0 md:w-72 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between border-b border-white/[0.06] p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-aurora-fuchsia via-aurora-violet to-aurora-cyan font-mono text-sm font-bold text-ink-950">
              AD
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-100">Admin Console</p>
              <p className="hud">kontrol akses</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            aria-label="Logout"
            disabled={loggingOut}
            className="rounded-lg border border-white/10 p-2 text-rose-300 transition-colors hover:bg-rose-500/10 disabled:cursor-wait disabled:opacity-50 md:hidden"
          >
            <SignOutButton className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex gap-2 overflow-x-auto p-3 md:flex-1 md:flex-col md:overflow-visible" aria-label="Navigasi admin">
          {NAVIGATION.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)

            return (
              <Link
                key={item.name}
                to={item.href}
                aria-current={active ? 'page' : undefined}
                className={`
                  group relative flex flex-shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium
                  transition-all duration-200
                  ${active
                    ? 'border border-fuchsia-300/25 bg-fuchsia-300/[0.08] text-white'
                    : 'border border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.05] hover:text-slate-100'
                  }
                `}
              >
                <span
                  className={`absolute left-0 top-1/2 hidden h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-aurora-fuchsia to-aurora-cyan transition-opacity md:block ${
                    active ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                <span
                  className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border transition-colors ${
                    active
                      ? 'border-fuchsia-300/30 bg-fuchsia-300/10 text-fuchsia-200'
                      : 'border-white/10 bg-white/[0.03] text-slate-400 group-hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="truncate">{item.name}</span>
                <span className="ml-auto hidden font-mono text-[10px] text-slate-500 md:block">{item.code}</span>
              </Link>
            )
          })}
        </nav>

        <div className="hidden border-t border-white/[0.06] p-4 md:block">
          <Link
            to="/dashboard"
            className="mb-3 block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-300 transition-colors hover:border-cyan-300/30 hover:bg-cyan-300/[0.07] hover:text-white"
          >
            ← Tampilan member
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="btn btn-danger w-full disabled:cursor-wait disabled:opacity-50"
          >
            <SignOutButton className="h-4 w-4" />
            {loggingOut ? 'Logging out…' : 'Logout'}
          </button>
        </div>
      </aside>

      {/* Konten */}
      <div className="flex-1 md:pl-72">
        <header className="glass-bar sticky top-0 z-20 border-b">
          <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-8">
            <div>
              <p className="hud">Admin · {activeItem?.name || 'Console'}</p>
              <p className="text-sm font-semibold text-slate-200">{activeItem?.name || 'Console'}</p>
            </div>
            <span className="chip chip-accent">akses penuh</span>
          </div>
          <div className="divider-glow" />
        </header>

        <main className="px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  )
}

export default AdminLayout
