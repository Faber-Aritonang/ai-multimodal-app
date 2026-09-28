import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authAPI, paymentAPI } from '../config/api'
import Layout from '../components/Layout'
import { GlassPanel, PageHeader, SectionTitle, Alert } from '../components/ui'

const formatRupiah = (amount) =>
  amount > 0 ? `Rp ${amount.toLocaleString('id-ID')}` : 'Gratis'

const STATUS_LABEL = {
  pending: 'menunggu pembayaran',
  paid: 'lunas',
  failed: 'gagal',
  expired: 'kedaluwarsa'
}

/**
 * Halaman upgrade ke member paid.
 *
 * Dua pemakai:
 *   - member free yang menekan link "Upgrade" (dashboard/profil)
 *   - pendaftar yang memilih paket "Member Paid" (dialihkan ke sini setelah
 *     daftar, untuk menyelesaikan pembayaran)
 *
 * Pembayaran diproses gateway Duitku: tombol bayar memanggil POST /payment/create
 * lalu mengarahkan browser ke halaman pembayaran Duitku. Status akhir
 * dikonfirmasi webhook di backend, jadi halaman ini hanya MEMANTAU (polling) —
 * tombol "saya sudah bayar" tidak pernah mengubah status sendiri.
 */
const UpgradePage = ({ user, setUser }) => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const cameBackFromPayment = searchParams.get('status') === 'done'

  const [plans, setPlans] = useState([])
  const [paymentStatus, setPaymentStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef(null)

  const isPaid = paymentStatus?.plan === 'paid' || user?.plan === 'paid'

  useEffect(() => {
    fetchData()

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const fetchData = async () => {
    try {
      const [plansRes, statusRes] = await Promise.all([
        paymentAPI.getPlans(),
        paymentAPI.getStatus()
      ])
      setPlans(plansRes.data.plans || [])
      setPaymentStatus(statusRes.data)

      // Baru kembali dari halaman pembayaran, atau masih ada transaksi pending:
      // pantau sampai webhook Duitku mengonfirmasi (atau user menutup tab).
      if (searchParams.get('status') === 'done' || statusRes.data.awaitingPayment) {
        startPolling()
      }
    } catch (err) {
      console.error('Failed to fetch upgrade info:', err)
      setError(err.response?.data?.message || 'Gagal memuat informasi paket.')
    } finally {
      setLoading(false)
    }
  }

  // Polling status pembayaran. Webhook Duitku yang mengaktifkan akun;
  // polling hanya menunggu hasilnya lalu menyegarkan state user di App.jsx.
  const startPolling = () => {
    if (pollRef.current) return

    pollRef.current = setInterval(async () => {
      try {
        const response = await paymentAPI.getStatus()
        setPaymentStatus(response.data)

        if (response.data.plan === 'paid') {
          clearInterval(pollRef.current)
          pollRef.current = null

          const statusRes = await authAPI.getStatus()
          const freshUser = statusRes.data.user

          if (freshUser) {
            setUser?.(freshUser)
            localStorage.setItem('user', JSON.stringify(freshUser))
          }
        }
      } catch (err) {
        console.error('Payment status poll failed:', err)
      }
    }, 5000)
  }

  const handlePay = async () => {
    if (paying) return

    setPaying(true)
    setError('')

    try {
      const response = await paymentAPI.createUpgrade()
      const redirectUrl = response.data.redirectUrl

      if (!redirectUrl) {
        throw new Error('Tidak ada URL pembayaran dari gateway.')
      }

      // Pindah ke halaman pembayaran Duitku (penuh, bukan popup).
      window.location.href = redirectUrl
    } catch (err) {
      console.error('Failed to start payment:', err)
      setError(
        err.response?.data?.message ||
          err.message ||
          'Gagal memulai pembayaran. Coba lagi.'
      )
      setPaying(false)
    }
  }

  const freePlan = plans.find((p) => p.id === 'free')
  const paidPlan = plans.find((p) => p.id === 'paid')
  const pendingPayment = paymentStatus?.latestPayment

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="keanggotaan"
          title="Upgrade ke Member Paid"
          description="Dapatkan kuota 5x lipat member biasa — chat, gambar, audio, dan video. Aktif langsung setelah pembayaran diterima, tanpa antre persetujuan admin."
        />

        {error && (
          <Alert tone="danger">{error}</Alert>
        )}

        {/* --------------------------- Sudah member paid --------------------------- */}
        {isPaid && (
          <GlassPanel className="p-6">
            <Alert tone="success">
              Anda sudah menjadi <strong>Member Paid</strong>
              {paymentStatus?.planActivatedAt &&
                ` — aktif sejak ${new Date(paymentStatus.planActivatedAt).toLocaleDateString('id-ID')}`}
              . Kuota 5x lipat sudah terpasang di akun Anda.
            </Alert>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="btn btn-primary mt-5"
            >
              Buka Dashboard
            </button>
          </GlassPanel>
        )}

        {/* ---------------------- Menunggu pembayaran berjalan ---------------------- */}
        {!isPaid && paymentStatus?.awaitingPayment && (
          <GlassPanel className="p-6">
            <SectionTitle hint="Transaksi ini dibuat saat Anda menekan tombol bayar.">
              Pembayaran Anda
            </SectionTitle>
            <div className="glass-inset mt-3 flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-mono text-xs text-slate-500">
                  {pendingPayment?.orderId}
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  {formatRupiah(pendingPayment?.amount || 0)} ·{' '}
                  <span className="chip chip-warn">
                    {STATUS_LABEL[pendingPayment?.status] || pendingPayment?.status}
                  </span>
                </p>
              </div>
              {pendingPayment?.redirectUrl && (
                <button
                  type="button"
                  onClick={handlePay}
                  disabled={paying}
                  className="btn btn-primary"
                >
                  {paying ? 'Mengalihkan…' : 'Lanjutkan pembayaran'}
                </button>
              )}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Halaman ini memeriksa status setiap 5 detik dan akan menampilkan konfirmasi
              begitu pembayaran diterima — tidak perlu refresh manual.
            </p>
          </GlassPanel>
        )}

        {/* ---------------------------- Perbandingan paket --------------------------- */}
        {!loading && (
          <div>
            <SectionTitle hint="Angka kuota & harga dihitung oleh backend.">
              Perbandingan Paket
            </SectionTitle>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[freePlan, paidPlan].filter(Boolean).map((item) => (
                <GlassPanel
                  key={item.id}
                  className={`p-6 ${item.id === 'paid' ? 'ring-1 ring-cyan-300/30' : ''}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-slate-100">{item.name}</h3>
                    {item.id === 'paid' && <span className="chip chip-accent">5x kuota</span>}
                  </div>

                  <p className="mt-3 text-2xl font-bold text-grad">
                    {formatRupiah(item.priceIdr)}
                    {item.priceIdr > 0 && (
                      <span className="ml-1 text-sm font-normal text-slate-400">sekali bayar</span>
                    )}
                  </p>

                  <ul className="mt-4 space-y-2">
                    <li className="flex items-center justify-between text-sm text-slate-300">
                      <span>Chat</span>
                      <span className="font-mono text-cyan-200">{item.quota?.chat}</span>
                    </li>
                    <li className="flex items-center justify-between text-sm text-slate-300">
                      <span>Gambar</span>
                      <span className="font-mono text-cyan-200">{item.quota?.imageGeneration}</span>
                    </li>
                    <li className="flex items-center justify-between text-sm text-slate-300">
                      <span>Audio</span>
                      <span className="font-mono text-cyan-200">{item.quota?.audioGeneration}</span>
                    </li>
                    <li className="flex items-center justify-between text-sm text-slate-300">
                      <span>Video</span>
                      <span className="font-mono text-cyan-200">{item.quota?.videoGeneration}</span>
                    </li>
                  </ul>

                  <ul className="mt-4 space-y-1 border-t border-white/[0.06] pt-4">
                    {(item.features || []).map((feature) => (
                      <li key={feature} className="text-xs text-slate-400">
                        · {feature}
                      </li>
                    ))}
                  </ul>

                  {item.id === 'paid' && !isPaid && (
                    <button
                      type="button"
                      onClick={handlePay}
                      disabled={paying}
                      className="btn btn-primary mt-5 w-full py-3"
                    >
                      {paying
                        ? 'Mengalihkan…'
                        : paymentStatus?.awaitingPayment
                          ? 'Bayar transaksi tertunda'
                          : `Bayar ${formatRupiah(item.priceIdr)} dengan Duitku`}
                    </button>
                  )}
                </GlassPanel>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <GlassPanel className="p-10 text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" />
            <p className="hud mt-4 animate-pulse-glow">memuat informasi paket…</p>
          </GlassPanel>
        )}

        {/* ------------------------------- Cara kerja ------------------------------- */}
        <GlassPanel className="p-6">
          <SectionTitle>Cara Upgrade</SectionTitle>
          <ol className="mt-3 space-y-2 text-sm text-slate-400">
            <li>
              <span className="text-slate-200">1.</span> Tekan tombol bayar — Anda diarahkan ke
              halaman pembayaran Duitku (virtual account, e-wallet, QRIS, dan lainnya).
            </li>
            <li>
              <span className="text-slate-200">2.</span> Selesaikan pembayaran. Duitku
              mengonfirmasi ke server kami secara otomatis.
            </li>
            <li>
              <span className="text-slate-200">3.</span> Akun langsung aktif sebagai Member Paid
              dengan kuota 5x lipat — tanpa menunggu persetujuan admin.
            </li>
          </ol>
          {cameBackFromPayment && !isPaid && (
            <Alert tone="warn" className="mt-4">
              Pembayaran belum terkonfirmasi. Jika Anda yakin sudah membayar, tunggu beberapa
              saat — status akan berubah sendiri begitu Duitku mengonfirmasi.
            </Alert>
          )}
        </GlassPanel>
      </div>
    </Layout>
  )
}

export default UpgradePage
