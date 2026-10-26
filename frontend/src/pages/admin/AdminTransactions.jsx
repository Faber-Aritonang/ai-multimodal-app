import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminAPI } from '../../config/api'
import AdminLayout from '../../components/AdminLayout'
import { Alert, GlassPanel, PageHeader, SectionTitle, StatTile } from '../../components/ui'

const rupiah = (value) => `Rp${Number(value || 0).toLocaleString('id-ID')}`

const tanggal = (value) =>
  value
    ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
    : '—'

const STATUS_CHIP = {
  paid: 'chip chip-ok',
  pending: 'chip chip-warn',
  failed: 'chip chip-danger',
  expired: 'chip chip-warn'
}

const STATUS_OPTIONS = [
  { value: '', label: 'semua' },
  { value: 'paid', label: 'paid' },
  { value: 'pending', label: 'pending' },
  { value: 'failed', label: 'failed' },
  { value: 'expired', label: 'expired' }
]

const AdminTransactions = () => {
  const [payments, setPayments] = useState([])
  const [meta, setMeta] = useState({ count: 0, totalPaid: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // `keyword` yang diketik dan `appliedKeyword` yang benar-benar dikirim ke
  // server dipisah supaya pengetikan tidak menjadi satu permintaan per huruf
  // (lihat debounce di bawah).
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [status, setStatus] = useState('')

  const fetchPayments = async (params = {}) => {
    setLoading(true)
    setError('')

    try {
      const response = await adminAPI.getPayments(params)
      setPayments(response.data.payments || [])
      setMeta({
        count: response.data.count || 0,
        totalPaid: response.data.totalPaid || 0
      })
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memuat transaksi.')
    } finally {
      setLoading(false)
    }
  }

  // Kata kunci (nama/email user) dijalankan setelah admin berhenti mengetik.
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = keyword.trim()
      setAppliedKeyword((prev) => (prev === q ? prev : q))
    }, 400)

    return () => clearTimeout(timer)
  }, [keyword])

  useEffect(() => {
    fetchPayments({ q: appliedKeyword, status })
  }, [appliedKeyword, status])

  const filterAktif = appliedKeyword !== '' || status !== ''

  const resetFilter = () => {
    setKeyword('')
    setAppliedKeyword('')
    setStatus('')
  }

  return (
    <AdminLayout>
      <div className="space-y-5">
        <PageHeader
          eyebrow="kontrol · keuangan"
          title="Transaksi"
          description="Riwayat pembayaran upgrade ke member paid dari semua user, terbaru lebih dulu."
          actions={
            <button
              type="button"
              onClick={() => fetchPayments({ q: appliedKeyword, status })}
              disabled={loading}
              className="btn btn-ghost text-xs disabled:cursor-wait disabled:opacity-50"
            >
              Refresh
            </button>
          }
        />

        {error && <Alert tone="danger">{error}</Alert>}

        {/* -------------------------------- Filter ------------------------------- */}
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1">
              <label htmlFor="payment-search" className="hud mb-1.5 block">
                cari user
              </label>
              <input
                id="payment-search"
                type="search"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                className="field"
                placeholder="nama atau email"
              />
            </div>

            <div>
              <p className="hud mb-1.5">status</p>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Filter status transaksi"
              >
                {STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.value || 'semua'}
                    type="button"
                    onClick={() => setStatus(option.value)}
                    aria-pressed={status === option.value}
                    className={`btn text-xs ${
                      status === option.value ? 'btn-primary' : 'btn-ghost'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filterAktif && (
            <p className="mt-3 text-xs text-slate-500">
              {meta.count} transaksi cocok
              {appliedKeyword ? ` untuk “${appliedKeyword}”` : ''}
              {status ? ` dengan status ${status}` : ''}.{' '}
              <button
                type="button"
                onClick={resetFilter}
                className="text-cyan-300 hover:text-cyan-200"
              >
                Reset filter
              </button>
            </p>
          )}
        </GlassPanel>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="💰 total diterima"
            value={rupiah(meta.totalPaid)}
            hint="seluruh transaksi paid, tidak terpengaruh filter"
            accent="teal"
          />
          <StatTile
            label="🧾 jumlah transaksi"
            value={meta.count}
            hint="sesuai pencarian & filter yang aktif"
            accent="violet"
          />
          <StatTile
            label="📄 ditampilkan"
            value={payments.length}
            hint="maksimal 100 transaksi per permintaan"
            accent="cyan"
          />
        </div>

        <GlassPanel className="overflow-hidden">
          <div className="border-b border-white/[0.06] p-5 sm:p-6">
            <SectionTitle className="mb-0" hint="Klik nama user untuk membuka aktivitasnya.">
              Daftar Transaksi
            </SectionTitle>
          </div>

          {loading ? (
            <div className="flex min-h-[240px] items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" />
                <p className="hud animate-pulse-glow">memuat transaksi…</p>
              </div>
            </div>
          ) : payments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="bg-white/[0.03]">
                    <th className="hud p-4 text-left">user</th>
                    <th className="hud p-4 text-left">order</th>
                    <th className="hud p-4 text-left">tanggal</th>
                    <th className="hud p-4 text-left">status</th>
                    <th className="hud p-4 text-left">metode</th>
                    <th className="hud p-4 text-right">nominal</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr
                      key={payment.orderId}
                      className="border-b border-white/[0.06] transition-colors last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="p-4">
                        {payment.user ? (
                          <Link
                            to={`/admin/members/${payment.user.uid}`}
                            className="block font-medium text-slate-200 hover:text-cyan-200"
                          >
                            {payment.user.displayName}
                            <span className="mt-0.5 block text-xs font-normal text-slate-500">
                              {payment.user.email}
                            </span>
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-slate-500">
                            {payment.uid}
                          </span>
                        )}
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-300">
                        {payment.orderId}
                        {payment.provider && (
                          <span className="mt-0.5 block text-[11px] text-slate-600">
                            {payment.provider}
                          </span>
                        )}
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-500">
                        {tanggal(payment.createdAt)}
                        {payment.paidAt && (
                          <span className="mt-0.5 block text-[11px] text-emerald-300/80">
                            dibayar {tanggal(payment.paidAt)}
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <span className={STATUS_CHIP[payment.status] || 'chip'}>
                          {payment.status}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-slate-400">
                        {payment.paymentType || '—'}
                      </td>
                      <td className="p-4 text-right font-mono text-xs text-cyan-300">
                        {rupiah(payment.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500">
                {filterAktif
                  ? 'Tidak ada transaksi yang cocok dengan filter.'
                  : 'Belum ada transaksi.'}
              </p>
            </div>
          )}

          {meta.count > payments.length && (
            <p className="border-t border-white/[0.06] p-4 text-center text-xs text-slate-500">
              Menampilkan {payments.length} dari {meta.count} transaksi terbaru.
            </p>
          )}
        </GlassPanel>
      </div>
    </AdminLayout>
  )
}

export default AdminTransactions
