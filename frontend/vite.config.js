import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // loadEnv dipakai supaya .env.local bisa ikut terbaca di level config
  // (Vite hanya otomatis mengekspos variabel VITE_* ke kode aplikasi, bukan ke config ini).
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_PROXY_TARGET || process.env.VITE_PROXY_TARGET || 'http://localhost:3000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: false
        },
        '/health': {
          target,
          changeOrigin: true
        },
        // Hasil generate media diserve backend pada /uploads
        '/uploads': {
          target,
          changeOrigin: true
        }
      }
    }
  }
})
