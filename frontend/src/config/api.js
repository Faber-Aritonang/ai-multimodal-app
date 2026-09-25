// API Service - Menyediakan fungsi-fungsi untuk berinteraksi dengan backend API

import axios from 'axios';
import { buatRequestId } from '../utils/requestId';

// Base URL backend API.
// - Development: dibiarkan kosong, request '/api/v1' di-forward oleh proxy Vite
//   (lihat vite.config.js) ke http://localhost:3000.
// - Production  : isi VITE_API_URL dengan URL backend, mis.
//   https://ai-multimodal-backend.up.railway.app
// Pada production, jangan jatuh ke URL relatif: domain custom Vercel hanya
// menyajikan frontend dan tidak menjalankan Express API. Env tetap menjadi
// pilihan utama, sedangkan fallback ini menjaga alias Vercel/custom domain
// memakai backend produksi yang sama bila VITE_API_URL belum diisi.
const configuredApiRoot = (import.meta.env.VITE_API_URL || '').trim();
const productionApiRoot = 'https://ai-multimodal-app-production.up.railway.app';
const apiRoot = (configuredApiRoot || (import.meta.env.PROD ? productionApiRoot : ''))
  .replace(/\/+$/, '');

// Buat instance axios dengan konfigurasi default
const api = axios.create({
  baseURL: apiRoot ? `${apiRoot}/api/v1` : '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true
});

// Request interceptor - tambahkan token ke header
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Id request per pemanggilan. Backend memakai nilai ini apa adanya
    // (backend/middleware/requestContext.js), sehingga baris log server untuk
    // permintaan ini bisa dicari langsung dari browser — dan bila permintaan ini
    // gagal, laporan galat frontend menunjuk ke id yang sama.
    // Header kustom tidak menambah preflight baru: Authorization dan
    // Content-Type sudah memicunya untuk permintaan lintas domain.
    config.headers['X-Request-Id'] = buatRequestId();

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle error global
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    // Id request yang dikirim untuk pemanggilan ini, supaya pelapor galat bisa
    // menyambungkannya ke baris log server (lihat utils/errorReporter.js).
    error.requestId = error.config?.headers?.['X-Request-Id'] || undefined;

    if (status === 401) {
      // Hapus token jika unauthorized
      localStorage.removeItem('authToken');
      localStorage.removeItem('user');
    }

    // 429 bisa datang dalam bentuk teks polos (rate limiter bawaan) atau HTML
    // (proxy di depan backend). Akibatnya `err.response.data.message` kosong dan
    // UI hanya menampilkan pesan axios mentah "Request failed with status code
    // 429", yang tidak memberi tahu apa pun ke user. Bentuknya diseragamkan di
    // sini supaya semua halaman bisa menampilkannya apa adanya.
    if (status === 429 && error.response) {
      const data = error.response.data;
      const alreadyHasMessage = data && typeof data === 'object' && data.message;

      if (!alreadyHasMessage) {
        const retryAfter = Number(error.response.headers?.['retry-after']) || null;

        error.response.data = {
          success: false,
          message: retryAfter
            ? `Too many requests. Please try again in ${retryAfter} seconds.`
            : 'Too many requests to the server. Please wait a moment and try again.',
          ...(retryAfter ? { retryAfter } : {})
        };
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Ubah URL media relatif dari backend menjadi URL yang bisa dipakai browser.
 * Hasil generate disimpan sebagai '/uploads/xxx.png'.
 * - Development: dibiarkan relatif, di-proxy Vite ke backend.
 * - Production : ditempel ke VITE_API_URL.
 */
export const resolveMediaUrl = (url) => {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${apiRoot}${url}`;
};

// Auth API
export const authAPI = {
  // Registrasi
  register: (data) => api.post('/auth/register', data),
  // Login
  login: (data) => api.post('/auth/login', data),
  // Login tanpa Firebase — hanya berfungsi saat backend di luar production
  devLogin: (data) => api.post('/auth/dev-login', data),
  // Logout
  logout: () => api.post('/auth/logout'),
  // Cek status auth
  getStatus: () => api.get('/auth/status'),
  // Info pemilik kode referral (publik, untuk halaman undangan)
  getReferralInfo: (code) => api.get(`/auth/referral/${code}`),
};

// Member API
export const memberAPI = {
  // Chat
  getChatSessions: () => api.get('/member/chat/sessions'),
  createChatSession: () => api.post('/member/chat/sessions'),
  // Timeout lebih panjang dari default (30 detik): provider chat punya fallback
  // berantai, dan free tier Gemini bisa butuh sampai ~60 detik untuk menjawab.
  sendMessage: (sessionId, message) =>
    api.post(`/member/chat/sessions/${sessionId}/message`, { message }, { timeout: 150000 }),
  getChatSession: (sessionId) => api.get(`/member/chat/sessions/${sessionId}`),
  deleteChatSession: (sessionId) => api.delete(`/member/chat/sessions/${sessionId}`),
  
  // Profile
  getProfile: () => api.get('/member/profile'),
  // Yang boleh diubah hanya data tampilan (nama, bio, foto); field wewenang
  // admin diabaikan backend walau ikut terkirim.
  updateProfile: (data) => api.put('/member/profile', data),
  getQuota: () => api.get('/member/quota'),
  
  // Member list & referral
  getApprovedMembers: () => api.get('/member/members'),
  getMemberByReferralCode: (code) => api.get(`/member/members/${code}`),
  getReferralStats: () => api.get('/member/referral-stats'),
};

// Media API (AI multimodal berbasis gambar & audio)
export const mediaAPI = {
  // Info endpoint yang tersedia + yang belum diimplementasi
  getStatus: () => api.get('/media/status'),

  // Voice TTS yang sah untuk provider yang sedang aktif. Diambil dari backend
  // karena providernya bisa ditukar lewat env dan nama voice Gemini berbeda
  // sepenuhnya dari voice OpenAI.
  getSoundVoices: () => api.get('/media/sound-voices'),

  // Text to image
  textToImage: ({ prompt, size, quality }) =>
    api.post('/media/text-to-image', { prompt, size, quality }, { timeout: 120000 }),

  // Image to image (gambar dikirim sebagai data URL, sudah diperkecil di browser)
  imageToImage: ({ prompt, image, size }) =>
    api.post('/media/image-to-image', { prompt, image, size }, { timeout: 180000 }),

  // Text to sound (TTS). `style` opsional: deskripsi gaya bicara yang dikirim ke
  // provider yang mendukungnya (Gemini lewat arahan bahasa alami, OpenAI lewat
  // `instructions`); voice yang dipilih tetap dipakai. Timeout lebih panjang
  // dari default karena sintesis suara bisa memakan puluhan detik.
  textToSound: ({ text, voice, style, format }) =>
    api.post('/media/text-to-sound', { text, voice, style, format }, { timeout: 180000 }),

  // Bahasa & format yang diterima sound-to-text. Diambil dari backend supaya
  // aturan yang ditampilkan ke user (format, batas ukuran) tidak perlu disalin
  // ulang di frontend dan tidak bisa menyimpang dari yang divalidasi server.
  getTranscribeOptions: () => api.get('/media/transcribe-options'),

  // Sound to text (transkripsi). `audio` dikirim sebagai data URL (sudah
  // dikonversi ke WAV di browser bila hasil rekaman); `language` dan `prompt`
  // opsional. Timeout lebih panjang dari default karena provider bisa memakan
  // puluhan detik untuk rekaman yang panjang.
  soundToText: ({ audio, language, prompt }) =>
    api.post('/media/sound-to-text', { audio, language, prompt }, { timeout: 180000 }),

  // Mode, resolusi, durasi & batas yang diterima endpoint video. Diambil dari
  // backend supaya aturan yang ditampilkan ke user tidak disalin ulang di sini
  // dan tidak bisa menyimpang dari yang divalidasi server.
  getVideoOptions: () => api.get('/media/video-options'),

  // Text to video & image to video. Keduanya membalas 202 segera (pekerjaannya
  // 1-5 menit dan berjalan di server), jadi hasilnya TIDAK ada di respons — ia
  // menyusul di riwayat. Karena itu timeout-nya tidak perlu panjang: yang
  // ditunggu hanyalah pembuatan record.
  textToVideo: ({ prompt, resolution, ratio, duration }) =>
    api.post('/media/text-to-video', { prompt, resolution, ratio, duration }, { timeout: 60000 }),

  // `image` dikirim sebagai data URL (sudah diperkecil di browser).
  imageToVideo: ({ prompt, image, resolution, duration }) =>
    api.post('/media/image-to-video', { prompt, image, resolution, duration }, { timeout: 60000 }),

  // Riwayat media milik user. `params` didukung: { type, status, q, page, limit }
  // — dipakai halaman Riwayat untuk pencarian, filter, dan paginasi.
  getHistory: (params = {}) => api.get('/media/history', { params }),

  // Satu hasil milik user. Dipakai pemantau pekerjaan latar belakang
  // (components/NotificationsProvider.jsx): satu permintaan kecil per pekerjaan,
  // jauh lebih murah daripada mengunduh seluruh riwayat setiap beberapa detik.
  getMedia: (contentId) => api.get(`/media/${contentId}`),

  // Tautan baca-saja. Keduanya hanya berlaku untuk hasil milik user sendiri, dan
  // keduanya idempoten: menekan dua kali tidak membuat tautan baru, dan mencabut
  // yang belum pernah dibagikan bukan kesalahan.
  shareMedia: (contentId) => api.post(`/media/${contentId}/share`),
  unshareMedia: (contentId) => api.delete(`/media/${contentId}/share`),

  // Hapus satu media
  deleteMedia: (contentId) => api.delete(`/media/${contentId}`),
};

// Share API (PUBLIK — dipakai halaman /share/:token yang dibuka tanpa login).
// Tetap lewat instance yang sama supaya alamat backend, header id request, dan
// penyeragaman pesan galat 429 berlaku sama seperti permintaan lain.
export const shareAPI = {
  getShared: (token) => api.get(`/share/${token}`)
};

// Admin API
export const adminAPI = {
  getPendingMembers: () => api.get('/admin/pending-members'),
  getApprovedMembers: () => api.get('/admin/approved-members'),
  approveMember: (uid, quota) => api.put(`/admin/approve-member/${uid}`, { quota }),
  rejectMember: (uid) => api.delete(`/admin/reject-member/${uid}`),
  getAnalytics: () => api.get('/admin/analytics'),
};

export default api;
