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
  
  // Opsional: referral code
  referralCode: {
    type: String,
    unique: true,
    sparse: true
  }
});

// Update timestamp
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index untuk pencarian cepat
userSchema.index({ uid: 1 });
userSchema.index({ email: 1 });
userSchema.index({ isApproved: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);