import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authAPI } from '../config/api'
import { signOutUser } from '../config/firebase'
import {
  MenuIcon,
  XIcon,
  HomeIcon,
  ChatIcon,
  ImageIcon,
  TransformIcon,
  UserIcon
} from '../components/icons'

const Layout = ({ user, setUser, children }) => {
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogout = async () => {
    try {
      await authAPI.logout()
    } catch (error) {
      console.error('Logout failed:', error)
    }

    // Putus sesi Firebase juga, agar tidak otomatis login lagi
    await signOutUser()

    localStorage.removeItem('authToken')
    localStorage.removeItem('user')
    setUser(null)
    navigate('/login')
  }

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
    { name: 'Chat', href: '/chat', icon: ChatIcon },
    { name: 'Text to Image', href: '/tools/text-to-image', icon: ImageIcon },
    { name: 'Image to Image', href: '/tools/image-to-image', icon: TransformIcon },
    { name: 'Profile', href: '/profile', icon: UserIcon },
  ]

  return (
    <div className="min-h-screen bg-dark-50">
      {/* Mobile sidebar */}
      <div className="md:hidden">
        <div className="fixed inset-0 z-40">
          {/* Overlay */}
          {mobileMenuOpen && (
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
            />
          )}
          
          {/* Sidebar */}
          <div className={`
            absolute inset-y-0 left-0 z-50 transform transition-transform duration-200
            ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          `}>
            <div className="flex items-center justify-between p-4 bg-white border-b border-dark-200">
              <h2 className="text-lg font-bold text-dark-800">Menu</h2>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-lg hover:bg-dark-100"
              >
                <XIcon className="w-6 h-6 text-dark-600" />
              </button>
            </div>
            <nav className="p-4">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center px-3 py-2 text-sm font-medium text-dark-600 hover:bg-dark-100 rounded-lg"
                >
                  <item.icon className="w-5 h-5 mr-3" />
                  {item.name}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>

      {/* Desktop sidebar */}
      <div className="hidden md:flex md:items-start md:fixed md:inset-y-0 md:mt-0">
        <div className="flex flex-col flex-grow justify-between pt-5 overflow-y-auto bg-white dark-glass border-r border-dark-200">
          <div className="flex-1 flexGrow">
            {/* Current user */}
            <div className="px-4 pb-4 mb-2 border-b border-dark-200 flex items-center gap-3">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="w-10 h-10 rounded-full"
                />
              ) : (
                <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold">
                    {user?.displayName?.charAt(0) || '?'}
                  </span>
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-dark-800 truncate">
                  {user?.displayName || 'User'}
                </p>
                <p className="text-xs text-dark-400 truncate">{user?.email}</p>
              </div>
            </div>

            <nav className="space-y-1 px-4">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className="flex items-center px-3 py-2 text-sm font-medium text-dark-600 hover:bg-dark-100 rounded-lg"
                >
                  <item.icon className="w-5 h-5 mr-3" />
                  {item.name}
                </Link>
              ))}
            </nav>
          </div>

          <div className="p-4 border-t border-dark-200">
            <button
              onClick={handleLogout}
              className="w-full flex items-center px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="md:pl-64 flex-grow">
        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between p-4 bg-white border-b border-dark-200">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 rounded-lg hover:bg-dark-100"
          >
            <MenuIcon className="w-6 h-6 text-dark-600" />
          </button>
          <h1 className="text-lg font-bold text-dark-800">AI Multimodal</h1>
        </div>

        {/* Page content */}
        <div className="p-4 md:p-6 pb-24 md:pb-6">
          {children}
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-dark-200 p-4 flex justify-around">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex flex-col items-center p-2 text-dark-600"
        >
          <HomeIcon className="w-6 h-6" />
          <span className="text-xs">Dashboard</span>
        </button>
        <button
          onClick={() => navigate('/chat')}
          className="flex flex-col items-center p-2 text-dark-600"
        >
          <ChatIcon className="w-6 h-6" />
          <span className="text-xs">Chat</span>
        </button>
        <button
          onClick={() => navigate('/tools/text-to-image')}
          className="flex flex-col items-center p-2 text-dark-600"
        >
          <ImageIcon className="w-6 h-6" />
          <span className="text-xs">Image</span>
        </button>
        <button
          onClick={() => navigate('/tools/image-to-image')}
          className="flex flex-col items-center p-2 text-dark-600"
        >
          <TransformIcon className="w-6 h-6" />
          <span className="text-xs">Transform</span>
        </button>
        <button
          onClick={handleLogout}
          className="flex flex-col items-center p-2 text-gray-600"
        >
          <UserIcon className="w-6 h-6" />
          <span className="text-xs">Logout</span>
        </button>
      </nav>
    </div>
  )
}

export default Layout
