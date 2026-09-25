import { useState, useEffect } from 'react'
import { adminAPI } from '../../config/api'
import AdminLayout from '../../components/AdminLayout'
import QRCode from '../../components/QRCode'
import { GlassPanel, PageHeader, SectionTitle } from '../../components/ui'

const AdminMembers = () => {
  const [pendingMembers, setPendingMembers] = useState([])
  const [approvedMembers, setApprovedMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMember, setSelectedMember] = useState(null)

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
      await adminAPI.approveMember(uid, {
        chat: 500,
        imageGeneration: 50,
        // Kuota audio berdiri sendiri (dulu menumpang videoGeneration); tanpa
        // nilai di sini member baru hanya mewarisi nilai cadangan akun lama.
        audioGeneration: 50,
        videoGeneration: 20,
        total: 5000
      })
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
          description="Setujui member baru dan lihat rincian kuota serta kode undangannya."
        />

        {/* ---------------------------- Menunggu review --------------------------- */}
        <GlassPanel className="overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] p-5 sm:p-6">
            <SectionTitle className="mb-0">Pending Members ({pendingMembers.length})</SectionTitle>
            <span className={`chip ${pendingMembers.length > 0 ? 'chip-warn' : 'chip-ok'}`}>
              {pendingMembers.length > 0 ? 'perlu tindakan' : 'bersih'}
            </span>
          </div>

          {pendingMembers.length > 0 ? (
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
                  {pendingMembers.map((member) => (
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
                          <span className="font-medium text-slate-200">{member.displayName}</span>
                        </div>
                      </td>
                      <td className="p-4 text-slate-400">{member.email}</td>
                      <td className="p-4 font-mono text-xs text-slate-500">
                        {new Date(member.createdAt).toLocaleDateString()}
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
              <p className="text-sm text-slate-500">No pending members</p>
            </div>
          )}
        </GlassPanel>

        {/* ------------------------------ Member aktif --------------------------- */}
        <GlassPanel className="overflow-hidden">
          <div className="border-b border-white/[0.06] p-5 sm:p-6">
            <SectionTitle className="mb-0" hint="Klik ikon QR untuk membagikan kode undangan member.">
              Approved Members ({approvedMembers.length})
            </SectionTitle>
          </div>

          {approvedMembers.length > 0 ? (
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
                  {approvedMembers.map((member) => (
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
                          <span className="font-medium text-slate-200">{member.displayName}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <code className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-xs text-cyan-200">
                          {member.referralCode || 'N/A'}
                        </code>
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-400">
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
              <p className="text-sm text-slate-500">No approved members</p>
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
