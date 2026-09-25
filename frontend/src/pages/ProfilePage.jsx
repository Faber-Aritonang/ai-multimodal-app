import { useState, useEffect } from 'react'
import { memberAPI } from '../config/api'
import Layout from '../components/Layout'
import QRCode from '../components/QRCode'
import { GlassPanel, PageHeader, SectionTitle, StatTile, Alert } from '../components/ui'

// Batas yang sama divalidasi ulang oleh backend (lihat memberController).
const MAX_DISPLAY_NAME = 60
const MAX_BIO = 200
const MAX_PHOTO_URL = 500

const QUOTA_ITEMS = [
  { label: 'chat', key: 'chat', icon: '💬', accent: 'cyan' },
  { label: 'gambar', key: 'imageGeneration', icon: '🎨', accent: 'violet' },
  { label: 'video', key: 'videoGeneration', icon: '🎬', accent: 'teal' },
  { label: 'audio', key: 'audioGeneration', icon: '🔊', accent: 'fuchsia' },
  { label: 'total', key: 'total', icon: '📊', accent: 'cyan' }
]

const ProfilePage = ({ user, setUser }) => {
  const [quota, setQuota] = useState(null)
  const [loading, setLoading] = useState(true)
  const [referral, setReferral] = useState(null)
  const [referralLoading, setReferralLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  // Profil dari server dipakai untuk bagian "Account Info". Objek `user` dari
  // login/localStorage tidak memuat createdAt, sehingga "Member Since" selalu
  // tampil 'N/A' untuk semua user sebelum ini.
  const [profile, setProfile] = useState(null)

  // Formulir edit profil. Isinya disalin dari data server (bukan diedit langsung
  // di objek `user`), supaya tombol Cancel benar-benar bisa membatalkan dan
  // perubahan yang gagal disimpan tidak ikut terlihat di layar.
  const [form, setForm] = useState({ displayName: '', bio: '', photoURL: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  useEffect(() => {
    fetchQuota()
    fetchReferralStats()
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    try {
      const response = await memberAPI.getProfile()
      setProfile(response.data.user)
    } catch (error) {
      console.error('Failed to fetch profile:', error)
    }
  }

  // `profile` datang belakangan (setelah GET /profile), sedangkan `user` sudah
  // ada sejak login. Formulir disegarkan saat profil server tiba, dan saat `user`
  // berubah setelah penyimpanan berhasil.
  useEffect(() => {
    const sumber = profile || user
    if (!sumber) return

    setForm({
      displayName: sumber.displayName || '',
      bio: sumber.bio || '',
      photoURL: sumber.photoURL || ''
    })
  }, [profile, user])

  const handleSaveProfile = async (event) => {
    event.preventDefault()
    if (saving) return

    setSaving(true)
    setFormError('')
    setFormSuccess('')

    try {
      const response = await memberAPI.updateProfile({
        displayName: form.displayName.trim(),
        bio: form.bio.trim(),
        photoURL: form.photoURL.trim()
      })

      const updated = response.data.user
      setProfile(updated)
      setFormSuccess('Profil tersimpan.')

      // Nama & foto di sidebar/topbar diambil dari `user` milik App, jadi objek
      // itu ikut diperbarui — tanpa ini nama lama tetap tampil sampai login ulang.
      if (setUser && user) {
        const merged = {
          ...user,
          displayName: updated.displayName,
          photoURL: updated.photoURL,
          bio: updated.bio
        }

        setUser(merged)
        localStorage.setItem('user', JSON.stringify(merged))
      }
    } catch (error) {
      console.error('Failed to update profile:', error)
      setFormError(
        error.response?.data?.message ||
          error.message ||
          'Failed to save your profile. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }

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

  const fetchReferralStats = async () => {
    try {
      const response = await memberAPI.getReferralStats()
      setReferral(response.data)
    } catch (error) {
      console.error('Failed to fetch referral stats:', error)
    } finally {
      setReferralLoading(false)
    }
  }

  const referralCode = referral?.referralCode || user?.referralCode
  const referralLink = referralCode
    ? `${window.location.origin}/register?ref=${referralCode}`
    : ''

  const handleCopy = async () => {
    if (!referralLink) return

    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy referral link:', error)
    }
  }

  // Data server bila sudah termuat, kalau belum pakai objek user dari login.
  const account = profile || user
  const approved = Boolean(account?.isApproved)

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-5">
        <PageHeader
          eyebrow="akun"
          title="Profile"
          description="Identitas, kuota, dan kode undangan Anda."
        />

        {/* -------------------------------- Identitas ------------------------------- */}
        <GlassPanel className="rise p-6 sm:p-7">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <div className="relative">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt="Profile"
                  className="h-20 w-20 rounded-2xl object-cover ring-1 ring-white/15"
                />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-aurora-cyan to-aurora-violet text-2xl font-bold text-ink-950">
                  {user?.displayName?.charAt(0) || '?'}
                </div>
              )}
              {/* Titik status menempel pada avatar, jadi jelas tanpa membaca teks. */}
              <span
                className={`absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-ink-950 ${
                  approved ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
            </div>

            <div className="min-w-0 flex-1">
              <h2 data-testid="profile-name" className="truncate text-xl font-bold text-slate-100">
                {user?.displayName}
              </h2>
              <p data-testid="profile-email" className="truncate text-sm text-slate-400">
                {user?.email}
              </p>
              {account?.bio && (
                <p data-testid="profile-bio" className="mt-2 text-sm text-slate-400">
                  {account.bio}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`chip ${approved ? 'chip-ok' : 'chip-warn'}`}>
                  {approved ? 'Approved Member' : 'Pending Approval'}
                </span>
                <span className="chip">{account?.role || 'guest'}</span>
              </div>
            </div>
          </div>
        </GlassPanel>

        {/* ------------------------------ Edit profil ------------------------------- */}
        <GlassPanel className="rise rise-1 p-6 sm:p-7">
          <SectionTitle hint="Hanya nama tampilan, bio, dan foto yang bisa Anda ubah sendiri. Email, peran, dan kuota diatur admin.">
            Edit Profile
          </SectionTitle>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label htmlFor="displayName" className="hud mb-2 block">
                nama tampilan
              </label>
              <input
                id="displayName"
                type="text"
                data-testid="profile-display-name"
                value={form.displayName}
                onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))}
                maxLength={MAX_DISPLAY_NAME}
                required
                minLength={2}
                className="field"
                placeholder="Nama yang tampil di aplikasi"
              />
              <p className="mt-1.5 font-mono text-[10px] text-slate-500">
                {form.displayName.length}/{MAX_DISPLAY_NAME} characters
              </p>
            </div>

            <div>
              <label htmlFor="bio" className="hud mb-2 block">
                bio <span className="normal-case tracking-normal text-slate-500">(opsional)</span>
              </label>
              <textarea
                id="bio"
                data-testid="profile-bio-input"
                value={form.bio}
                onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))}
                maxLength={MAX_BIO}
                rows={2}
                className="field resize-none"
                placeholder="Satu dua kalimat tentang Anda"
              />
              <p className="mt-1.5 font-mono text-[10px] text-slate-500">
                {form.bio.length}/{MAX_BIO} characters
              </p>
            </div>

            <div>
              <label htmlFor="photoURL" className="hud mb-2 block">
                URL foto <span className="normal-case tracking-normal text-slate-500">(opsional)</span>
              </label>
              <input
                id="photoURL"
                type="url"
                data-testid="profile-photo-url"
                value={form.photoURL}
                onChange={(event) => setForm((prev) => ({ ...prev, photoURL: event.target.value }))}
                maxLength={MAX_PHOTO_URL}
                className="field font-mono text-xs"
                placeholder="https://..."
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Kosongkan untuk kembali memakai inisial nama. Foto dari login Google tetap
                dipakai selama kolom ini belum diisi.
              </p>
            </div>

            {formError && (
              <Alert tone="danger">
                <p data-testid="profile-form-error">{formError}</p>
              </Alert>
            )}

            {formSuccess && (
              <Alert tone="ok">
                <p data-testid="profile-form-success">{formSuccess}</p>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" data-testid="profile-save" disabled={saving} className="btn btn-primary">
                {saving ? 'Saving...' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const sumber = profile || user || {}
                  setForm({
                    displayName: sumber.displayName || '',
                    bio: sumber.bio || '',
                    photoURL: sumber.photoURL || ''
                  })
                  setFormError('')
                  setFormSuccess('')
                }}
                className="btn btn-ghost"
              >
                Reset
              </button>
            </div>
          </form>
        </GlassPanel>

        {/* --------------------------------- Referral ------------------------------ */}
        <GlassPanel className="rise rise-1 p-6 sm:p-7">
          <SectionTitle hint="Setiap orang yang mendaftar memakai kode ini akan tercatat sebagai referral Anda.">
            Invite friends
          </SectionTitle>

          {referralLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="h-24 animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]" />
              <div className="h-24 animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]" />
            </div>
          ) : (
            <div className="flex flex-col gap-6 md:flex-row">
              <div className="flex-1 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatTile
                    label="kode referral"
                    value={referralCode || 'Belum tersedia'}
                    accent="cyan"
                    valueProps={{
                      'data-testid': 'referral-code',
                      className: 'mt-2 block break-all font-mono text-base font-semibold text-cyan-300'
                    }}
                  />
                  <StatTile
                    label="total referral"
                    value={referral?.totalReferrals ?? 0}
                    accent="violet"
                    valueProps={{ 'data-testid': 'referral-total' }}
                  />
                </div>

                <div>
                  <p className="hud mb-2">link undangan</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      data-testid="referral-link"
                      value={referralLink}
                      className="field flex-1 font-mono text-xs"
                    />
                    <button type="button" onClick={handleCopy} className="btn btn-ghost flex-shrink-0">
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                {referral?.referrals?.length > 0 && (
                  <div>
                    <p className="hud mb-2">member yang Anda undang</p>
                    <ul className="space-y-2">
                      {referral.referrals.map((member) => (
                        <li
                          key={member._id}
                          className="glass-inset flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <span className="truncate text-sm text-slate-200">
                            {member.displayName || 'Member'}
                          </span>
                          <span className={`chip ${member.isApproved ? 'chip-ok' : 'chip-warn'}`}>
                            {member.isApproved ? 'Approved' : 'Pending'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {referralCode && (
                <div data-testid="referral-qr" className="flex-shrink-0 text-center md:w-52">
                  <div className="glass-inset inline-block p-3">
                    <QRCode value={referralCode} size={168} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Scan untuk mendaftar</p>
                </div>
              )}
            </div>
          )}
        </GlassPanel>

        {/* ---------------------------------- Kuota -------------------------------- */}
        {!loading && quota && (
          <GlassPanel className="rise rise-2 p-6 sm:p-7">
            <SectionTitle hint="Sisa jatah pemakaian akun Anda. Setiap jenis pekerjaan punya jatahnya sendiri.">
              Remaining Quotas
            </SectionTitle>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {QUOTA_ITEMS.map((item) => (
                <StatTile
                  key={item.key}
                  label={`${item.icon} ${item.label}`}
                  value={quota[item.key] ?? 0}
                  accent={item.accent}
                  valueProps={{ 'data-testid': 'quota-value', 'data-quota-key': item.key }}
                />
              ))}
            </div>
          </GlassPanel>
        )}

        {/* ------------------------------ Informasi akun ---------------------------- */}
        <GlassPanel className="rise rise-3 p-6 sm:p-7">
          <SectionTitle>Account Info</SectionTitle>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="glass-inset p-4">
              <dt className="hud mb-1">role</dt>
              <dd className="text-sm font-medium text-slate-100">{account?.role || 'Guest'}</dd>
            </div>
            <div className="glass-inset p-4">
              <dt className="hud mb-1">member since</dt>
              <dd data-testid="member-since" className="text-sm font-medium text-slate-100">
                {account?.createdAt
                  ? new Date(account.createdAt).toLocaleDateString()
                  : 'N/A'}
              </dd>
            </div>
            <div className="glass-inset p-4">
              <dt className="hud mb-1">status</dt>
              <dd className="text-sm font-medium text-slate-100">
                {approved ? 'Approved' : 'Pending Approval by Admin'}
              </dd>
            </div>
          </dl>
        </GlassPanel>
      </div>
    </Layout>
  )
}

export default ProfilePage
