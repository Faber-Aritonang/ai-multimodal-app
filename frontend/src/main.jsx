import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import NotificationsProvider from './components/NotificationsProvider'
import { pasangPelaporGalatGlobal } from './utils/errorReporter'
import './app.css'

// Ditangkap di luar React (galat event handler & promise tanpa catch) maupun di
// dalamnya — dua jalur berbeda karena React tidak meneruskan keduanya ke error
// boundary. Lihat catatan di utils/errorReporter.js.
pasangPelaporGalatGlobal()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* Provider notifikasi ada di akar karena pekerjaan latar belakang (video
          1-5 menit) harus tetap dipantau dan dilaporkan walau user berpindah
          halaman — lihat components/NotificationsProvider.jsx. Ia butuh
          BrowserRouter di atasnya karena membaca halaman yang sedang dibuka. */}
      <NotificationsProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </NotificationsProvider>
    </BrowserRouter>
  </React.StrictMode>
)
