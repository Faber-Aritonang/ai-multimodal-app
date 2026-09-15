/**
 * Media Content Schema
 * Untuk menyimpan hasil generate media (image, video, sound)
 */

const mongoose = require('mongoose');

const mediaContentSchema = new mongoose.Schema({
  contentId: {
    type: String,
    unique: true
  },
  
  userId: {
    type: String,
    required: true,
    index: true
  },
  
  type: {
    type: String,
    enum: ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'text-to-sound', 'sound-to-text'],
    required: true
  },
  
  prompt: {
    type: String,
    required: true
  },
  
  inputFile: {
    type: String,
    default: null
  },
  
  // Path file hasil generate di server (null selama processing / saat gagal)
  outputFile: {
    type: String,
    default: null
  },
  
  // URL publik relatif (mis. /uploads/media_xxx.png) yang dipakai frontend
  outputUrl: {
    type: String,
    default: null
  },
  
  metadata: {
    width: Number,
    height: Number,
    duration: Number,
    resolution: String,
    // Ukuran yang diminta user; bisa berbeda dari `resolution` kalau provider
    // mengembalikan gambar dengan dimensi lain.
    requestedResolution: String,
    // Dimensi gambar input pada image-to-image (sebelum diedit). Mongoose
    // membuang field yang tidak ada di schema secara diam-diam, jadi setiap
    // field metadata baru harus didaftarkan di sini.
    inputResolution: String,
    format: String,
    // Provider & model yang dipakai saat generate (mis. cloudflare / flux-1-schnell)
    provider: String,
    model: String
  },
  
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  
  error: {
    message: String,
    code: String
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  completedAt: {
    type: Date,
    default: null
  }
});

// Generate contentId
mediaContentSchema.pre('save', function(next) {
  if (!this.contentId) {
    this.contentId = `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  if (this.status === 'completed' && !this.completedAt) {
    this.completedAt = Date.now();
  }
  next();
});

// Index untuk query cepat
mediaContentSchema.index({ userId: 1, createdAt: -1 });
mediaContentSchema.index({ type: 1 });
mediaContentSchema.index({ status: 1 });

module.exports = mongoose.model('MediaContent', mediaContentSchema);