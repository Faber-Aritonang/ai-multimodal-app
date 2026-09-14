import { useState, useEffect } from 'react'
import { adminAPI } from '../../config/api'
import AdminLayout from '../../components/AdminLayout'
import QRCode from '../../components/QRCode'

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
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        </div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-dark-800">Member Management</h1>
          <p className="text-dark-500 mt-1">
            Manage member approvals and view member details
          </p>
        </div>

        {/* Pending Members */}
        <div className="bg-white dark-glass rounded-xl">
          <div className="p-6 border-b border-dark-200">
            <h3 className="text-lg font-bold text-dark-800">
              Pending Members ({pendingMembers.length})
            </h3>
          </div>

          {pendingMembers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-dark-50">
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">User</th>
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">Email</th>
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">Joined</th>
                    <th className="text-center p-4 text-xs font-semibold text-dark-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingMembers.map((member) => (
                    <tr key={member._id} className="border-b border-dark-200">
                      <td className="p-4">
                        <div className="flex items-center">
                          {member.photoURL ? (
                            <img src={member.photoURL} alt={member.displayName} className="w-10 h-10 rounded-full mr-3" />
                          ) : (
                            <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center mr-3">
                              <span className="text-white font-bold">{member.displayName?.charAt(0) || '?'}</span>
                            </div>
                          )}
                          <span className="font-medium text-dark-700">{member.displayName}</span>
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
              <p className="text-dark-500">No pending members</p>
            </div>
          )}
        </div>

        {/* Approved Members with Referral Codes */}
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
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">User</th>
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">Referral Code</th>
                    <th className="text-left p-4 text-xs font-semibold text-dark-500 uppercase">Quota</th>
                    <th className="text-center p-4 text-xs font-semibold text-dark-500 uppercase">QR</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedMembers.map((member) => (
                    <tr key={member._id} className="border-b border-dark-200">
                      <td className="p-4">
                        <div className="flex items-center">
                          {member.photoURL ? (
                            <img src={member.photoURL} alt={member.displayName} className="w-10 h-10 rounded-full mr-3" />
                          ) : (
                            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center mr-3">
                              <span className="text-white font-bold">{member.displayName?.charAt(0) || '?'}</span>
                            </div>
                          )}
                          <span className="font-medium text-dark-700">{member.displayName}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <code className="bg-dark-100 px-2 py-1 rounded text-xs font-mono">
                          {member.referralCode || 'N/A'}
                        </code>
                      </td>
                      <td className="p-4 text-dark-600 text-sm">
                        Chat: {member.quota?.chat || 0} | 
                        Img: {member.quota?.imageGeneration || 0} | 
                        Vid: {member.quota?.videoGeneration || 0}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => setSelectedMember(member)}
                          className="text-primary-600 hover:text-primary-700 p-2"
                          title="Show QR Code"
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
            <div className="text-center py-12">
              <p className="text-dark-500">No approved members</p>
            </div>
          )}

          {/* QR Code Modal */}
          {selectedMember && (
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
              onClick={() => setSelectedMember(null)}
            >
              <div 
                className="bg-white rounded-2xl p-8 text-center max-w-sm w-full"
                onClick={e => e.stopPropagation()}
              >
                <h3 className="text-xl font-bold text-dark-800 mb-4">
                  Referral QR Code
                </h3>
                
                <div className="mb-4">
                  <QRCode
                    value={selectedMember.referralCode || selectedMember.email}
                    size={200}
                    onError={() => {}}
                  />
                </div>
                
                <p className="text-dark-500 mb-2">
                  Referral Code:
                </p>
                <code className="bg-dark-100 px-3 py-1 rounded font-mono mb-4 block">
                  {selectedMember.referralCode}
                </code>
                
                <p className="text-sm text-dark-400">
                  Scan untuk undang orang lain
                </p>
                
                <button
                  onClick={() => setSelectedMember(null)}
                  className="mt-4 text-primary-600 hover:text-primary-700"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  )
}

export default AdminMembers