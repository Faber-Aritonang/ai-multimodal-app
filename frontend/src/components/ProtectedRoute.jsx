import { Navigate } from 'react-router-dom'

/**
 * ProtectedRoute Component
 * - Memastikan user sudah terautentikasi
 * - Memeriksa role (admin/member)
 * - Memeriksa approval status
 */
const ProtectedRoute = ({ user, requiredRole, requiredApproval = false, children }) => {
  // Belum terautentikasi
  if (!user) {
    return <Navigate to="/login" replace />
  }
  
  // Cek role admin
  if (requiredRole === 'admin' && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }
  
  // Cek approval untuk member route
  if (requiredApproval && !user.isApproved) {
    return <Navigate to="/pending-approval" replace />
  }
  
  return children
}

export default ProtectedRoute