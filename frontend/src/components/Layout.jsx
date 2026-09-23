import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { authAPI } from '../config/api'
import { signOutUser } from '../config/firebase'
import {
  MenuIcon,
  XIcon,
  HomeIcon,
  ChatIcon,
  ImageIcon,
  TransformIcon,
  SoundIcon,
  TranscriptIcon,
  UserIcon
} from '../components/icons'

// `short` adalah label untuk navigasi bawah di mobile: kata pertama nama saja
// membuat "Text to Image" dan "Text to Sound" sama-sama tertulis "Text".
const NAVIGATION = [
  { name: 'Dashboard', href: '/dashboard', icon: HomeIcon, code: '01', short: 'Home' },
  { name: 'Chat', href: '/chat', icon: ChatIcon, code: '02', short: 'Chat' },
  { name: 'Text to Image', href: '/tools/text-to-image', icon: ImageIcon, code: '03', short: 'Image' },
  { name: 'Image to Image', href: '/tools/image-to-image', icon: TransformIcon, code: '04', short: 'Transform' },
  { name: 'Text to Sound', href: '/tools/text-to-sound', icon: SoundIcon, code: '05', short: 'Sound' },
  { name: 'Sound to Text', href: '/tools/sound-to-text', icon: TranscriptIcon, code: '06', short: 'Transcribe' },
  { name: 'Profile', href: '/profile', icon: UserIcon, code: '07', short: 'Profile' }
]

/** Inisial huruf pertama nama, dipakai saat user tidak punya foto. */
const initialOf = (user) => (user?.displayName || user?.email || '?').charAt(0).toUpperCase()

const Avatar = ({ user, size = 'md' }) => {
  const box = size === 'lg' ? 'h-11 w-11 text-base' : 'h-9 w-9 text-sm'

  if (user?.photoURL) {
    return (
      <img
        src={user.photoURL}
        alt={user.displayName || 'User'}
        className={`${box} flex-shrink-0 rounded-xl object-cover ring-1 ring-white/15`}
      />
    )
  }

  return (
    <div
      className={`${box} grid flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-aurora-cyan to-aurora-violet font-semibold text-ink-950`}
    >
      {initialOf(user)}
    </div>
  )
}

const Layout = ({ user, setUser, children }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogout = async () => {
    try {
      await authAPI.logout()
    } catch (error) {
      console.error('Logout failed:', error)
    }

    // Putus sesi Firebase juga, agar tidak otomatis login lagi
    await signOutUser()

    localStorage.removeItem('authToken')
    localStorage.removeItem('user')
    setUser(null)
    navigate('/login')
  }

  const isActive = (href) =>
    location.pathname === href ||
    (href === '/chat' && location.pathname.startsWith('/chat/')) ||
    (href !== '/dashboard' && href !== '/chat' && location.pathname.startsWith(`${href}/`))

  /** Tautan navigasi dengan penanda halaman aktif. */
  const NavLink = ({ item, onNavigate }) => {
    const Icon = item.icon
    const active = isActive(item.href)

    return (
      <Link
        to={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={`
          group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium
          transition-all duration-200
          ${active
            ? 'border border-cyan-300/25 bg-cyan-300/[0.08] text-white shadow-[0_0_0_1px_rgba(34,211,238,0.06)]'
            : 'border border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.05] hover:text-slate-100'
          }
        `}
      >
        {/* Garis aksen: satu-satunya penanda posisi yang tetap terbaca di latar gelap. */}
        <span
          className={`absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-aurora-cyan to-aurora-violet transition-opacity ${
            active ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <span
          className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border transition-colors ${
            active
              ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-200'
              : 'border-white/10 bg-white/[0.03] text-slate-400 group-hover:text-slate-200'
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="truncate">{item.name}</span>
        <span className="ml-auto font-mono text-[10px] text-slate-500">{item.code}</span>
      </Link>
    )
  }

  const Brand = ({ compact = false }) => (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-aurora-cyan via-aurora-blue to-aurora-violet font-mono text-sm font-bold text-ink-950 shadow-glow-cyan">
        AI
      </span>
      {!compact && (
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-100">AI Multimodal</p>
          <p className="hud">workspace</p>
        </div>
      )}
    </div>
  )

  const UserCard = () => (
    <div className="glass-inset flex items-center gap-3 p-3">
      <Avatar user={user} size="lg" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-100">{user?.displayName || 'User'}</p>
        <p className="truncate text-xs text-slate-500">{user?.email}</p>
      </div>
    </div>
  )

  const activeItem = NAVIGATION.find((item) => isActive(item.href))

  return (
    <div className="min-h-screen">
      {/* ------------------------------- Drawer (mobile) ------------------------------ */}
      <div className="md:hidden">
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        <div
          className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform duration-300 ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Menu navigasi"
        >
          <div className="glass-bar flex h-full flex-col border-r">
            <div className="flex items-center justify-between border-b border-white/[0.06] p-4">
              <Brand />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Tutup menu"
                className="rounded-lg border border-white/10 p-2 text-slate-300 transition-colors hover:bg-white/[0.06]"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4">
              <UserCard />
            </div>

            <nav className="flex-1 space-y-1.5 px-3" aria-label="Navigasi utama">
              {NAVIGATION.map((item) => (
                <NavLink key={item.name} item={item} onNavigate={() => setMobileMenuOpen(false)} />
              ))}
            </nav>

            <div className="border-t border-white/[0.06] p-4">
              <button
                type="button"
                onClick={handleLogout}
                className="btn btn-danger w-full"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------- Sidebar (desktop) ---------------------------- */}
      <aside className="glass-bar fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r md:flex">
        <div className="border-b border-white/[0.06] p-5">
          <Brand />
        </div>

        <div className="p-4">
          <UserCard />
        </div>

        <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 pb-4" aria-label="Navigasi utama">
          {NAVIGATION.map((item) => (
            <NavLink key={item.name} item={item} />
          ))}
        </nav>

        <div className="space-y-3 border-t border-white/[0.06] p-4">
          <div className="flex items-center gap-2 px-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <p className="hud">sesi aktif</p>
          </div>
          <button type="button" onClick={handleLogout} className="btn btn-danger w-full">
            Logout
          </button>
        </div>
      </aside>

      {/* --------------------------------- Konten utama -------------------------------- */}
      <div className="md:pl-72">
        {/* Topbar: lengket supaya konteks halaman tetap terlihat saat menggulir. */}
        <header className="glass-bar sticky top-0 z-20 border-b">
          <div className="flex items-center gap-3 px-4 py-3 md:px-8">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Buka menu"
              aria-expanded={mobileMenuOpen}
              className="rounded-lg border border-white/10 p-2 text-slate-300 transition-colors hover:bg-white/[0.06] md:hidden"
            >
              <MenuIcon className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1">
              <p className="hud">AI Multimodal App</p>
              <p className="truncate text-sm font-semibold text-slate-200">
                {activeItem?.name || 'Workspace'}
              </p>
            </div>

            <Link
              to="/profile"
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 transition-colors hover:border-cyan-300/35 hover:bg-cyan-300/[0.07]"
            >
              <span className="hidden text-right sm:block">
                <span className="block text-xs font-semibold text-slate-200">
                  {user?.displayName || 'User'}
                </span>
                <span className="hud">{user?.role === 'admin' ? 'admin' : 'member'}</span>
              </span>
              <Avatar user={user} />
            </Link>
          </div>
          <div className="divider-glow" />
        </header>

        <main className="px-4 pb-28 pt-6 md:px-8 md:pb-10 md:pt-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      {/* --------------------------- Navigasi bawah (mobile) -------------------------- */}
      <nav
        className="glass-bar safe-bottom fixed bottom-0 left-0 right-0 z-30 border-t md:hidden"
        aria-label="Navigasi bawah"
      >
        <div className="flex items-stretch justify-around">
          {NAVIGATION.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)

            return (
              <Link
                key={item.name}
                to={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-1 flex-col items-center gap-1 px-1 py-3 text-[10px] font-medium transition-colors ${
                  active ? 'text-cyan-300' : 'text-slate-500'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="truncate">{item.short || item.name.split(' ')[0]}</span>
                <span
                  className={`h-0.5 w-6 rounded-full bg-gradient-to-r from-aurora-cyan to-aurora-violet transition-opacity ${
                    active ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

export default Layout
