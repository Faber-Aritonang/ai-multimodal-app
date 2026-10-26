import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { adminAPI } from '../../config/api'
import AdminLayout from '../../components/AdminLayout'
import QRCode from '../../components/QRCode'
import { GlassPanel, PageHeader, SectionTitle } from '../../components/ui'

const AdminMembers = () => {
  const [pendingMembers, setPendingMembers] = useState([])
  const [approvedMembers, setApprovedMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMember, setSelectedMember] = useState(null)

  // Filter berjalan di sisi klien: daftar member sudah diambil sekaligus oleh
  // halaman ini, jadi mengetik tidak perlu memanggil API lagi. `plan` memakai
  // paket AKTIF untuk member yang sudah disetujui, dan paket PILIHAN untuk
  // pendaftar yang belum disetujui (paket aktifnya baru dipasang setelah
  // pembayaran/approval).
  const [query, setQuery] = useState('')
  const [planFilter, setPlanFilter] = useState('all')

  useEffect(() => {
    fetchMembers()
  }, [])

  const fetchMembers = async () => {
    try {
      const [pendingRes, approvedRes] = await Promise.all([
        adminAPI.getPendingMembers(),
        adminAPI.getApprovedMembers()
      ])

      setPendingMembers(pendingRes.data.members)
      setApprovedMembers(approvedRes.data.members)
      setLoading(false)
    } catch (error) {
      console.error('Failed to fetch members:', error)
      setLoading(false)
    }
  }

  const handleApprove = async (uid) => {
    try {
      // Tanpa payload kuota: backend memakai jatah default paket free
      // (backend/config/membershipPlans.js). Angka kuota tidak lagi disalin di
      // frontend supaya tidak bisa menyimpang dari aturan server.
      await adminAPI.approveMember(uid)
      fetchMembers()
    } catch (error) {
      console.error('Approval failed:', error)
    }
  }

  const handleReject = async (uid) => {
    if (!window.confirm('Reject this member?')) return

    try {
      await adminAPI.rejectMember(uid)
      fetchMembers()
    } catch (error) {
      console.error('Rejection failed:', error)
    }
  }

  const cocokFilter = (member, plan) => {
    const kata = query.trim().toLowerCase()
    const cocokKata =
      !kata ||
      [member.displayName, member.email].some((nilai) =>
        String(nilai || '').toLowerCase().includes(kata)
      )
    const cocokPaket = planFilter === 'all' || (planFilter === 'paid') === (plan === 'paid')

    return cocokKata && cocokPaket
  }

  const filteredPending = pendingMembers.filter((member) =>
    cocokFilter(member, member.selectedPlan)
  )
  const filteredApproved = approvedMembers.filter((member) =>
    cocokFilter(member, member.plan)
  )
  const filterAktif = query.trim() !== '' || planFilter !== 'all'

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" />
            <p className="hud animate-pulse-glow">memuat daftar member…</p>
          </div>
        </div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout>
      <div className="space-y-5">
        <PageHeader
          eyebrow="kontrol"
          title="Member Management"
          description="Setujui member baru dan lihat rincian kuota serta kode undangannya. Klik “lihat aktivitas” untuk membuka chat, media, dan pembayaran satu user."
        />

        {/* -------------------------------- Filter ------------------------------- */}
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1">
              <label htmlFor="member-search" className="hud mb-1.5 block">
                cari member
              </label>
              <input
                id="member-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="field"
                placeholder="nama atau email"
              />
            </div>

            <div>
              <p className="hud mb-1.5">paket</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter paket member">
                {[
                  { value: 'all', label: 'semua' },
                  { value: 'free', label: 'free' },
                  { value: 'paid', label: 'paid' }
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPlanFilter(option.value)}
                    aria-pressed={planFilter === option.value}
                    className={`btn text-xs ${
                      planFilter === option.value ? 'btn-primary' : 'btn-ghost'
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
              Menampilkan {filteredPending.length} pending dan {filteredApproved.length}{' '}
              approved yang cocok.{' '}
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setPlanFilter('all')
                }}
                className="text-cyan-300 hover:text-cyan-200"
              >
                Reset filter
              </button>
            </p>
          )}
        </GlassPanel>

        {/* ---------------------------- Menunggu review --------------------------- */}
        <GlassPanel className="overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] p-5 sm:p-6">
            <SectionTitle className="mb-0">Pending Members ({filteredPending.length})</SectionTitle>
            <span className={`chip ${filteredPending.length > 0 ? 'chip-warn' : 'chip-ok'}`}>
              {filteredPending.length > 0
                ? 'perlu tindakan'
                : filterAktif
                  ? 'tidak ada hasil'
                  : 'bersih'}
            </span>
          </div>

          {filteredPending.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="bg-white/[0.03]">
                    <th className="hud p-4 text-left">user</th>
                    <th className="hud p-4 text-left">email</th>
                    <th className="hud p-4 text-left">joined</th>
                    <th className="hud p-4 text-center">actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPending.map((member) => (
                    <tr
                      key={member._id}
                      className="border-b border-white/[0.06] transition-colors last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {member.photoURL ? (
                            <img
                              src={member.photoURL}
                              alt={member.displayName}
                              className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/15"
                            />
                          ) : (
                            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-aurora-cyan to-aurora-violet font-semibold text-ink-950">
                              {member.displayName?.charAt(0) || '?'}
                            </span>
                          )}
                          <div className="min-w-0">
                            <span className="font-medium text-slate-200">
                              {member.displayName}
                            </span>
                            <Link
                              to={`/admin/members/${member.uid}`}
                              className="mt-0.5 block text-xs text-cyan-300 hover:text-cyan-200"
                            >
                              lihat aktivitas →
                            </Link>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-slate-400">
                        {member.email}
                        {member.registrationMeta?.ip && (
                          <p
                            className="mt-0.5 font-mono text-[11px] text-slate-600"
                            title={member.registrationMeta.userAgent || ''}
                          >
                            {member.registrationMeta.ip}
                            {member.registrationMeta.location
                              ? ` · ${member.registrationMeta.location}`
                              : ''}
                          </p>
                        )}
                        {(member.registrationMeta?.sameDeviceUid ||
                          member.registrationMeta?.sameIpCount > 0) && (
                          <div className="mt-1 flex flex-col items-start gap-0.5">
                            {member.registrationMeta.sameDeviceUid && (
                              <span className="inline-flex rounded border border-rose-300/30 bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-200">
                                ⚑ device sama dengan akun lain
                              </span>
                            )}
                            {member.registrationMeta.sameIpCount > 0 && (
                              <span className="inline-flex rounded border border-amber-300/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                                IP sama dengan {member.registrationMeta.sameIpCount} akun lain
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-500">
                        {new Date(member.createdAt).toLocaleDateString()}
                        {member.selectedPlan === 'paid' && (
                          <span className="mt-1 block">
                            <span className="inline-flex rounded border border-cyan-300/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200">
                              memilih Member Paid — menunggu pembayaran
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleApprove(member.uid)}
                            className="btn border border-emerald-300/30 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-400/20"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(member.uid)}
                            className="btn btn-danger px-3 py-1.5 text-xs"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500">
                {filterAktif ? 'Tidak ada pending member yang cocok.' : 'No pending members'}
              </p>
            </div>
          )}
        </GlassPanel>

        {/* ------------------------------ Member aktif --------------------------- */}
        <GlassPanel className="overflow-hidden">
          <div className="border-b border-white/[0.06] p-5 sm:p-6">
            <SectionTitle className="mb-0" hint="Klik ikon QR untuk membagikan kode undangan member.">
              Approved Members ({filteredApproved.length})
            </SectionTitle>
          </div>

          {filteredApproved.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="bg-white/[0.03]">
                    <th className="hud p-4 text-left">user</th>
                    <th className="hud p-4 text-left">kode referral</th>
                    <th className="hud p-4 text-left">kuota</th>
                    <th className="hud p-4 text-center">qr</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApproved.map((member) => (
                    <tr
                      key={member._id}
                      className="border-b border-white/[0.06] transition-colors last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {member.photoURL ? (
                            <img
                              src={member.photoURL}
                              alt={member.displayName}
                              className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/15"
                            />
                          ) : (
                            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-300 to-teal-500 font-semibold text-ink-950">
                              {member.displayName?.charAt(0) || '?'}
                            </span>
                          )}
                          <div className="min-w-0">
                            <span className="font-medium text-slate-200">
                              {member.displayName}
                            </span>
                            <Link
                              to={`/admin/members/${member.uid}`}
                              className="mt-0.5 block text-xs text-cyan-300 hover:text-cyan-200"
                            >
                              lihat aktivitas →
                            </Link>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <code className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-xs text-cyan-200">
                          {member.referralCode || 'N/A'}
                        </code>
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-400">
                        <span className={`mb-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                          member.plan === 'paid'
                            ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-200'
                            : 'border-white/15 bg-white/[0.05] text-slate-400'
                        }`}>
                          {member.plan === 'paid' ? 'paid · kuota 5x' : 'free'}
                        </span>
                        <br />
                        Chat: {member.quota?.chat || 0} | Img: {member.quota?.imageGeneration || 0} |
                        Vid: {member.quota?.videoGeneration || 0} | Aud: {member.quota?.audioGeneration || 0}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedMember(member)}
                          title="Show QR Code"
                          aria-label="Tampilkan QR code"
                          className="btn btn-ghost px-2.5 py-1.5 text-xs"
                        >
                          📱
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500">
                {filterAktif ? 'Tidak ada approved member yang cocok.' : 'No approved members'}
              </p>
            </div>
          )}
        </GlassPanel>

        {/* --------------------------------- Modal QR ---------------------------- */}
        {selectedMember && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
            onClick={() => setSelectedMember(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Referral QR Code"
          >
            <GlassPanel
              className="w-full max-w-sm p-8 text-center"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="hud mb-2">kode undangan</p>
              <h3 className="text-grad mb-5 text-xl font-bold">Referral QR Code</h3>

              <div className="mb-5 flex justify-center">
                <QRCode
                  value={selectedMember.referralCode || selectedMember.email}
                  size={192}
                  onError={() => {}}
                />
              </div>

              <p className="hud mb-2">referral code</p>
              <code className="mb-4 block break-all rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 font-mono text-sm text-cyan-200">
                {selectedMember.referralCode}
              </code>

              <p className="text-xs text-slate-500">Scan untuk undang orang lain</p>

              <button
                type="button"
                onClick={() => setSelectedMember(null)}
                className="btn btn-ghost mt-6 w-full"
              >
                Close
              </button>
            </GlassPanel>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

export default AdminMembers
