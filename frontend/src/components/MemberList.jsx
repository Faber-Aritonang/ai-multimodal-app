import { useState, useEffect } from 'react'
import { memberAPI } from '../config/api'
import QRCode from '../components/QRCode'

const MemberList = ({ user }) => {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showQR, setShowQR] = useState(null) // UID member yang QR active
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchMembers()
  }, [])

  const fetchMembers = async () => {
    setLoading(true)
    try {
      const response = await memberAPI.getApprovedMembers()
      setMembers(response.data.members || [])
    } catch (error) {
      console.error('Failed to fetch members:', error)
    } finally {
      setLoading(false)
    }
  }

  // Generate referral link
  const getReferralLink = (code) => {
    const baseUrl = window.location.origin || 'http://localhost:5173'
    return `${baseUrl}/register?ref=${code}`
  }

  const filteredMembers = members.filter(member => 
    member.displayName?.toLowerCase().includes(search.toLowerCase()) ||
    member.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="bg-white dark-glass rounded-xl p-4">
        <input
          type="text"
          placeholder="Cari member..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2 border border-dark-200 rounded-lg focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {/* Member Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-white dark-glass rounded-xl p-6 animate-pulse">
              <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto mb-3"></div>
              <div className="h-5 bg-gray-200 rounded mb-2"></div>
              <div className="h-4 bg-gray-200 rounded mb-3"></div>
              <div className="h-4 bg-gray-200 rounded w-24"></div>
            </div>
          ))}
        </div>
      ) : filteredMembers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMembers.map((member) => (
            <div key={member._id} className="bg-white dark-glass rounded-xl p-6">
              <div className="flex items-center mb-4">
                {member.photoURL ? (
                  <img 
                    src={member.photoURL} 
                    alt={member.displayName}
                    className="w-16 h-16 rounded-full mr-3"
                  />
                ) : (
                  <div className="w-16 h-16 bg-primary-500 rounded-full flex items-center justify-center mr-3">
                    <span className="text-white font-bold text-lg">
                      {member.displayName?.charAt(0) || '?'}
                    </span>
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-dark-800">{member.displayName}</h3>
                  <p className="text-sm text-dark-500">{member.email}</p>
                </div>
              </div>
              
              {/* Referral Info */}
              <div className="mb-4">
                <p className="text-xs text-dark-500 mb-2">Referral Code:</p>
                <code className="bg-dark-100 px-2 py-1 rounded text-xs font-mono">
                  {member.referralCode || `REF${Date.now().toString().slice(-6)}`}
                </code>
              </div>

              {/* QR Trigger */}
              <button
                onClick={() => setShowQR(member)}
                className="w-full bg-primary-500 hover:bg-primary-600 text-white rounded-lg py-2 transition-colors"
              >
                Show QR Code
              </button>

              {/* QR Modal */}
              {showQR?._id === member._id && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
                  onClick={() => setShowQR(null)}>
                  <div 
                    className="bg-white rounded-2xl p-6 max-w-sm w-full"
                    onClick={e => e.stopPropagation()}>
                    
                    <h3 className="text-lg font-bold text-dark-800 mb-4">
                      Referral QR Code
                    </h3>
                    
                    <QRCode
                      value={member.referralCode || `REF${Date.now().toString().slice(-6)}`}
                      size={200}
                      onError={() => {}}
                    />
                    
                    <p className="text-xs text-dark-500 mt-4 text-center">
                      Scan untuk referral
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white dark-glass rounded-xl p-8 text-center">
          <div className="text-3xl mb-4">👥</div>
          <p className="text-dark-500">No members found</p>
        </div>
      )}

      {/* QR Script Loader */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              if (typeof QRious === 'undefined') {
                var script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js';
                document.head.appendChild(script);
              }
            })();
          `
        }}
      />
    </div>
  )
}

export default MemberList