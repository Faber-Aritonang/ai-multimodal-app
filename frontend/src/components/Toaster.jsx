/**
 * Tumpukan notifikasi (toast) di sudut layar.
 *
 * Komponen ini hanya MENAMPILKAN: seluruh state dan keputusan "kapan memberi
 * tahu" ada di NotificationsProvider. Pemisahan ini disengaja supaya komponen
 * presentasionalnya mudah dibaca — dan supaya tidak ada cara menampilkan pesan
 * tanpa lewat satu jalur (yang mencatatnya juga).
 *
 * Diletakkan `fixed` di kanan bawah dan `z-50` di atas sidebar/drawer, karena
 * notifikasi ini paling sering muncul saat user sudah pindah ke halaman lain.
 */

const TONE = {
  success: 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100',
  error: 'border-rose-400/35 bg-rose-500/10 text-rose-100',
  info: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-50'
}

const IKON = {
  success: '✓',
  error: '!',
  info: 'i'
}

const Toaster = ({ toasts = [], onDismiss }) => {
  if (!toasts.length) return null

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          data-toast-tone={toast.tone || 'info'}
          className={`glass-panel pointer-events-auto flex items-start gap-3 p-3.5 text-sm rise ${
            TONE[toast.tone] || TONE.info
          }`}
        >
          <span className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border border-current/30 font-mono text-[11px]">
            {IKON[toast.tone] || IKON.info}
          </span>

          <div className="min-w-0 flex-1">
            <p className="font-semibold">{toast.title}</p>
            {toast.message && <p className="mt-0.5 text-xs opacity-90">{toast.message}</p>}
            {toast.action && (
              <a href={toast.action.href} className="mt-2 inline-block text-xs font-semibold underline">
                {toast.action.label}
              </a>
            )}
          </div>

          <button
            type="button"
            onClick={() => onDismiss?.(toast.id)}
            aria-label="Tutup notifikasi"
            className="flex-shrink-0 rounded-lg px-1.5 text-lg leading-none opacity-70 transition-opacity hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export default Toaster
