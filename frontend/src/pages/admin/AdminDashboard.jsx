import { useState, useEffect } from 'react'
import { adminAPI } from '../config/api'
import Layout from '../components/AdminLayout'

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
      <Layout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-dark-800">Admin Dashboard</h1>
          <p className="text-dark-500 mt-1">
            Kelola keanggotaan dan monitoring aplikasi
          </p>
        </div>

        {/* Analytics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark-glass rounded-xl p-6 text-center">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-3">
              <span className="text-blue-600 text-xl">👥</span>
            </div>
            <h3 className="text-2xl font-bold text-blue-600">
              {analytics?.totalUsers || 0}
            </h3>
            <p className="text-sm text-dark-500 mt-1">Total Users</p>
          </div>

          <div className="bg-white dark-glass rounded-xl p-6 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-3">
              <span className="text-green-600 text-xl">✅</span>
            </div>
            <h3 className="text-2xl font-bold text-green-600">
              {analytics?.approvedMembers || 0}
            </h3>
            <p className="text-sm text-dark-500 mt-1">Approved Members</p>
          </div>

          <div className="bg-white dark-glass rounded-xl p-6 text-center">
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center mx-auto mb-3">
              <span className="text-yellow-600 text-xl">⏳</span>
            </div>
            <h3 className="text-2xl font-bold text-yellow-600">
              {analytics?.pendingMembers || 0}
            </h3>
            <p className="text-sm text-dark-500 mt-1">Pending Approval</p>
          </div>

          <div className="bg-white dark-glass rounded-xl p-6 text-center">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-3">
              <span className="text-purple-600 text-xl">🎨</span>
            </div>
            <h3 className="text-2xl font-bold text-purple-600">
              {analytics?.totalMedia || 0}
            </h3>
            <p className="text-sm text-dark-500 mt-1">Total Media Generated</p>
          </div>
        </div>

        {/* Media Breakdown */}
        {analytics?.mediaByType && analytics.mediaByType.length > 0 && (
          <div className="bg-white dark-glass rounded-xl p-6">
            <h3 className="text-lg font-bold text-dark-800 mb-4">Media Breakdown</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {analytics.mediaByType.map((item, index) => (
                <div key={index} className="flex justify-between items-center p-3 bg-dark-50 rounded-lg">
                  <span className="text-dark-700 font-medium">{item._id}</span>
                  <span className="text-primary-600 font-bold">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending Members */}
        <div className="bg-white dark-glass rounded-xl">
          <div className="p-6 border-b border-dark-200 flex items-center justify-between">
            <h3 className="text-lg font-bold text-dark-800">
              Pending Member Requests ({pendingMembers.length})
            </h3>
            <button
              onClick={fetchAdminData}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              Refresh
            </button>
          </div>

          {pendingMembers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-dark-50">
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">
                      User
                    </th>
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">
                      Email
                    </th>
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">
                      Joined
                    </th>
                    <th className="text-center p-4 text-xs font-semibold text-dark-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pendingMembers.map((member) => (
                    <tr key={member._id} className="border-b border-dark-200">
                      <td className="p-4">
                        <div className="flex items-center">
                          {member.photoURL ? (
                            <img 
                              src={member.photoURL} 
                              alt={member.displayName}
                              className="w-10 h-10 rounded-full mr-3"
                            />
                          ) : (
                            <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center mr-3">
                              <span className="text-white font-bold">
                                {member.displayName?.charAt(0) || '?'}
                              </span>
                            </div>
                          )}
                          <span className="font-medium text-dark-700">
                            {member.displayName}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-dark-600">{member.email}</td>
                      <td className="p-4 text-dark-500 text-sm">
                        {new Date(member.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-center space-x-2">
                        <button
                          onClick={() => handleApprove(member.uid)}
                          className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-lg text-sm transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(member.uid)}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg text-sm transition-colors"
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">🎉</div>
              <p className="text-dark-500">No pending member requests</p>
            </div>
          )}
        </div>

        {/* Approved Members */}
        <div className="bg-white dark-glass rounded-xl">
          <div className="p-6 border-b border-dark-200">
            <h3 className="text-lg font-bold text-dark-800">
              Approved Members ({approvedMembers.length})
            </h3>
          </div>

          {approvedMembers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-dark-50">
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">
                      User
                    </th>
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">
                      Email
                    </th>
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">
                      Joined
                    </th>
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">
                      Quota (Chat/Img/Video)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {approvedMembers.map((member) => (
                    <tr key={member._id} className="border-b border-dark-200">
                      <td className="p-4">
                        <div className="flex items-center">
                          {member.photoURL ? (
                            <img 
                              src={member.photoURL} 
                              alt={member.displayName}
                              className="w-10 h-10 rounded-full mr-3"
                            />
                          ) : (
                            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center mr-3">
                              <span className="text-white font-bold">
                                {member.displayName?.charAt(0) || '?'}
                              </span>
                            </div>
                          )}
                          <span className="font-medium text-dark-700">
                            {member.displayName}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-dark-600">{member.email}</td>
                      <td className="p-4 text-dark-500 text-sm">
                        {new Date(member.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-dark-600 text-sm">
                        {member.quota?.chat || 0}/{member.quota?.imageGeneration || 0}/{member.quota?.videoGeneration || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">👤</div>
              <p className="text-dark-500">No approved members</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}

export default AdminDashboard