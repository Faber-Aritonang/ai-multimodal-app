import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { authAPI } from './config/api'
import { getCurrentUser } from './config/firebase'

// Pages
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import ChatPage from './pages/ChatPage'
import TextToImagePage from './pages/TextToImagePage'
import ImageToImagePage from './pages/ImageToImagePage'
import TextToSoundPage from './pages/TextToSoundPage'
import ProfilePage from './pages/ProfilePage'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminMembers from './pages/admin/AdminMembers'
import PendingApproval from './pages/PendingApproval'

// Components
import ProtectedRoute from './components/ProtectedRoute'
import GuestRoute from './components/GuestRoute'
import Aurora from './components/Aurora'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Cek status auth
    checkAuthStatus()
  }, [])

  const checkAuthStatus = async () => {
    try {
      const response = await authAPI.getStatus()
      if (response.data.success && response.data.isAuthenticated && response.data.user) {
        setUser(response.data.user)
        localStorage.setItem('user', JSON.stringify(response.data.user))
      } else {
        const firebaseUser = await getCurrentUser()
        if (firebaseUser) {
          const retryResponse = await authAPI.getStatus()
          setUser(retryResponse.data.user || null)
        } else {
          setUser(null)
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" />
          <p className="hud animate-pulse-glow">memuat sesi…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen">
      {/* Latar dipasang sekali di akar agar blob aurora tidak dibuat ulang tiap navigasi. */}
      <Aurora />

      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={
          <GuestRoute user={user}>
            <LoginPage setUser={setUser} />
          </GuestRoute>
        } />
        
        <Route path="/register" element={
          <GuestRoute user={user}>
            <RegisterPage setUser={setUser} />
          </GuestRoute>
        } />
        
        {/* Protected Routes - Admin Only */}
        <Route path="/admin" element={
          <ProtectedRoute user={user} requiredRole="admin">
            <AdminDashboard />
          </ProtectedRoute>
        } />
        <Route path="/admin/members" element={
          <ProtectedRoute user={user} requiredRole="admin">
            <AdminMembers />
          </ProtectedRoute>
        } />
        
        {/* Protected Routes - Member Only */}
        <Route path="/pending-approval" element={
          <ProtectedRoute user={user}>
            <PendingApproval user={user} setUser={setUser} />
          </ProtectedRoute>
        } />
        
        <Route path="/dashboard" element={
          <ProtectedRoute user={user} requiredApproval={true}>
            <DashboardPage user={user} setUser={setUser} />
          </ProtectedRoute>
        } />
        
        <Route path="/chat" element={
          <ProtectedRoute user={user} requiredApproval={true}>
            <ChatPage user={user} setUser={setUser} />
          </ProtectedRoute>
        } />

        <Route path="/chat/:sessionId" element={
          <ProtectedRoute user={user} requiredApproval={true}>
            <ChatPage user={user} setUser={setUser} />
          </ProtectedRoute>
        } />
        
        <Route path="/tools/text-to-image" element={
          <ProtectedRoute user={user} requiredApproval={true}>
            <TextToImagePage user={user} setUser={setUser} />
          </ProtectedRoute>
        } />

        <Route path="/tools/image-to-image" element={
          <ProtectedRoute user={user} requiredApproval={true}>
            <ImageToImagePage user={user} setUser={setUser} />
          </ProtectedRoute>
        } />

        <Route path="/tools/text-to-sound" element={
          <ProtectedRoute user={user} requiredApproval={true}>
            <TextToSoundPage user={user} setUser={setUser} />
          </ProtectedRoute>
        } />

        <Route path="/profile" element={
          <ProtectedRoute user={user} requiredApproval={true}>
            <ProfilePage user={user} setUser={setUser} />
          </ProtectedRoute>
        } />
        
        {/* Redirect root */}
        <Route path="/" element={
          user && user.role === 'admin' ?
            <Navigate to="/admin" /> :
            user && user.isApproved ? 
            <Navigate to="/dashboard" /> : 
            user && !user.isApproved ?
            <Navigate to="/pending-approval" /> :
            <Navigate to="/login" />
        } />
        
        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </div>
  )
}

export default App