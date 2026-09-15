import { useState, useEffect } from 'react'
import { memberAPI } from '../config/api'
import Layout from '../components/Layout'
import QRCode from '../components/QRCode'

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

  const quotaItems = [
    { label: 'Chat', key: 'chat', icon: '💬' },
    { label: 'Images', key: 'imageGeneration', icon: '🎨' },
    { label: 'Videos', key: 'videoGeneration', icon: '🎬' },
    { label: 'Total', key: 'total', icon: '📊' }
  ]

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-6">
        <div className="bg-white dark-glass rounded-2xl p-6">
          <h1 className="text-2xl font-bold text-dark-800 mb-4">Profile</h1>
          
          <div className="flex items-center space-x-4">
            {user?.photoURL ? (
              <img 
                src={user.photoURL} 
                alt="Profile" 
                className="w-20 h-20 rounded-full"
              />
            ) : (
              <div className="w-20 h-20 bg-primary-500 rounded-full flex items-center justify-center">
                <span className="text-white font-bold text-2xl">
                  {user?.displayName?.charAt(0) || '?'}
                </span>
              </div>
            )}
            
            <div>
              <h2 data-testid="profile-name" className="text-xl font-bold text-dark-800">{user?.displayName}</h2>
              <p data-testid="profile-email" className="text-dark-500">{user?.email}</p>
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 mt-2">
                {user?.isApproved ? 'Approved Member' : 'Pending Approval'}
              </span>
            </div>
          </div>
        </div>

        {/* Referral */}
        <div className="bg-white dark-glass rounded-2xl p-6">
          <h3 className="text-xl font-bold text-dark-800 mb-1">Invite friends</h3>
          <p className="text-sm text-dark-500 mb-4">
            Bagikan kode referral Anda. Setiap orang yang mendaftar memakai kode ini
            akan tercatat sebagai referral Anda.
          </p>

          {referralLoading ? (
            <div className="h-24 bg-dark-100 rounded-xl animate-pulse"></div>
          ) : (
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-dark-500 mb-1">Kode referral</p>
                    <code data-testid="referral-code" className="bg-dark-100 px-3 py-2 rounded-lg font-mono text-sm block">
                      {referralCode || 'Belum tersedia'}
                    </code>
                  </div>
                  <div>
                    <p className="text-xs text-dark-500 mb-1">Total referral</p>
                    <p data-testid="referral-total" className="text-2xl font-bold text-primary-600">
                      {referral?.totalReferrals ?? 0}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-dark-500 mb-1">Link undangan</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      data-testid="referral-link"
                      value={referralLink}
                      className="flex-1 px-3 py-2 border border-dark-200 rounded-lg text-sm bg-dark-50"
                    />
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg px-4 transition-colors"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                {referral?.referrals?.length > 0 && (
                  <div>
                    <p className="text-xs text-dark-500 mb-2">Member yang Anda undang</p>
                    <ul className="space-y-2">
                      {referral.referrals.map((member) => (
                        <li
                          key={member._id}
                          className="flex items-center justify-between text-sm border border-dark-200 rounded-lg px-3 py-2"
                        >
                          <span className="text-dark-700 truncate">
                            {member.displayName || 'Member'}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              member.isApproved
                                ? 'bg-green-100 text-green-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {member.isApproved ? 'Approved' : 'Pending'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {referralCode && (
                <div data-testid="referral-qr" className="md:w-52 shrink-0 text-center">
                  <QRCode value={referralCode} size={180} />
                  <p className="text-xs text-dark-400 mt-2">Scan untuk mendaftar</p>
                </div>
              )}
            </div>
          )}
        </div>
        
        {!loading && quota && (
          <div className="bg-white dark-glass rounded-2xl p-6">
            <h3 className="text-xl font-bold text-dark-800 mb-4">Remaining Quotas</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {quotaItems.map((item) => (
                <div key={item.key} className="text-center p-4 bg-dark-50 rounded-lg">
                  <div className="text-2xl mb-1">{item.icon}</div>
                  <p className="text-sm text-dark-500">{item.label}</p>
                  <p data-testid="quota-value" data-quota-key={item.key} className="text-2xl font-bold text-primary-600">
                    {quota[item.key] ?? 0}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="bg-white dark-glass rounded-2xl p-6">
          <h3 className="text-xl font-bold text-dark-800 mb-4">Account Info</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-dark-500">Role</p>
                <p className="font-medium text-dark-700">{account?.role || 'Guest'}</p>
              </div>
              <div>
                <p className="text-sm text-dark-500">Member Since</p>
                <p data-testid="member-since" className="font-medium text-dark-700">
                  {account?.createdAt 
                    ? new Date(account.createdAt).toLocaleDateString() 
                    : 'N/A'}
                </p>
              </div>
            </div>
            <div>
              <p className="text-sm text-dark-500">Status</p>
              <p className="font-medium text-dark-700">
                {account?.isApproved ? 'Approved' : 'Pending Approval by Admin'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default ProfilePage
