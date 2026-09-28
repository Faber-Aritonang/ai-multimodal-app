/**
 * Controller: Payment
 * Upgrade member biasa (free) ke member paid, dan aktivasi otomatis lewat
 * callback gateway pembayaran (Duitku / Tripay — pilih lewat
 * PAYMENT_PROVIDER, lihat config/paymentGateway.js).
 *
 * Alur:
 *   1. Pendaftar memilih "Member Paid" saat registrasi (atau member free
 *      menekan link upgrade di /upgrade) -> POST /payment/create membuat
 *      transaksi dan menyimpan record Payment berstatus 'pending'.
 *   2. User membayar di halaman gateway.
 *   3. Gateway memanggil POST /payment/callback. Setelah signature terverifikasi,
 *      pembayaran sukses mengaktifkan akun: plan='paid', isApproved=true,
 *      role='member', dan kuota diisi ulang penuh sesuai paket paid (5x member
 *      biasa).
 *
 * Aktivasi HANYA terjadi dari callback yang tervalidasi signature (atau
 * verifikasi status ke gateway) — tidak ada endpoint yang bisa menaikkan plan
 * sendiri dari sisi user (lihat memberController updateProfile yang mengabaikan
 * field selain data tampilan).
 */

const User = require('../models/User');
const Payment = require('../models/Payment');
const paymentGateway = require('../config/paymentGateway');
const { quotaForPlan, paidPriceIdr, describePlans } = require('../config/membershipPlans');

// Batas waktu transaksi dibuat (sama dengan expiry 60 menit yang dikirim ke
// gateway). Lewat dari ini, tombol bayar membuat order baru dan yang lama
// ditandai 'expired' — gateway tidak lagi menerima pembayaran untuk order lama.
const PAYMENT_REUSE_WINDOW_MS = 60 * 60 * 1000;

/** Bentuk Payment yang aman dikirim ke frontend (tanpa field internal). */
const publicPayment = (payment) => ({
  orderId: payment.orderId,
  plan: payment.plan,
  amount: payment.amount,
  status: payment.status,
  paymentType: payment.paymentType,
  redirectUrl: payment.redirectUrl,
  paidAt: payment.paidAt,
  createdAt: payment.createdAt
});

/**
 * URL callback untuk gateway (dipanggil gateway saat pembayaran berubah).
 * Prioritas: PAYMENT_CALLBACK_URL (URL penuh) > PUBLIC_BASE_URL + path.
 * Tanpa keduanya Tripay masih bisa memakai callback default di dashboard
 * merchant, tetapi Duitku menolak transaksi tanpa callbackUrl.
 */
const resolveCallbackUrl = () => {
  const explicit = (process.env.PAYMENT_CALLBACK_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/api/v1/payment/callback` : '';
};

/**
 * @GET /api/v1/payment/plans
 * Daftar paket + harga untuk halaman registrasi & upgrade (publik).
 * Angka kuota/harga diambil dari config/membershipPlans.js supaya frontend
 * tidak pernah menampilkan nomor yang menyimpang dari aturan server.
 */
exports.getPlans = (req, res) => {
  res.json({
    success: true,
    plans: describePlans(),
    payment: {
      provider: paymentGateway.providerName(),
      ...paymentGateway.getGatewayStatus()
    }
  });
};

/**
 * Aktifkan akun sebagai member paid. Idempoten: callback yang datang dua kali
 * (gateway sering mengulang) tidak mengisi ulang kuota dua kali.
 */
const activatePaidMember = async (uid) => {
  const user = await User.findOne({ uid });

  if (!user) return null;

  const sudahPaid = user.plan === 'paid';

  user.plan = 'paid';
  user.role = 'member';
  user.isApproved = true; // Member paid langsung aktif, tanpa antre approval admin.
  if (!user.planActivatedAt) user.planActivatedAt = new Date();

  // Kuota diisi ulang PENUH sesuai paket paid (5x member biasa). Sisa kuota
  // free yang belum terpakai ikut hangus digantikan jatah yang lebih besar.
  if (!sudahPaid) user.quota = quotaForPlan('paid');

  await user.save();
  return user;
};

/**
 * @POST /api/v1/payment/create
 * Buat transaksi pembayaran upgrade ke member paid di gateway aktif.
 */
exports.createUpgradePayment = async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.plan === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'You are already a paid member'
      });
    }

    if (!paymentGateway.isConfigured()) {
      return res.status(503).json({
        success: false,
        message:
          `Pembayaran belum dikonfigurasi: isi kredensial ${paymentGateway.providerName()} ` +
          'di backend/.env (lihat backend/.env.example) lalu coba lagi.'
      });
    }

    // Masih ada transaksi pending yang belum kedaluwarsa? Kembalikan yang itu:
    // menekan tombol bayar berkali-kali tidak boleh membuat banyak order yang
    // semuanya menunggu untuk dibayar.
    const pending = await Payment.findOne({ uid: user.uid, status: 'pending' }).sort({
      createdAt: -1
    });

    if (pending) {
      const umur = Date.now() - new Date(pending.createdAt).getTime();

      if (umur < PAYMENT_REUSE_WINDOW_MS && pending.redirectUrl) {
        return res.json({
          success: true,
          reused: true,
          payment: publicPayment(pending),
          redirectUrl: pending.redirectUrl
        });
      }

      // Lewat jendela pakai ulang: gateway tidak lagi menerima pembayaran untuk
      // order ini, jadi ditutup dan diganti yang baru.
      pending.status = 'expired';
      await pending.save();
    }

    const amount = paidPriceIdr();
    const orderId = `PAID-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // URL kembali setelah selesai membayar. Hanya untuk UI — status akhir
    // tetap dikonfirmasi lewat callback, bukan dari redirect ini.
    const frontendUrl = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
    const returnUrl = frontendUrl ? `${frontendUrl}/upgrade?status=done` : '';

    const result = await paymentGateway.createPayment({
      orderId,
      amount,
      customerName: user.displayName,
      customerEmail: user.email,
      description: 'Member Paid — kuota 5x lipat',
      returnUrl,
      callbackUrl: resolveCallbackUrl()
    });

    const payment = await Payment.create({
      uid: user.uid,
      orderId,
      plan: 'paid',
      amount,
      status: 'pending',
      provider: paymentGateway.providerName(),
      providerReference: result.reference || '',
      redirectUrl: result.redirectUrl || ''
    });

    return res.status(201).json({
      success: true,
      payment: publicPayment(payment),
      redirectUrl: result.redirectUrl
    });
  } catch (error) {
    if (error?.code === 'PAYMENT_NOT_CONFIGURED') {
      return res.status(503).json({ success: false, message: error.message });
    }

    console.error('Failed to create upgrade payment:', error);
    return res.status(502).json({
      success: false,
      message: 'Gagal membuat transaksi pembayaran. Coba lagi beberapa saat.',
      error: error.message
    });
  }
};

/**
 * @GET /api/v1/payment/status
 * Status paket & pembayaran terakhir milik user yang login.
 */
exports.getPaymentStatus = async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const latest = await Payment.findOne({ uid: user.uid }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      plan: user.plan,
      selectedPlan: user.selectedPlan,
      planActivatedAt: user.planActivatedAt,
      isApproved: user.isApproved,
      quota: user.quota,
      awaitingPayment: Boolean(latest && latest.status === 'pending'),
      latestPayment: latest ? publicPayment(latest) : null
    });
  } catch (error) {
    console.error('Failed to fetch payment status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payment status',
      error: error.message
    });
  }
};

/**
 * @POST /api/v1/payment/check
 * Verifikasi status pembayaran pending langsung ke gateway, lalu aktifkan bila
 * ternyata sudah dibayar. Dipakai tombol "cek status" di halaman /upgrade —
 * penolong saat callback belum sampai (mis. pengembangan lokal tanpa URL publik).
 *
 * TIDAK dipanggil otomatis berulang: dokumentasi Duitku melarang hit berulang
 * ke API status dan memblokir yang berlebih.
 */
exports.checkPaymentWithGateway = async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const payment = await Payment.findOne({ uid: user.uid, status: 'pending' }).sort({
      createdAt: -1
    });

    if (!payment) {
      return res.json({
        success: true,
        message: 'No pending payment to check',
        plan: user.plan,
        latestPayment: null
      });
    }

    const status = await paymentGateway.checkTransaction({
      orderId: payment.orderId,
      reference: payment.providerReference
    });

    if (status !== 'pending') {
      payment.status = status;
      if (status === 'paid' && !payment.paidAt) payment.paidAt = new Date();
      await payment.save();

      if (status === 'paid') {
        await activatePaidMember(payment.uid);
      }
    }

    const freshUser = await User.findOne({ uid: req.user.uid });

    return res.json({
      success: true,
      status,
      plan: freshUser?.plan || user.plan,
      latestPayment: publicPayment(payment)
    });
  } catch (error) {
    console.error('Failed to check payment with gateway:', error);
    return res.status(502).json({
      success: false,
      message: 'Gagal memeriksa status pembayaran di gateway. Coba lagi.',
      error: error.message
    });
  }
};

/**
 * @POST /api/v1/payment/callback
 * Callback gateway (dipanggil server gateway, tanpa auth user).
 *
 * Keaslian dibuktikan lewat signature masing-masing gateway (lihat config/
 * tripay.js / duitku.js) — tanpa kunci rahasia merchant, tidak
 * ada yang bisa membuat callback palsu yang mengaktifkan member paid. Selalu
 * dibalas 200 untuk status yang sudah diproses supaya gateway tidak mengulang
 * terus; 403 hanya untuk signature salah.
 */
exports.handlePaymentNotification = async (req, res) => {
  try {
    const notification = req.body || {};

    if (!paymentGateway.verifyNotificationSignature(notification)) {
      return res.status(403).json({
        success: false,
        message: 'Invalid notification signature'
      });
    }

    const orderRef = paymentGateway.getOrderRef(notification);
    const payment = await Payment.findOne({ orderId: orderRef });

    if (!payment) {
      // Order yang tidak kita kenal dibalas 404: lebih baik terlihat di log
      // daripada diam-diam dianggap berhasil.
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Nominal di callback harus cocok dengan yang kita tagih — pengaman kedua
    // di luar signature, untuk kasus salah konfigurasi/memoles angka.
    const amountNotifikasi = Number(notification.amount ?? notification.gross_amount);
    if (Number.isFinite(amountNotifikasi) && amountNotifikasi !== payment.amount) {
      return res.status(400).json({
        success: false,
        message: 'Amount mismatch'
      });
    }

    const nextStatus = paymentGateway.mapNotificationStatus(notification);

    payment.status = nextStatus;
    payment.paymentType = String(
      notification.payment_type || notification.paymentCode || notification.payment_method || payment.paymentType || ''
    );
    payment.lastNotificationAt = new Date();
    if (nextStatus === 'paid' && !payment.paidAt) payment.paidAt = new Date();
    await payment.save();

    if (nextStatus === 'paid') {
      const user = await activatePaidMember(payment.uid);

      if (!user) {
        console.warn(`[payment] order ${payment.orderId} paid tapi uid ${payment.uid} tidak ada`);
      }
    }

    return res.status(200).json({ success: true, status: payment.status });
  } catch (error) {
    // 500 supaya gateway mencoba lagi nanti; aktivasi bersifat idempoten.
    console.error('Payment notification failed:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process notification',
      error: error.message
    });
  }
};
