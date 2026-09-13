import { Link, useNavigate, useLocation } from 'react-router-dom'

const AdminLayout = ({ children }) => {
  const navigate = useNavigate()
  const location = useLocation()

  const navigation = [
    { name: 'Dashboard', href: '/admin', icon: '📊' },
    { name: 'Members', href: '/admin/members', icon: '👥' },
  ]

  return (
    <div className="flex min-h-screen bg-dark-50">
      {/* Sidebar */}
      <div className="w-64 bg-white dark-glass shadow-lg flex flex-col">
        <div className="p-6 border-b border-dark-200">
          <h2 className="text-xl font-bold text-dark-800">Admin Panel</h2>
        </div>
        
        <nav className="flex-1 p-4">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              onClick={() => navigate(item.href)}
              className={`
                flex items-center px-3 py-2 rounded-lg text-sm font-medium mb-1
                transition-colors
                ${location.pathname === item.href || location.pathname.startsWith(item.href + '/')
                  ? 'bg-primary-500 text-white' 
                  : 'text-dark-600 hover:bg-dark-100'
                }
              `}
            >
              <span className="mr-3">{item.icon}</span>
              {item.name}
            </Link>
          ))}
        </nav>
        
        <div className="p-4 border-t border-dark-200">
          <button
            onClick={() => {
              localStorage.removeItem('authToken')
              localStorage.removeItem('user')
              navigate('/login')
            }}
            className="w-full flex items-center px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <span className="mr-3">🔓</span>
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}

export default AdminLayout