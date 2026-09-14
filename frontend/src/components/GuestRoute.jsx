import { Navigate } from 'react-router-dom'

/**
 * GuestRoute Component
 * - Mencegah user yang sudah login mengakses halaman login/register
 */
const GuestRoute = ({ user, children }) => {
  if (user) {
    if (user.role === 'admin') {
      return <Navigate to="/admin" replace />
    }
    if (user.isApproved) {
      return <Navigate to="/dashboard" replace />
    } else {
      return <Navigate to="/pending-approval" replace />
    }
  }
  
  return children
}

export default GuestRoute