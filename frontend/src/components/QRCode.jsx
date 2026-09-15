import { memo } from 'react'
import { QRCodeSVG } from 'qrcode.react'

/**
 * QR Code Generator Component
 *
 * Di-render sepenuhnya di browser memakai library `qrcode.react`,
 * jadi tidak butuh service eksternal (Google Charts API sudah tidak aktif).
 *
 * Props:
 * - value    : string yang di-encode ke dalam QR
 * - size     : ukuran QR dalam pixel (default 200)
 * - className: kelas tambahan untuk wrapper
 * - onError  : opsional, dipanggil jika value tidak valid
 */
const QRCode = memo(({ value, size = 200, className = '', onError }) => {
  if (!value) {
    return (
      <div
        className={`flex items-center justify-center bg-dark-100 rounded-lg text-xs text-dark-400 ${className}`}
        style={{ width: size, height: size }}
      >
        QR code belum tersedia
      </div>
    )
  }

  try {
    return (
      <div className={`inline-block bg-white p-2 rounded-lg shadow-md ${className}`}>
        <QRCodeSVG
          value={String(value)}
          size={size}
          level="M"
          marginSize={2}
          title={`QR Code: ${value}`}
        />
      </div>
    )
  } catch (error) {
    console.error('QR generation error:', error)
    onError?.(error)

    return (
      <div
        className={`flex items-center justify-center bg-red-50 rounded-lg text-xs text-red-500 ${className}`}
        style={{ width: size, height: size }}
      >
        Gagal membuat QR code
      </div>
    )
  }
})

QRCode.displayName = 'QRCode'

export default QRCode
