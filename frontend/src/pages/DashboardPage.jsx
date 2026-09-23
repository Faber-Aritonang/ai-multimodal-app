import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { memberAPI } from '../config/api'
import Layout from '../components/Layout'
import { GlassPanel, SectionTitle, StatTile } from '../components/ui'

// `accent` menentukan warna gradien ikon dan sorotan kartu; dipisah dari data
// utama supaya daftar fitur tetap enak dibaca.
const FEATURES = [
  {
    id: 'chat',
    title: 'Chat',
    description: 'Percakapan AI dengan jawaban berformat rapi.',
    icon: '💬',
    path: '/chat',
    available: true,
    accent: 'from-cyan-400/30 to-blue-500/10',
    ring: 'group-hover:border-cyan-300/40'
  },
  {
    id: 'text-to-image',
    title: 'Text to Image',
    description: 'Buat gambar dari deskripsi teks.',
    icon: '🎨',
    path: '/tools/text-to-image',
    available: true,
    accent: 'from-violet-400/30 to-fuchsia-500/10',
    ring: 'group-hover:border-violet-300/40'
  },
  {
    id: 'image-to-image',
    title: 'Image to Image',
    description: 'Ubah gaya atau isi gambar yang sudah ada.',
    icon: '🖼️',
    path: '/tools/image-to-image',
    available: true,
    accent: 'from-fuchsia-400/30 to-rose-500/10',
    ring: 'group-hover:border-fuchsia-300/40'
  },
  {
    id: 'text-to-video',
    title: 'Text to Video',
    description: 'Hasilkan video pendek dari teks.',
    icon: '🎬',
    path: '/tools/text-to-video',
    available: true,
    accent: 'from-rose-400/30 to-rose-500/10',
    ring: 'group-hover:border-rose-300/40'
  },
  {
    id: 'image-to-video',
    title: 'Image to Video',
    description: 'Hidupkan gambar menjadi video.',
    icon: '🎥',
    path: '/tools/image-to-video',
    available: true,
    accent: 'from-amber-400/30 to-amber-500/10',
    ring: 'group-hover:border-amber-300/40'
  },
  {
    id: 'text-to-sound',
    title: 'Text to Sound',
    description: 'Ubah teks menjadi suara, lengkap dengan pilihan voice dan gaya bicara.',
    icon: '🔊',
    path: '/tools/text-to-sound',
    available: true,
    accent: 'from-emerald-400/30 to-teal-500/10',
    ring: 'group-hover:border-emerald-300/40'
  },
  {
    id: 'sound-to-text',
    title: 'Sound to Text',
    description: 'Transkrip audio atau rekaman suara menjadi teks.',
    icon: '📝',
    path: '/tools/sound-to-text',
    available: true,
    accent: 'from-sky-400/30 to-indigo-500/10',
    ring: 'group-hover:border-sky-300/40'
  }
]

// Ditulis satu per satu (bukan `rise-${index}`) supaya Tailwind ikut menyertakan
// kelasnya ke CSS hasil build.
const RISE_STEPS = ['rise-1', 'rise-2', 'rise-3', 'rise-4', 'rise-5', 'rise-6']

const QUOTA_TILES = [
  { key: 'chat', label: 'chat', accent: 'cyan' },
  { key: 'imageGeneration', label: 'gambar', accent: 'violet' },
  // Fitur suara (text-to-sound) memakai jatah ini — satu kuota untuk media
  // non-gambar, supaya akun yang sudah ada tidak perlu field kuota baru.
  { key: 'videoGeneration', label: 'video & audio', accent: 'teal' },
  { key: 'total', label: 'total', accent: 'fuchsia' }
]

const DashboardPage = ({ user, setUser }) => {
  const navigate = useNavigate()
  const [quota, setQuota] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchQuota()
  }, [])

  const fetchQuota = async () => {
    try {
      const response = await memberAPI.getQuota()
      setQuota(response.data.quota)
    } catch (error) {
      console.error('Failed to fetch quota:', error)
    } finally {
      setLoading(false)
    }
  }

  const availableCount = FEATURES.filter((f) => f.available).length

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-6">
        {/* ------------------------------- Sambutan ------------------------------- */}
        <GlassPanel className="rise overflow-hidden p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="hud mb-2">workspace</p>
              <h1 className="text-grad text-2xl font-bold tracking-tight sm:text-3xl">
                Welcome back, {user?.displayName || 'User'}!
              </h1>
              <p className="mt-2 max-w-xl text-sm text-slate-400 text-balance">
                Pilih alat di bawah untuk mulai. Fitur baru ditambahkan bertahap —
                yang belum aktif ditandai <span className="text-slate-300">Coming Soon</span>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="chip chip-accent">{availableCount} alat aktif</span>
              <span className="chip">{FEATURES.length - availableCount} segera hadir</span>
            </div>
          </div>
        </GlassPanel>

        {/* --------------------------------- Kuota -------------------------------- */}
        {!loading && quota && (
          <GlassPanel className="rise rise-1 p-5 sm:p-6">
            <SectionTitle hint="Sisa jatah pemakaian akun Anda saat ini.">Kuota Anda</SectionTitle>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {QUOTA_TILES.map((tile) => (
                <StatTile
                  key={tile.key}
                  label={tile.label}
                  value={quota[tile.key] || 0}
                  accent={tile.accent}
                  valueProps={{ 'data-testid': 'quota-value', 'data-quota-key': tile.key }}
                />
              ))}
            </div>
          </GlassPanel>
        )}

        {/* ---------------------------------- Alat -------------------------------- */}
        <div>
          <SectionTitle hint="Klik kartu untuk membuka alatnya.">AI Tools</SectionTitle>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <article
                key={feature.id}
                data-testid="tool-card"
                data-available={feature.available}
                onClick={() => feature.available && navigate(feature.path)}
                onKeyDown={(event) => {
                  if (feature.available && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    navigate(feature.path)
                  }
                }}
                role={feature.available ? 'button' : undefined}
                tabIndex={feature.available ? 0 : undefined}
                aria-disabled={feature.available ? undefined : true}
                className={`
                  glass-panel group relative flex flex-col overflow-hidden p-5 text-left
                  rise ${RISE_STEPS[Math.min(index, RISE_STEPS.length - 1)]}
                  ${feature.available
                    ? `glass-interactive cursor-pointer ${feature.ring}`
                    : 'cursor-not-allowed opacity-55'
                  }
                `}
              >
                <div className="mb-4 flex items-start justify-between">
                  <span
                    className={`grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-gradient-to-br ${feature.accent} text-xl`}
                  >
                    {feature.icon}
                  </span>

                  {feature.available ? (
                    <span className="chip chip-ok">aktif</span>
                  ) : (
                    <span className="chip">Coming Soon</span>
                  )}
                </div>

                <h3 className="text-base font-semibold text-slate-100">{feature.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{feature.description}</p>

                <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
                  <span className="hud">{feature.id}</span>
                  {/* Panah hanya muncul saat kartu benar-benar bisa dibuka. */}
                  {feature.available && (
                    <span className="text-cyan-300 transition-transform duration-200 group-hover:translate-x-1">
                      →
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default DashboardPage
