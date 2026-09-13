/**
 * Admin Schema
 * Untuk admin yang mengelola persetujuan member
 */

const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  uid: {
    type: String,
    required: true,
    unique: true
  },
  
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
  
  role: {
    type: String,
    enum: ['superadmin', 'moderator', 'admin'],
    default: 'admin'
  },
  
  permissions: {
    approveMembers: { type: Boolean, default: true },
    rejectMembers: { type: Boolean, default: true },
    manageUsers: { type: Boolean, default: true },
    viewAnalytics: { type: Boolean, default: true }
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  lastLogin: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Admin', adminSchema);