/**
 * User Schema
 * Untuk member yang sudah terdaftar dan disetujui admin
 */

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Firebase Auth UID
  uid: {
    type: String,
    required: true,
    unique: true
  },
  
  // Informasi akun
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  
  displayName: {
    type: String,
    required: true
  },
  
  photoURL: {
    type: String,
    default: ''
  },

  // Bio singkat yang boleh diedit sendiri oleh user (halaman profil).
  // Panjangnya dibatasi di schema DAN di controller: schema menjaga data yang
  // sudah ada, controller memberi pesan yang bisa dibaca user.
  bio: {
    type: String,
    default: '',
    maxlength: 200
  },
  
  // Status keanggotaan
  role: {
    type: String,
    enum: ['guest', 'member'],
    default: 'guest'
  },
  
  // Approval status untuk admin
  isApproved: {
    type: Boolean,
    default: false
  },
  
  // Jumlah request tersisa (quota).
  // Satu kunci per jenis pekerjaan: `chat`, `imageGeneration` (gambar hasil),
  // `audioGeneration` (text-to-sound & sound-to-text), dan `videoGeneration`
  // (text-to-video & image-to-video). Sebelumnya audio memakai `videoGeneration`
  // sehingga satu fitur bisa menghabiskan jatah fitur lain; akun lama yang belum
  // punya `audioGeneration` tetap dilayani lewat nilai cadangan di checkQuota.
  // Aturan kuota berlaku sama dengan default persetujuan admin
  // (controllers/adminController.js approveMember) dan payload tombol approve
  // di halaman admin — ketiganya harus diubah bersama-sama.
  quota: {
    chat: { type: Number, default: 60 },
    imageGeneration: { type: Number, default: 30 },
    audioGeneration: { type: Number, default: 25 },
    videoGeneration: { type: Number, default: 25 },
    total: { type: Number, default: 140 }
  },
  
  // Jejak pendaftaran — penanda untuk admin mendeteksi 1 device yang
  // mendaftar ulang dengan akun Google berbeda. Sifatnya PENANDA, bukan
  // blokir: yang menolak/menerima tetap admin di halaman Pending Members
  // (nilai sameDeviceUid & sameIpCount dihitung saat register, lihat
  // controllers/authController.js).
  registrationMeta: {
    // IP publik klien (trust proxy sudah diset di server.js)
    ip: { type: String, default: '' },
    // "Kota, Negara — ISP" dari ipwho.is; kosong bila lookup gagal
    location: { type: String, default: '' },
    // Id unik browser (localStorage) — sinyal utama "device yang sama"
    deviceId: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    // uid akun LAIN yang memakai deviceId sama (kosong = device baru)
    sameDeviceUid: { type: String, default: '' },
    // jumlah akun LAIN dari IP yang sama (0 = tidak ada yang tercatat)
    sameIpCount: { type: Number, default: 0 }
  },

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  },
  
  lastLogin: {
    type: Date,
    default: Date.now
  },
  
  // Kode referral milik user ini (dipakai orang lain saat mendaftar)
  referralCode: {
    type: String,
    unique: true,
    sparse: true
  },

  // Kode referral milik user yang mengajak user ini mendaftar
  referredBy: {
    type: String,
    default: null,
    index: true
  }
});

// Generate referral code otomatis
userSchema.pre('save', function(next) {
  if (!this.referralCode) {
    // Generate referral code: REF + 6 digit random
    this.referralCode = 'REF' + Math.random().toString(36).substring(2, 8).toUpperCase()
  }
  this.updatedAt = Date.now();
  next();
});

// Index untuk pencarian cepat.
// Catatan: uid & email sudah unique (dan referralCode sudah sparse unique) di
// definisi field, jadi tidak perlu dideklarasikan ulang di sini.
userSchema.index({ isApproved: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);