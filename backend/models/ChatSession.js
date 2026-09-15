/**
 * Chat Session Schema
 * Untuk menyimpan riwayat percakapan chat
 */

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const chatSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    unique: true
  },
  
  userId: {
    type: String,
    required: true,
    index: true
  },
  
  messages: [messageSchema],
  
  model: {
    type: String,
    default: 'gpt-4'
  },
  
  title: {
    type: String,
    default: 'New Chat'
  },
  
  isPinned: {
    type: Boolean,
    default: false
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Generate sessionId
chatSessionSchema.pre('save', function(next) {
  if (!this.sessionId) {
    this.sessionId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  this.updatedAt = Date.now();
  next();
});

// Index untuk query cepat.
// sessionId sudah unique di definisi field, cukup tambahkan index gabungan ini.
chatSessionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatSession', chatSessionSchema);