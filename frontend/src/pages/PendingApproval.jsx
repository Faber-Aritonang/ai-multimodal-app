import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authAPI } from '../config/api'
import { SignOutButton } from '../components/icons'

const PendingApproval = ({ user, setUser }) => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  // Cek status setiap 30 detik
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const response = await authAPI.getStatus()
        const freshUser = response.data.user

        if (response.data.isAuthenticated && freshUser?.isApproved) {
          // State `user` di App.jsx masih berisi nilai saat login
          // (isApproved: false). Kalau tidak diperbarui di sini, ProtectedRoute
          // akan langsung melempar balik ke halaman ini dan user terjebak di
          // sini selamanya sampai ia refresh manual sendiri.
          setUser?.(freshUser)
          localStorage.setItem('user', JSON.stringify(freshUser))
          navigate('/dashboard')
        }
      } catch (error) {
        console.error('Status check failed:', error)
      }
    }, 30000)
    
    return () => clearInterval(interval)
  }, [navigate, setUser])

  const handleLogout = async () => {
    setLoading(true)
    try {
      await authAPI.logout()
      localStorage.removeItem('authToken')
      localStorage.removeItem('user')
      navigate('/login')
    } catch (error) {
      console.error('Logout failed:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-600 to-primary-800">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md text-center">
        <div className="mb-6">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-dark-800 mb-2">Pending Approval</h1>
          <p className="text-dark-500">
            Your account is waiting for admin approval.
          </p>
        </div>
        
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-center">
            {user?.photoURL ? (
              <img 
                src={user.photoURL} 
                alt="Profile" 
                className="w-12 h-12 rounded-full mr-3"
              />
            ) : (
              <div className="w-12 h-12 bg-primary-500 rounded-full flex items-center justify-center mr-3">
                <span className="text-white font-bold text-lg">
                  {user?.displayName?.charAt(0) || '?'}
                </span>
              </div>
            )}
            <div className="text-left">
              <p className="font-medium text-dark-800">{user?.displayName}</p>
              <p className="text-sm text-dark-500">{user?.email}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-blue-800 text-sm">
            The page will automatically refresh when your account is approved.
            This usually takes less than a minute.
          </p>
        </div>
        
        <button
          onClick={handleLogout}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-dark-200 rounded-lg hover:bg-dark-50 transition-colors disabled:opacity-50"
        >
          <SignOutButton className="w-4 h-4" />
          <span className="text-dark-700">{loading ? 'Logging out...' : 'Logout'}</span>
        </button>
      </div>
    </div>
  )
}

export default PendingApproval