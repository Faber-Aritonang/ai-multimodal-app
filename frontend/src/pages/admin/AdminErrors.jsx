import { useEffect, useState } from 'react'
import { adminAPI } from '../../config/api'
import AdminLayout from '../../components/AdminLayout'
import { Alert, GlassPanel, PageHeader, SectionTitle, StatTile } from '../../components/ui'

const tanggal = (value) =>
  value
    ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
    : '—'

const AdminErrors = () => {
  const [data, setData] = useState({ total: 0, tracked: 0, capacity: 0, errors: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchErrors = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await adminAPI.getErrors()
      setData({
        total: response.data.total || 0,
        tracked: response.data.tracked || 0,
        capacity: response.data.capacity || 0,
        errors: response.data.errors || []
      })
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memuat daftar galat.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchErrors()
  }, [])

  return (
    <AdminLayout>
      <div className="space-y-5">
        <PageHeader
          eyebrow="kontrol · diagnostik"
          title="Errors"
          description="Galat terakhir yang tercatat di proses backend yang sedang berjalan. Daftar ini kosong lagi setelah restart atau deploy."
          actions={
            <button
              type="button"
              onClick={fetchErrors}
              disabled={loading}
              className="btn btn-ghost text-xs disabled:cursor-wait disabled:opacity-50"
            >
              Refresh
            </button>
          }
        />

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="⚠️ total kejadian"
            value={data.total}
            hint="setiap pengulangan ikut dihitung"
            accent="fuchsia"
          />
          <StatTile
            label="📄 galat unik"
            value={data.tracked}
            hint="yang disimpan di memori proses"
            accent="violet"
          />
          <StatTile
            label="📦 kapasitas"
            value={data.capacity}
            hint="ERROR_LOG_SIZE (bawaan 50)"
            accent="cyan"
          />
        </div>

        <GlassPanel className="overflow-hidden">
          <div className="border-b border-white/[0.06] p-5 sm:p-6">
            <SectionTitle
              className="mb-0"
              hint="Terbaru lebih dulu. Galat identik digabung dengan jumlah kejadiannya."
            >
              Galat Tercatat ({data.errors.length})
            </SectionTitle>
          </div>

          {loading ? (
            <div className="flex min-h-[240px] items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-fuchsia-300" />
                <p className="hud animate-pulse-glow">memuat galat…</p>
              </div>
            </div>
          ) : data.errors.length > 0 ? (
            <div className="divide-y divide-white/[0.06]">
              {data.errors.map((item, index) => (
                <div key={`${item.at}-${index}`} className="space-y-2 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={item.source === 'client' ? 'chip chip-warn' : 'chip chip-danger'}>
                      {item.source}
                    </span>
                    {item.status && <span className="chip">{item.status}</span>}
                    {item.count > 1 && (
                      <span className="chip chip-danger">×{item.count}</span>
                    )}
                    <span className="font-mono text-[11px] text-slate-500">
                      {item.method || '—'} {item.path || ''}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-slate-500">
                      {tanggal(item.lastAt || item.at)}
                    </span>
                  </div>

                  <p className="break-words text-sm text-slate-200">{item.message}</p>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-500">
                    {item.kind && <span>jenis: {item.kind}</span>}
                    {item.code && <span>kode: {item.code}</span>}
                    {item.uid && <span>uid: {item.uid}</span>}
                    {item.requestId && <span>request: {item.requestId}</span>}
                  </div>

                  {item.stack && (
                    <details>
                      <summary className="cursor-pointer text-xs text-cyan-300 hover:text-cyan-200">
                        lihat stack trace
                      </summary>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-ink-950/60 p-3 font-mono text-[11px] text-slate-400">
                        {item.stack}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500">
                Tidak ada galat tercatat sejak proses ini berjalan.
              </p>
            </div>
          )}
        </GlassPanel>
      </div>
    </AdminLayout>
  )
}

export default AdminErrors
