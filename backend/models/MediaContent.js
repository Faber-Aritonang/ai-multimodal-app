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
  
  outputFile: {
    type: String,
    required: true
  },
  
  outputUrl: {
    type: String,
    required: true
  },
  
  metadata: {
    width: Number,
    height: Number,
    duration: Number,
    resolution: String,
    format: String
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