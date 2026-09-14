import { useState } from 'react'
import { memberAPI } from '../config/api'
import Layout from '../components/Layout'

const ProfilePage = ({ user, setUser }) => {
  const [quota, setQuota] = useState(null)
  const [loading, setLoading] = useState(true)

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
              <h2 className="text-xl font-bold text-dark-800">{user?.displayName}</h2>
              <p className="text-dark-500">{user?.email}</p>
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 mt-2">
                {user?.isApproved ? 'Approved Member' : 'Pending Approval'}
              </span>
            </div>
          </div>
        </div>
        
        {!loading && quota && (
          <div className="bg-white dark-glass rounded-2xl p-6">
            <h3 className="text-xl font-bold text-dark-800 mb-4">Remaining Quotas</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {quotaItems.map((item) => (
                <div key={item.key} className="text-center p-4 bg-dark-50 rounded-lg">
                  <div className="text-2xl mb-1">{item.icon}</div>
                  <p className="text-sm text-dark-500">{item.label}</p>
                  <p className="text-2xl font-bold text-primary-600">
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
                <p className="font-medium text-dark-700">{user?.role || 'Guest'}</p>
              </div>
              <div>
                <p className="text-sm text-dark-500">Member Since</p>
                <p className="font-medium text-dark-700">
                  {user?.createdAt 
                    ? new Date(user.createdAt).toLocaleDateString() 
                    : 'N/A'}
                </p>
              </div>
            </div>
            <div>
              <p className="text-sm text-dark-500">Status</p>
              <p className="font-medium text-dark-700">
                {user?.isApproved ? 'Approved' : 'Pending Approval by Admin'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default ProfilePage