// API Service - Menyediakan fungsi-fungsi untuk berinteraksi dengan backend API

import axios from 'axios';

// Buat instance axios dengan konfigurasi default
const api = axios.create({
  baseURL: '/api/v1', // Proxy Vite akan forward ke backend
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

// Auth API
export const authAPI = {
  // Registrasi
  register: (data) => api.post('/auth/register', data),
  // Login
  login: (data) => api.post('/auth/login', data),
  // Logout
  logout: () => api.post('/auth/logout'),
  // Cek status auth
  getStatus: () => api.get('/auth/status'),
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
  
  // Member list (untuk referral)
  getApprovedMembers: () => api.get('/member/members'),
  getMemberByReferralCode: (code) => api.get(`/member/members/${code}`),
  getReferralStats: () => api.get('/member/referral-stats'),
  
  // Media (placeholder)
  // textToImage: (prompt) => api.post('/member/media/text-to-image', { prompt }),
  // imageToImage: (image, prompt) => api.post('/member/media/image-to-image', { image, prompt }),
  // textToVideo: (prompt) => api.post('/member/media/text-to-video', { prompt }),
  // imageToVideo: (image, prompt) => api.post('/member/media/image-to-video', { image, prompt }),
  // textToSound: (text) => api.post('/member/media/text-to-sound', { text }),
  // soundToText: (audio) => api.post('/member/media/sound-to-text', { audio }),
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