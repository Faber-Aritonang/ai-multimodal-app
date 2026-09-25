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
    // Khusus audio (text-to-sound): format MIME berkasnya, panjang audionya
    // dalam detik (hanya terbaca dari header WAV), serta voice bawaan atau
    // deskripsi gaya suara yang dipakai.
    mimeType: String,
    voice: String,
    style: String,
    // Khusus audio (sound-to-text): teks hasil transkripsi dan bahasa yang
    // dipakai membacanya. Transkrip IKUT disimpan di `prompt` (supaya daftar
    // riwayat bisa menampilkannya seperti fitur lain), tetapi bentuk aslinya
    // tetap ada di sini agar tidak bergantung pada field yang maknanya bisa
    // berubah di kemudian hari.
    transcript: String,
    language: String,
    // Khusus video (text-to-video / image-to-video): bentuk gambar (aspect
    // ratio), mode yang diminta (t2v/i2v), dan id pekerjaan di provider. `mode`
    // ikut disimpan karena satu model video melayani beberapa mode, dan tanpa
    // catatan ini tidak bisa dibedakan hasil yang berangkat dari teks dengan
    // yang berangkat dari gambar ketika tidak ada gambar inputnya.
    aspectRatio: String,
    mode: String,
    jobId: String,
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

  // Tautan baca-saja untuk dibagikan ke luar aplikasi (lihat shareMedia di
  // mediaController).
  //
  // Nilainya token acak, BUKAN contentId: contentId muncul di URL dan bisa
  // ditebak dari daftar riwayat siapa pun, sedangkan token ini 192 bit acak,
  // sehingga satu-satunya cara membukanya adalah memegang tautannya. Token yang
  // sama juga tidak pernah dipakai untuk mengakses endpoint ber-auth.
  //
  // Dibiarkan TIDAK diisi (bukan `default: null`) supaya dokumen yang belum
  // dibagikan tidak punya field ini sama sekali; index unik `sparse` melewatkan
  // dokumen tanpa field, sedangkan `null` dianggap nilai dan akan saling
  // bertabrakan pada dokumen kedua.
  shareToken: {
    type: String,
    index: { unique: true, sparse: true }
  },

  // Kapan tautannya dibuat. Tautan yang dipertanyakan keamanannya bisa dicari
  // dari tanggal ini; `null` berarti tautan sudah dicabut (tokennya dihapus).
  sharedAt: {
    type: Date,
    default: null
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