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
  
  // Jumlah request tersisa (quota)
  quota: {
    chat: { type: Number, default: 100 },
    imageGeneration: { type: Number, default: 10 },
    videoGeneration: { type: Number, default: 5 },
    total: { type: Number, default: 1000 }
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