import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { mediaAPI } from '../config/api'
import Toaster from './Toaster'

/**
 * Pemberi tahu pekerjaan latar belakang + notifikasi aplikasi.
 *
 * Masalah yang dipecahkan: generate video memakan 1-5 menit dan dikerjakan di
 * server. Halaman alat memang memantau pekerjaannya sendiri (lihat VideoTool),
 * tetapi begitu user berpindah halaman — membaca riwayat, membuka chat, melihat
 * profil — pantauan itu hilang, dan videonya "muncul tanpa pemberitahuan".
 * Satu-satunya cara tahu adalah kembali ke halaman alat atau memuat ulang
 * Riwayat dan menebak-nebak.
 *
 * Cara kerjanya:
 *   1. halaman alat mendaftarkan pekerjaan yang baru dimulai lewat `watchJob`
 *      (endpoint video membalas 202 dengan record yang masih `processing`);
 *   2. daftar itu disimpan di localStorage, sehingga halaman yang dimuat ulang
 *      atau dibuka di tab lain tetap melanjutkan pantauannya;
 *   3. selama daftarnya tidak kosong, satu record diperiksa langsung lewat
 *      `GET /api/v1/media/:contentId` setiap beberapa detik — bukan seluruh
 *      riwayat, karena riwayat memuat puluhan URL panjang;
 *   4. begitu statusnya `completed` atau `failed`, notifikasinya muncul dan
 *      itemnya dikeluarkan dari daftar pantau.
 *
 * Pantauan sengaja memakai endpoint per-record: satu pekerjaan = satu
 * permintaan kecil, dan biayanya tidak tumbuh seiring bertambahnya riwayat user.
 */

const STORAGE_KEY = 'pendingJobs'

// Jeda antar pemeriksaan. Video selesai dalam hitungan menit, jadi 6 detik
// sudah cukup responsif tanpa membuat endpoint ini dipanggil terus-menerus.
const JEDA_POLL_MS = 6000

// Pekerjaan yang lebih tua dari batas ini tidak lagi dipantau: provider
// menyelesaikan video dalam 1-5 menit, jadi lewat 30 menit record-nya praktis
// tidak akan berubah (mis. kontainer backend ter-restart di tengah pekerjaan).
// Tanpa batas ini, satu record yang tertinggal akan dipolling selamanya.
const MAKS_UMUR_MS = 30 * 60 * 1000

// Batas jumlah pantauan sekaligus, supaya daftar yang menumpuk (mis. dari sesi
// lama) tidak berubah menjadi puluhan permintaan per putaran.
const MAKS_PANTAUAN = 5

const LABEL = {
  'text-to-video': 'Video',
  'image-to-video': 'Video',
  'text-to-image': 'Gambar',
  'image-to-image': 'Gambar',
  'text-to-sound': 'Audio',
  'sound-to-text': 'Transkrip'
}

const NotificationsContext = createContext(null)

const bacaPantauan = () => {
  try {
    const isi = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(isi) ? isi.filter((item) => item && item.contentId) : []
  } catch {
    return []
  }
}

const tulisPantauan = (daftar) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(daftar))
  } catch {
    // Kuota localStorage penuh atau mode privat: pantauan lintas-halaman hilang,
    // tetapi notifikasi di halaman ini tetap berjalan. Tidak ada yang perlu
    // digagalkan karena ini.
  }
}

const NotificationsProvider = ({ children }) => {
  const location = useLocation()
  const [pantauan, setPantauan] = useState(bacaPantauan)
  const [toasts, setToasts] = useState([])
  // Jumlah hasil yang selesai saat user TIDAK sedang melihat daftarnya; dipakai
  // sebagai lencana di menu Riwayat.
  const [unread, setUnread] = useState(0)
  const idRef = useRef(0)
  const pathRef = useRef(location.pathname)
  const pantauanRef = useRef(pantauan)

  pathRef.current = location.pathname
  pantauanRef.current = pantauan

  const simpanPantauan = useCallback((perubahan) => {
    setPantauan((sebelumnya) => {
      const baru = perubahan(sebelumnya)
      tulisPantauan(baru)
      return baru
    })
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((daftar) => daftar.filter((item) => item.id !== id))
  }, [])

  /** Tampilkan satu notifikasi; hilang sendiri setelah beberapa detik. */
  const notify = useCallback(
    ({ title, message, tone = 'info', action = null, ttlMs = 9000 }) => {
      idRef.current += 1
      const id = `toast-${idRef.current}`

      setToasts((daftar) => [...daftar, { id, title, message, tone, action }].slice(-4))

      setTimeout(() => dismissToast(id), ttlMs)

      return id
    },
    [dismissToast]
  )

  /**
   * Daftarkan satu pekerjaan latar belakang untuk dipantau.
   * Dipanggil halaman alat setelah server membalas 202.
   */
  const watchJob = useCallback(
    (media) => {
      if (!media?.contentId) return

      simpanPantauan((sebelumnya) => {
        if (sebelumnya.some((item) => item.contentId === media.contentId)) return sebelumnya

        return [
          ...sebelumnya,
          { contentId: media.contentId, type: media.type, prompt: media.prompt, at: Date.now() }
        ].slice(-MAKS_PANTAUAN)
      })
    },
    [simpanPantauan]
  )

  const lupakan = useCallback(
    (contentId) => simpanPantauan((sebelumnya) => sebelumnya.filter((item) => item.contentId !== contentId)),
    [simpanPantauan]
  )

  /** Hapus pantauan yang sudah kedaluwarsa (lihat MAKS_UMUR_MS). */
  useEffect(() => {
    const kadaluwarsa = pantauan.filter((item) => Date.now() - (item.at || 0) > MAKS_UMUR_MS)

    if (kadaluwarsa.length) {
      simpanPantauan((sebelumnya) =>
        sebelumnya.filter((item) => Date.now() - (item.at || 0) <= MAKS_UMUR_MS)
      )
    }
    // Hanya dijalankan saat daftarnya berubah.
  }, [pantauan, simpanPantauan])

  useEffect(() => {
    if (!pantauan.length) return undefined

    // Tanpa token tidak ada yang bisa diperiksa; jangan mengirim permintaan yang
    // pasti dijawab 401 (dan tercatat sebagai galat di server).
    if (!localStorage.getItem('authToken')) return undefined

    let dibatalkan = false

    const periksa = async () => {
      const daftar = pantauanRef.current

      for (const item of daftar) {
        try {
          const response = await mediaAPI.getMedia(item.contentId)
          const media = response.data?.media

          if (!media) continue

          if (media.status === 'completed') {
            lupakan(item.contentId)

            // Kalau user sedang melihat halaman alat yang menampilkan hasilnya,
            // halaman itu sudah memperbarui dirinya sendiri — notifikasi hanya
            // akan mengulang informasi yang sudah terlihat.
            const diHalamanAlat = pathRef.current === `/tools/${item.type}`

            if (!diHalamanAlat) {
              setUnread((jumlah) => jumlah + 1)
              notify({
                tone: 'success',
                title: `${LABEL[item.type] || 'Hasil'} selesai dibuat`,
                message: item.prompt,
                action: { label: 'Lihat di Riwayat', href: `/history?type=${item.type}` }
              })
            }
          } else if (media.status === 'failed') {
            lupakan(item.contentId)

            const diHalamanAlat = pathRef.current === `/tools/${item.type}`

            if (!diHalamanAlat) {
              notify({
                tone: 'error',
                title: `${LABEL[item.type] || 'Pekerjaan'} gagal dibuat`,
                message: media.error?.message || 'Buka Riwayat untuk melihat sebabnya.',
                action: { label: 'Lihat di Riwayat', href: `/history?type=${item.type}` }
              })
            }
          }
        } catch (error) {
          const status = error.response?.status

          // 404 berarti recordnya sudah dihapus user: tidak ada lagi yang perlu
          // dipantau. 401 berarti sesinya habis; pantauan dibiarkan supaya
          // dilanjutkan setelah user login lagi.
          if (status === 404) lupakan(item.contentId)
        }
      }
    }

    periksa()

    const timer = setInterval(() => {
      if (!dibatalkan) periksa()
    }, JEDA_POLL_MS)

    return () => {
      dibatalkan = true
      clearInterval(timer)
    }
  }, [pantauan, lupakan, notify])

  // Lencana dibersihkan saat user benar-benar membuka daftarnya.
  useEffect(() => {
    if (location.pathname === '/history') setUnread(0)
  }, [location.pathname])

  const value = useMemo(
    () => ({ notify, watchJob, watched: pantauan.length, unread, clearUnread: () => setUnread(0) }),
    [notify, watchJob, pantauan.length, unread]
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </NotificationsContext.Provider>
  )
}

/**
 * Akses notifikasi. Aman dipanggil dari komponen yang berada di luar provider
 * (mis. saat test memuat satu komponen saja): nilainya `null`, dan pemanggilnya
 * memakai `?.` — bukan melempar, karena komponen seperti Layout dipakai di
 * banyak tempat dan tidak boleh mati hanya karena providernya belum terpasang.
 */
export const useNotifications = () => useContext(NotificationsContext)

export default NotificationsProvider
