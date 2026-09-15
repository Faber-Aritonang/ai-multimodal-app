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
  },

  // Provider & model yang menjawab pesan ini. Disimpan per pesan (bukan hanya
  // per sesi) karena fallback bisa berganti di tengah percakapan — satu balasan
  // dari Groq, balasan berikutnya dari Gemini. Label di UI jadi tetap jujur.
  provider: {
    type: String,
    default: null
  },

  model: {
    type: String,
    default: null
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
  
  // Provider & model yang benar-benar menjawab, diisi chatController saat balasan
  // berhasil. Sebelumnya `model` hanya berisi default 'gpt-4' yang tidak pernah
  // diperbarui, sehingga riwayat chat melaporkan model yang salah (mis. balasan
  // dari Groq tetap tertulis gpt-4).
  provider: {
    type: String,
    default: null
  },
  
  model: {
    type: String,
    default: null
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