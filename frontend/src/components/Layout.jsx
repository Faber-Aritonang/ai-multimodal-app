import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authAPI } from '../config/api'
import { 
  MenuIcon, 
  XIcon,
  HomeIcon,
  ChatIcon,
  UserIcon,
  CogIcon
} from '../components/icons'

const Layout = ({ user, setUser, children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogout = async () => {
    try {
      await authAPI.logout()
      localStorage.removeItem('authToken')
      localStorage.removeItem('user')
      setUser(null)
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
    { name: 'Chat', href: '/chat', icon: ChatIcon },
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
                  href={item.href}
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
            <nav className="space-y-1 px-4">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
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
          className="flex flex-col items-center p-2 text-primary-600"
        >
          <ChatIcon className="w-6 h-6" />
          <span className="text-xs">Chat</span>
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

function useLinkType(link) {
  return link
}

export default Layout