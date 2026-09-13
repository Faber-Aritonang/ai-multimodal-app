import { useState, useRef, useEffect } from 'react'
import { Member } from '../models/User'

/**
 * QR Code Generator Component
 * Menggunakan library QRious untuk generate QR code
 */
const QRCode = ({ value, size = 200, onError }) => {
  const [qrData, setQrData] = useState(null)
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef(null)

  useEffect(() => {
    const generateQR = async () => {
      setLoading(true)
      
      // Dinamis: gunakan QRious jika tersedia, atau fallback ke Google Charts
      if (typeof QRious !== 'undefined') {
        try {
          const qr = new QRious({
            element: canvasRef.current,
            value: value,
            size: size
          })
          setQrData(value)
        } catch (err) {
          console.error('QR generation error:', err)
          onError?.(err)
        }
      } else {
        // Fallback ke Google Charts API
        const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encodeURIComponent(value)}&choe=UTF-8`
        setQrData(qrUrl)
      }
      
      setLoading(false)
    }

    generateQR()
  }, [value, size])

  if (loading) return <div className="animate-pulse bg-gray-200 rounded" style={{ width: size, height: size }} />

  if (!qrData) return null

  const isCanvas = !qrData.includes('chart.googleapis.com')

  return isCanvas ? (
    <canvas ref={canvasRef} />
  ) : (
    <img 
      src={qrData} 
      alt="QR Code" 
      className="rounded-lg shadow-md"
      onError={(e) => {
        e.target.style.display = 'none'
        onError?.(new Error('Failed to load QR code'))
      }}
    />
  )
}

export default QRCode