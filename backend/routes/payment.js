/**
 * Routes: Payment (upgrade ke member paid)
 *
 * Dua jalur:
 *   - Publik  : GET /plans (info paket untuk halaman registrasi/upgrade) dan
 *               POST /callback (callback gateway Duitku/Tripay,
 *               tervalidasi signature — bukan token user).
 *   - Login   : POST /create (buat transaksi), GET /status (pantau status),
 *               dan POST /check (verifikasi status ke gateway secara manual).
 *
 * Sengaja TIDAK memakai requireMember: pendaftar yang memilih paket paid harus
 * bisa membayar sebelum akunnya aktif (isApproved masih false). Yang dipakai
 * hanya `authenticate`; dokumen User-nya dibaca controller.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const PaymentController = require('../controllers/paymentController');

// Publik: daftar paket + harga (angka dari config/membershipPlans.js).
router.get('/plans', PaymentController.getPlans);

// Callback gateway pembayaran. Ditaruh SEBELUM authenticate: panggilannya
// datang dari server gateway, bukan dari user yang membawa token.
router.post('/callback', PaymentController.handlePaymentNotification);

router.use(authenticate);

// Buat transaksi pembayaran (member free yang upgrade, atau pendaftar paid).
router.post('/create', PaymentController.createUpgradePayment);

// Status paket & pembayaran terakhir milik user yang login.
router.get('/status', PaymentController.getPaymentStatus);

// Verifikasi status pembayaran pending langsung ke gateway (tombol manual di
// halaman /upgrade — bukan polling otomatis, lihat catatan di controller).
router.post('/check', PaymentController.checkPaymentWithGateway);

module.exports = router;
