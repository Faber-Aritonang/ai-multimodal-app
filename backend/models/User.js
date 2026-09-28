/**
 * User Schema
 * Untuk member yang sudah terdaftar dan disetujui admin
 */

const mongoose = require('mongoose');
const { quotaForPlan } = require('../config/membershipPlans');

// Kuota default member biasa (free). Angkanya berasal dari satu sumber:
// config/membershipPlans.js — ubah di sana bila jatah berubah.
const DEFAULT_QUOTA = quotaForPlan('free');

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

  // Paket AKTIF: 'free' = member biasa, 'paid' = member berbayar (kuota 5x).
  // Nilai 'paid' hanya dipasang setelah pembayaran diterima gateway
  // (controllers/paymentController.js activatePaidMember) — bukan saat
  // mendaftar, supaya tidak ada yang mendapat kuota berbayar tanpa membayar.
  plan: {
    type: String,
    enum: ['free', 'paid'],
    default: 'free'
  },

  // Paket yang DIPILIH saat mendaftar (bukan paket aktif). Pendaftar yang
  // memilih 'paid' diarahkan menyelesaikan pembayaran; sampai itu terjadi ia
  // belum disetujui dan tombol bayarnya muncul di halaman Pending Approval.
  selectedPlan: {
    type: String,
    enum: ['free', 'paid'],
    default: 'free'
  },

  // Saat paket berbayar diaktifkan (pembayaran diterima).
  planActivatedAt: {
    type: Date,
    default: null
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
  // Angka defaultnya dari config/membershipPlans.js (paket free). Paket paid
  // mendapat jatah 5x lipat yang dipasang saat pembayaran diterima — lihat
  // controllers/paymentController.js activatePaidMember.
  quota: {
    chat: { type: Number, default: DEFAULT_QUOTA.chat },
    imageGeneration: { type: Number, default: DEFAULT_QUOTA.imageGeneration },
    audioGeneration: { type: Number, default: DEFAULT_QUOTA.audioGeneration },
    videoGeneration: { type: Number, default: DEFAULT_QUOTA.videoGeneration },
    total: { type: Number, default: DEFAULT_QUOTA.total }
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