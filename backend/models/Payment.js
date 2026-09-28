/**
 * Payment Schema
 * Catatan transaksi pembayaran upgrade ke member paid (gateway Duitku/Tripay,
 * dipilih lewat PAYMENT_PROVIDER).
 *
 * Satu dokumen per order_id. Statusnya diperbarui HANYA dari callback gateway
 * (lihat controllers/paymentController.js handlePaymentNotification) yang
 * tervalidasi signature-nya, atau dari verifikasi status ke gateway — bukan
 * dari request browser, supaya tidak ada yang bisa mengaktifkan member paid
 * tanpa benar-benar membayar.
 */

const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // Pemilik transaksi (User.uid)
  uid: {
    type: String,
    required: true,
    index: true
  },

  // order_id yang dikirim ke gateway — kunci pencocokan callback.
  orderId: {
    type: String,
    required: true,
    unique: true
  },

  // Gateway yang memproses: 'duitku' | 'tripay'
  // (lihat config/paymentGateway.js). Disimpan per transaksi supaya riwayat
  // tetap terbaca walau provider diganti kemudian.
  provider: {
    type: String,
    default: ''
  },

  // Nomor referensi milik gateway (TriPay `reference`, Duitku `reference`) —
  // dipakai verifikasi status manual (POST /payment/check).
  providerReference: {
    type: String,
    default: ''
  },

  // Paket yang dibeli. Saat ini hanya 'paid' (upgrade member berbayar).
  plan: {
    type: String,
    enum: ['paid'],
    default: 'paid'
  },

  // Harga dalam Rupiah (integer). Disimpan di sini supaya riwayat transaksi
  // tetap benar walau harga di config berubah kemudian.
  amount: {
    type: Number,
    required: true
  },

  // 'pending' : menunggu pembayaran
  // 'paid'    : pembayaran diterima (settlement/capture) -> member diaktifkan
  // 'failed'  : ditolak/dibatalkan
  // 'expired' : kedaluwarsa tanpa pembayaran
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'expired'],
    default: 'pending',
    index: true
  },

  // Jenis pembayaran dari notifikasi gateway (qris, bank_transfer, ...)
  paymentType: {
    type: String,
    default: ''
  },

  // URL halaman pembayaran gateway untuk menyelesaikan transaksi (dipakai tombol
  // "lanjutkan pembayaran" bila user menutup tab sebelum selesai).
  redirectUrl: {
    type: String,
    default: ''
  },

  // Waktu pembayaran diterima.
  paidAt: {
    type: Date,
    default: null
  },

  // Waktu notifikasi terakhir diterima — membantu debugging webhook.
  lastNotificationAt: {
    type: Date,
    default: null
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

paymentSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Riwayat transaksi per user (halaman status pembayaran) — diurutkan terbaru.
paymentSchema.index({ uid: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
