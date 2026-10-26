import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminAPI, resolveMediaUrl } from '../../config/api'
import AdminLayout from '../../components/AdminLayout'
import { Alert, GlassPanel, PageHeader, SectionTitle, StatTile } from '../../components/ui'

const rupiah = (value) => `Rp${Number(value || 0).toLocaleString('id-ID')}`

const tanggal = (value) =>
  value
    ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
    : '—'

const MEDIA_LABEL = {
  'text-to-image': 'gambar dari teks',
  'image-to-image': 'edit gambar',
  'text-to-video': 'video dari teks',
  'image-to-video': 'video dari gambar',
  'text-to-sound': 'suara dari teks',
  'sound-to-text': 'transkrip suara'
}

const MEDIA_ICON = {
  'text-to-image': '🖼️',
  'image-to-image': '🖼️',
  'text-to-video': '🎬',
  'image-to-video': '🎬',
  'text-to-sound': '🎧',
  'sound-to-text': '🎧'
}

const STATUS_CHIP = {
  completed: 'chip chip-ok',
  processing: 'chip chip-accent',
  pending: 'chip chip-warn',
  failed: 'chip chip-danger',
  paid: 'chip chip-ok',
  expired: 'chip chip-warn'
}

const AdminMemberDetail = () => {
  const { uid } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let aktif = true

    const fetchDetail = async () => {
      setLoading(true)
      setError('')

      try {
        const response = await adminAPI.getMemberDetail(uid)
        if (aktif) setData(response.data)
      } catch (err) {
        if (aktif) {
          setError(err.response?.data?.message || 'Gagal memuat rincian user.')
        }
      } finally {
        if (aktif) setLoading(false)
      }
    }

    fetchDetail()

    // Halaman bisa ditinggal sebelum permintaan selesai; jangan set state lagi.
    return () => {
      aktif = false
    }
  }, [uid])

  const backLink = (
    <Link to="/admin/members" className="btn btn-ghost text-xs">
      ← Kembali ke members
    </Link>
  )

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" />
            <p className="hud animate-pulse-glow">memuat rincian user…</p>
          </div>
        </div>
      </AdminLayout>
    )
  }

  if (error || !data?.user) {
    return (
      <AdminLayout>
        <div className="space-y-5">
          <PageHeader eyebrow="kontrol" title="Detail Member" actions={backLink} />
          <Alert tone="danger">{error || 'User tidak ditemukan.'}</Alert>
        </div>
      </AdminLayout>
    )
  }

  const { user, summary, chatSessions = [], media = [], payments = [] } = data
  const isPaid = user.plan === 'paid'

  return (
    <AdminLayout>
      <div className="space-y-5">
        <PageHeader
          eyebrow="kontrol · member"
          title={user.displayName}
          description={`${user.email} · ${user.isApproved ? 'disetujui' : 'menunggu persetujuan'}`}
          actions={backLink}
        />

        {/* --------------------------- Ringkasan aktivitas ------------------------ */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            label="📄 sesi chat"
            value={summary.chatSessions || 0}
            hint={`${chatSessions.length} sesi terbaru ditampilkan`}
            accent="cyan"
          />
          <StatTile
            label="🎨 media dibuat"
            value={summary.media || 0}
            hint={`${media.length} media terbaru ditampilkan`}
            accent="fuchsia"
          />
          <StatTile
            label="🧾 transaksi"
            value={summary.payments || 0}
            accent="violet"
          />
          <StatTile
            label="💰 total dibayar"
            value={rupiah(summary.totalPaid)}
            accent="teal"
          />
        </div>

        {/* -------------------------------- Profil ------------------------------- */}
        <GlassPanel className="p-5 sm:p-6">
          <SectionTitle hint="Data akun dan jejak pendaftaran yang tercatat saat register.">
            Profil
          </SectionTitle>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className={isPaid ? 'chip chip-accent' : 'chip'}>
              {isPaid ? 'member paid · kuota 5x' : 'member free'}
            </span>
            <span className={user.isApproved ? 'chip chip-ok' : 'chip chip-warn'}>
              {user.isApproved ? 'approved' : 'pending'}
            </span>
            {user.selectedPlan === 'paid' && !isPaid && (
              <span className="chip chip-warn">memilih paid · menunggu pembayaran</span>
            )}
          </div>

          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['uid', user.uid],
              ['kode referral', user.referralCode || '—'],
              ['terdaftar', tanggal(user.createdAt)],
              ['login terakhir', tanggal(user.lastLogin)],
              ['paket aktif sejak', tanggal(user.planActivatedAt)],
              ['IP saat daftar', user.registrationMeta?.ip || '—'],
              [
                'lokasi saat daftar',
                user.registrationMeta?.location || '—'
              ]
            ].map(([label, value]) => (
              <div key={label} className="glass-inset px-3.5 py-2.5">
                <dt className="hud">{label}</dt>
                <dd className="mt-1 break-all font-mono text-xs text-slate-300">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-3 font-mono text-xs text-slate-500">
            kuota tersisa — chat {user.quota?.chat || 0} · gambar{' '}
            {user.quota?.imageGeneration || 0} · video {user.quota?.videoGeneration || 0} · audio{' '}
            {user.quota?.audioGeneration || 0}
          </p>
        </GlassPanel>

        {/* --------------------------------- Chat -------------------------------- */}
        <GlassPanel className="overflow-hidden">
          <div className="border-b border-white/[0.06] p-5 sm:p-6">
            <SectionTitle
              className="mb-0"
              hint="Klik satu sesi untuk membaca isi percakapannya."
            >
              Chat ({chatSessions.length})
            </SectionTitle>
          </div>

          {chatSessions.length > 0 ? (
            <div className="divide-y divide-white/[0.06]">
              {chatSessions.map((session) => (
                <details key={session.sessionId} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 transition-colors hover:bg-white/[0.03]">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">
                        {session.title || 'New Chat'}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        {tanggal(session.updatedAt)} · {session.messages?.length || 0} pesan
                        {session.provider ? ` · ${session.provider}` : ''}
                        {session.model ? `/${session.model}` : ''}
                      </p>
                    </div>
                    <span className="chip group-open:hidden">buka</span>
                    <span className="chip hidden group-open:inline-flex">tutup</span>
                  </summary>

                  <div className="space-y-3 px-4 pb-4">
                    {(session.messages || []).length > 0 ? (
                      session.messages.map((message, index) => (
                        <div
                          key={`${session.sessionId}-${index}`}
                          className="glass-inset px-3.5 py-2.5"
                        >
                          <p className="hud mb-1.5">
                            {message.role === 'user' ? 'user' : 'asisten'} ·{' '}
                            {tanggal(message.timestamp)}
                          </p>
                          <p className="whitespace-pre-wrap break-words text-sm text-slate-300">
                            {message.content}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500">Sesi ini belum punya pesan.</p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500">Belum ada sesi chat.</p>
            </div>
          )}

          {summary.chatSessions > chatSessions.length && (
            <p className="border-t border-white/[0.06] p-4 text-center text-xs text-slate-500">
              Menampilkan {chatSessions.length} dari {summary.chatSessions} sesi terbaru.
            </p>
          )}
        </GlassPanel>

        {/* -------------------------------- Media -------------------------------- */}
        <GlassPanel className="overflow-hidden">
          <div className="border-b border-white/[0.06] p-5 sm:p-6">
            <SectionTitle className="mb-0" hint="Hasil generate terbaru milik user ini.">
              Media ({media.length})
            </SectionTitle>
          </div>

          {media.length > 0 ? (
            <div className="divide-y divide-white/[0.06]">
              {media.map((item) => {
                const url = resolveMediaUrl(item.outputUrl)

                return (
                  <div key={item.contentId} className="flex items-start gap-3 p-4">
                    {item.status === 'completed' && item.type.includes('image') && url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="flex-shrink-0">
                        <img
                          src={url}
                          alt={item.prompt}
                          className="h-14 w-14 rounded-lg object-cover ring-1 ring-white/15"
                        />
                      </a>
                    ) : (
                      <span className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-lg bg-white/[0.04] text-xl">
                        {MEDIA_ICON[item.type] || '📄'}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={STATUS_CHIP[item.status] || 'chip'}>{item.status}</span>
                        <span className="text-[11px] uppercase tracking-wide text-slate-500">
                          {MEDIA_LABEL[item.type] || item.type}
                        </span>
                        <span className="font-mono text-[11px] text-slate-600">
                          {tanggal(item.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 break-words text-sm text-slate-300">
                        {item.prompt}
                      </p>
                      {item.status === 'failed' && item.error?.message && (
                        <p className="mt-1 break-words text-xs text-rose-300">
                          {item.error.message}
                        </p>
                      )}
                      {url && item.status === 'completed' && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs text-cyan-300 hover:text-cyan-200"
                        >
                          buka hasil →
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500">Belum ada media.</p>
            </div>
          )}

          {summary.media > media.length && (
            <p className="border-t border-white/[0.06] p-4 text-center text-xs text-slate-500">
              Menampilkan {media.length} dari {summary.media} media terbaru.
            </p>
          )}
        </GlassPanel>

        {/* ------------------------------ Pembayaran ----------------------------- */}
        <GlassPanel className="overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] p-5 sm:p-6">
            <SectionTitle className="mb-0" hint="Riwayat transaksi upgrade member paid.">
              Pembayaran ({payments.length})
            </SectionTitle>
            <span className="chip chip-accent">total {rupiah(summary.totalPaid)}</span>
          </div>

          {payments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="bg-white/[0.03]">
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
                      className="border-b border-white/[0.06] last:border-0"
                    >
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
              <p className="text-sm text-slate-500">Belum ada transaksi.</p>
            </div>
          )}
        </GlassPanel>
      </div>
    </AdminLayout>
  )
}

export default AdminMemberDetail
