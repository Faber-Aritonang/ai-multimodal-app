// API Service - Menyediakan fungsi-fungsi untuk berinteraksi dengan backend API

import axios from 'axios';

// Base URL backend API.
// - Development: dibiarkan kosong, request '/api/v1' di-forward oleh proxy Vite
//   (lihat vite.config.js) ke http://localhost:3000.
// - Production  : isi VITE_API_URL dengan URL backend, mis.
//   https://ai-multimodal-backend.up.railway.app
const apiRoot = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');

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
    if (error.response?.status === 401) {
      // Hapus token jika unauthorized
      localStorage.removeItem('authToken');
      localStorage.removeItem('user');
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
  sendMessage: (sessionId, message) => 
    api.post(`/member/chat/sessions/${sessionId}/message`, { message }),
  getChatSession: (sessionId) => api.get(`/member/chat/sessions/${sessionId}`),
  deleteChatSession: (sessionId) => api.delete(`/member/chat/sessions/${sessionId}`),
  
  // Profile
  getProfile: () => api.get('/member/profile'),
  getQuota: () => api.get('/member/quota'),
  
  // Member list & referral
  getApprovedMembers: () => api.get('/member/members'),
  getMemberByReferralCode: (code) => api.get(`/member/members/${code}`),
  getReferralStats: () => api.get('/member/referral-stats'),
};

// Media API (AI multimodal berbasis gambar)
export const mediaAPI = {
  // Info endpoint yang tersedia + yang belum diimplementasi
  getStatus: () => api.get('/media/status'),

  // Text to image
  textToImage: ({ prompt, size, quality }) =>
    api.post('/media/text-to-image', { prompt, size, quality }, { timeout: 120000 }),

  // Riwayat media milik user
  getHistory: (params = {}) => api.get('/media/history', { params }),

  // Hapus satu media
  deleteMedia: (contentId) => api.delete(`/media/${contentId}`),
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
