/*
 * Potongan UI bersama tema "Aurora Glass".
 *
 * Semua halaman memakai komponen ini supaya permukaan kaca, label HUD, dan
 * jarak antar-blok konsisten — kalau tiap halaman menulis kelasnya sendiri,
 * tema akan cepat menyimpang lagi.
 */

/** Permukaan kaca. `hover` dipakai untuk panel yang bisa diklik. */
export const GlassPanel = ({ as: Tag = 'div', hover = false, className = '', children, ...rest }) => (
  <Tag
    className={`glass-panel ${hover ? 'glass-interactive' : ''} ${className}`}
    {...rest}
  >
    {children}
  </Tag>
)

/**
 * Judul halaman: satu-satunya `h1` di halaman.
 * `eyebrow` (label HUD) dan `actions` (tombol di kanan) opsional.
 */
export const PageHeader = ({ eyebrow, title, description, actions, className = '' }) => (
  <div className={`flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between ${className}`}>
    <div className="min-w-0">
      {eyebrow && <p className="hud mb-2">{eyebrow}</p>}
      <h1 className="text-grad text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      {description && <p className="mt-2 max-w-2xl text-sm text-slate-400 text-balance">{description}</p>}
    </div>
    {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>
)

/** Judul bagian di dalam halaman, dengan garis aksen kecil. */
export const SectionTitle = ({ children, hint, action, className = '' }) => (
  <div className={`mb-4 flex items-end justify-between gap-4 ${className}`}>
    <div>
      <div className="flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-gradient-to-b from-aurora-cyan to-aurora-violet" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">{children}</h2>
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
    {action}
  </div>
)

const ACCENTS = {
  cyan: { ring: 'from-aurora-cyan/25', text: 'text-cyan-300', dot: 'bg-cyan-400' },
  violet: { ring: 'from-aurora-violet/25', text: 'text-violet-300', dot: 'bg-violet-400' },
  teal: { ring: 'from-aurora-teal/25', text: 'text-teal-300', dot: 'bg-teal-400' },
  fuchsia: { ring: 'from-aurora-fuchsia/25', text: 'text-fuchsia-300', dot: 'bg-fuchsia-400' },
}

/** Kotak angka: dipakai untuk kuota. `valueProps` meneruskan data-testid dsb. */
export const StatTile = ({ label, value, hint, accent = 'cyan', valueProps = {} }) => {
  const tone = ACCENTS[accent] || ACCENTS.cyan

  return (
    <div className="glass-inset relative overflow-hidden p-4">
      <div
        className={`pointer-events-none absolute inset-x-0 -top-16 h-24 bg-gradient-to-b ${tone.ring} to-transparent blur-2xl`}
      />
      <p className="hud">{label}</p>
      <p className={`mt-2 font-mono text-2xl font-semibold ${tone.text}`} {...valueProps}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

/*
 * Nama kelas ditulis lengkap di sini (bukan disusun jadi `alert-${tone}`) karena
 * Tailwind hanya mempertahankan kelas yang teksnya benar-benar muncul di sumber.
 * Kalau digabung dinamis, gaya alert bisa hilang dari CSS hasil build.
 */
const ALERT_TONES = {
  danger: 'alert-danger',
  warn: 'alert-warn',
  info: 'alert-info',
  ok: 'alert-ok'
}

/** Petunjuk kesalahan/informasi. `tone` menentukan warna tepi dan teksnya. */
export const Alert = ({ tone = 'info', children, className = '' }) => (
  <div
    role={tone === 'danger' ? 'alert' : undefined}
    className={`alert ${ALERT_TONES[tone] || ALERT_TONES.info} ${className}`}
  >
    {children}
  </div>
)

export default { GlassPanel, PageHeader, SectionTitle, StatTile, Alert }
