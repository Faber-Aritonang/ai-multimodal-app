import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { memberAPI, authAPI } from '../config/api'
import Layout from '../components/Layout'

const DashboardPage = ({ user, setUser }) => {
  const navigate = useNavigate()
  const [quota, setQuota] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchQuota()
  }, [])

  const fetchQuota = async () => {
    try {
      const response = await memberAPI.getQuota()
      setQuota(response.data.quota)
    } catch (error) {
      console.error('Failed to fetch quota:', error)
    } finally {
      setLoading(false)
    }
  }

  const features = [
    {
      id: 'chat',
      title: 'Chat',
      description: 'AI-powered conversational chat',
      icon: '💬',
      path: '/chat',
      available: true,
      color: 'bg-blue-500'
    },
    {
      id: 'text-to-image',
      title: 'Text to Image',
      description: 'Generate images from text prompts',
      icon: '🎨',
      path: '/tools/text-to-image',
      available: false,
      color: 'bg-purple-500'
    },
    {
      id: 'image-to-image',
      title: 'Image to Image',
      description: 'Transform images using AI',
      icon: '🖼️',
      path: '/tools/image-to-image',
      available: false,
      color: 'bg-pink-500'
    },
    {
      id: 'text-to-video',
      title: 'Text to Video',
      description: 'Generate videos from text',
      icon: '🎬',
      path: '/tools/text-to-video',
      available: false,
      color: 'bg-red-500'
    },
    {
      id: 'image-to-video',
      title: 'Image to Video',
      description: 'Animate images to video',
      icon: '🎥',
      path: '/tools/image-to-video',
      available: false,
      color: 'bg-orange-500'
    },
    {
      id: 'text-to-sound',
      title: 'Text to Sound',
      description: 'Convert text to audio',
      icon: '🔊',
      path: '/tools/text-to-sound',
      available: false,
      color: 'bg-green-500'
    },
    {
      id: 'sound-to-text',
      title: 'Sound to Text',
      description: 'Transcribe audio to text',
      icon: '📝',
      path: '/tools/sound-to-text',
      available: false,
      color: 'bg-yellow-500'
    }
  ]

  return (
    <Layout user={user} setUser={setUser}>
      <div className="space-y-6">
        {/* Welcome Section */}
        <div className="bg-white dark-glass rounded-2xl p-6">
          <h1 className="text-2xl font-bold text-dark-800 mb-2">
            Welcome back, {user?.displayName || 'User'}!
          </h1>
          <p className="text-dark-500">
            Access AI-powered multimodal tools. New features coming soon!
          </p>
        </div>
        
        {/* Quota Section */}
        {!loading && quota && (
          <div className="bg-white dark-glass rounded-xl p-4">
            <h3 className="font-medium text-dark-700 mb-3">Your Quotas</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-primary-600">{quota.chat || 0}</p>
                <p className="text-xs text-dark-500">Chat</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-primary-600">{quota.imageGeneration || 0}</p>
                <p className="text-xs text-dark-500">Images</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-primary-600">{quota.videoGeneration || 0}</p>
                <p className="text-xs text-dark-500">Videos</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-primary-600">{quota.total || 0}</p>
                <p className="text-xs text-dark-500">Total</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Features Grid */}
        <div>
          <h2 className="text-xl font-bold text-dark-800 mb-4">AI Tools</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((feature) => (
              <div
                key={feature.id}
                onClick={() => feature.available && navigate(feature.path)}
                className={`
                  border rounded-xl p-6 transition-all cursor-pointer
                  ${feature.available 
                    ? 'border-dark-200 hover:shadow-md hover:-translate-y-1' 
                    : 'border-dark-200 opacity-60 cursor-not-allowed'
                  }
                  ${feature.available ? 'bg-white hover:bg-dark-50/50' : 'bg-gray-50'}
                `}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className={`w-10 h-10 rounded-lg ${feature.color} flex items-center justify-center`}>
                    <span className="text-white text-xl">{feature.icon}</span>
                  </div>
                  {!feature.available && (
                    <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-full">
                      Coming Soon
                    </span>
                  )}
                </div>
                <h3 className="font-bold text-dark-800 mb-1">{feature.title}</h3>
                <p className="text-sm text-dark-500">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default DashboardPage