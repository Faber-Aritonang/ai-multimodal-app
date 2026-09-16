import { useState, useEffect } from 'react'
import { adminAPI } from '../../config/api'
import AdminLayout from '../../components/AdminLayout'
import { GlassPanel, PageHeader, SectionTitle, StatTile } from '../../components/ui'

// Ditulis lengkap (bukan `rise-${index}`) supaya kelasnya ikut masuk ke CSS build.
const RISE_STEPS = ['rise-1', 'rise-2', 'rise-3', 'rise-4']

const STATS = [
  { key: 'totalUsers', label: 'total users', icon: '👥', accent: 'cyan' },
  { key: 'approvedMembers', label: 'approved', icon: '✅', accent: 'teal' },
  { key: 'pendingMembers', label: 'pending', icon: '⏳', accent: 'violet' },
  { key: 'totalMedia', label: 'media dibuat', icon: '🎨', accent: 'fuchsia' }
]

const AdminDashboard = () => {
  const [analytics, setAnalytics] = useState(null)
  const [pendingMembers, setPendingMembers] = useState([])
  const [approvedMembers, setApprovedMembers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAdminData()
  }, [])

  const fetchAdminData = async () => {
    try {
      const [analyticsRes, pendingRes, approvedRes] = await Promise.all([
        adminAPI.getAnalytics(),
        adminAPI.getPendingMembers(),
        adminAPI.getApprovedMembers()
      ])

      setAnalytics(analyticsRes.data.analytics)
      setPendingMembers(pendingRes.data.members)
      setApprovedMembers(approvedRes.data.members)
      setLoading(false)
    } catch (error) {
      console.error('Failed to fetch admin data:', error)
      setLoading(false)
    }
  }

  const handleApprove = async (uid) => {
    try {
      await adminAPI.approveMember(uid, {
        chat: 500,
        imageGeneration: 50,
        videoGeneration: 20,
        total: 5000
      })
      fetchAdminData()
    } catch (error) {
      console.error('Approval failed:', error)
    }
  }

  const handleReject = async (uid) => {
    if (!window.confirm('Reject this member? This action cannot be undone.')) return

    try {
      await adminAPI.rejectMember(uid)
      fetchAdminData()
    } catch (error) {
      console.error('Rejection failed:', error)
    }
  }

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-fuchsia-300" />
            <p className="hud animate-pulse-glow">memuat data admin…</p>
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
          title="Admin Dashboard"
          description="Kelola keanggotaan dan pantau pemakaian aplikasi."
          actions={
            <button type="button" onClick={fetchAdminData} className="btn btn-ghost text-xs">
              Refresh
            </button>
          }
        />

        {/* ------------------------------- Ringkasan ------------------------------ */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STATS.map((stat, index) => (
            <div key={stat.key} className={`rise ${RISE_STEPS[index] || ''}`}>
              <StatTile
                label={`${stat.icon} ${stat.label}`}
                value={analytics?.[stat.key] || 0}
                accent={stat.accent}
              />
            </div>
          ))}
        </div>

        {/* ---------------------------- Rincian media ---------------------------- */}
        {analytics?.mediaByType && analytics.mediaByType.length > 0 && (
          <GlassPanel className="p-5 sm:p-6">
            <SectionTitle hint="Jumlah berkas media per jenis alat.">Media Breakdown</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {analytics.mediaByType.map((item, index) => (
                <div
                  key={index}
                  className="glass-inset flex items-center justify-between gap-3 px-3.5 py-2.5"
                >
                  <span className="truncate text-sm text-slate-300">{item._id}</span>
                  <span className="font-mono text-sm font-semibold text-cyan-300">{item.count}</span>
                </div>
              ))}
            </div>
          </GlassPanel>
        )}

        {/* --------------------------- Permintaan akses -------------------------- */}
        <GlassPanel className="overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] p-5 sm:p-6">
            <SectionTitle className="mb-0" hint="Setujui untuk membuka seluruh alat gambar.">
              Pending Member Requests ({pendingMembers.length})
            </SectionTitle>
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
              <div className="mb-3 text-4xl">🎉</div>
              <p className="text-sm text-slate-500">No pending member requests</p>
            </div>
          )}
        </GlassPanel>

        {/* ------------------------------ Member aktif --------------------------- */}
        <GlassPanel className="overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] p-5 sm:p-6">
            <SectionTitle className="mb-0" hint="Angka di kolom kuota: chat / gambar / video.">
              Approved Members ({approvedMembers.length})
            </SectionTitle>
            <span className="chip chip-ok">aktif</span>
          </div>

          {approvedMembers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="bg-white/[0.03]">
                    <th className="hud p-4 text-left">user</th>
                    <th className="hud p-4 text-left">email</th>
                    <th className="hud p-4 text-left">joined</th>
                    <th className="hud p-4 text-left">kuota</th>
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
                      <td className="p-4 text-slate-400">{member.email}</td>
                      <td className="p-4 font-mono text-xs text-slate-500">
                        {new Date(member.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 font-mono text-xs text-cyan-300">
                        {member.quota?.chat || 0}/{member.quota?.imageGeneration || 0}/
                        {member.quota?.videoGeneration || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <div className="mb-3 text-4xl">👤</div>
              <p className="text-sm text-slate-500">No approved members</p>
            </div>
          )}
        </GlassPanel>
      </div>
    </AdminLayout>
  )
}

export default AdminDashboard
