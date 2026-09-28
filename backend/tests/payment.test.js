/**
 * Test: controller pembayaran (paymentController.js)
 *
 * Gateway difasilitasi config/paymentGateway.js (mock di sini) — controller
 * hanya bicara ke facade itu, jadi test tidak peduli provider mana yang aktif.
 *
 * - POST /create: menolak user yang sudah paid, 503 saat gateway belum
 *   dikonfigurasi, memakai ulang transaksi pending, membuat order baru
 * - GET /status: melaporkan paket + pembayaran terakhir
 * - webhook /payment/callback: signature salah ditolak 403; pembayaran sukses
 *   mengaktifkan member paid (plan='paid', isApproved, role='member', kuota 5x)
 *   dan idempoten; expire tidak mengubah akun
 */

jest.mock('../models/User');
jest.mock('../models/Payment');
jest.mock('../config/paymentGateway');

process.env.JWT_SECRET = 'test-secret';

const User = require('../models/User');
const Payment = require('../models/Payment');
const paymentGateway = require('../config/paymentGateway');
const { quotaForPlan } = require('../config/membershipPlans');
const {
  getPlans,
  createUpgradePayment,
  getPaymentStatus,
  handlePaymentNotification
} = require('../controllers/paymentController');

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const makeUser = (overrides = {}) => ({
  uid: 'uid-1',
  email: 'user@example.com',
  displayName: 'User',
  plan: 'free',
  selectedPlan: 'paid',
  role: 'guest',
  isApproved: false,
  planActivatedAt: null,
  quota: quotaForPlan('free'),
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides
});

const makePayment = (overrides = {}) => ({
  uid: 'uid-1',
  orderId: 'PAID-1-ABC',
  plan: 'paid',
  amount: 49000,
  status: 'pending',
  paymentType: '',
  redirectUrl: 'https://pay.example/checkout',
  paidAt: null,
  createdAt: new Date(),
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides
});

// Payment.findOne kadang di-chain .sort() (create/status), kadang langsung
// di-await (webhook) — helper ini memilih bentuk yang benar per test.
const findPaymentChain = (hasil) => {
  Payment.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(hasil) });
};

const findPaymentDirect = (hasil) => {
  Payment.findOne.mockResolvedValue(hasil);
};

beforeEach(() => {
  jest.clearAllMocks();
  paymentGateway.providerName.mockReturnValue('duitku');
  paymentGateway.isConfigured.mockReturnValue(true);
  paymentGateway.getGatewayStatus.mockReturnValue({
    provider: 'duitku',
    configured: true,
    mode: 'sandbox',
    paymentMethod: 'VC'
  });
  paymentGateway.getOrderRef.mockImplementation((n) => String(n?.merchantOrderId || ''));
});

describe('GET /payment/plans', () => {
  test('mengembalikan daftar paket + info provider pembayaran', () => {
    const res = createRes();
    getPlans({}, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        plans: expect.any(Array),
        payment: expect.objectContaining({ provider: 'duitku' })
      })
    );

    const plans = res.json.mock.calls[0][0].plans;
    expect(plans.map((p) => p.id)).toEqual(['free', 'paid']);
  });
});

describe('POST /payment/create', () => {
  const req = { user: { uid: 'uid-1' } };

  test('user tidak dikenal -> 404', async () => {
    User.findOne.mockResolvedValue(null);
    const res = createRes();
    await createUpgradePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('sudah member paid -> 400, transaksi tidak dibuat', async () => {
    User.findOne.mockResolvedValue(makeUser({ plan: 'paid' }));
    const res = createRes();
    await createUpgradePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(Payment.create).not.toHaveBeenCalled();
  });

  test('gateway belum dikonfigurasi -> 503 dengan pesan yang menyebut providernya', async () => {
    User.findOne.mockResolvedValue(makeUser());
    paymentGateway.isConfigured.mockReturnValue(false);
    const res = createRes();
    await createUpgradePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].message).toMatch(/duitku/i);
  });

  test('transaksi pending yang masih baru dipakai ulang, order baru tidak dibuat', async () => {
    User.findOne.mockResolvedValue(makeUser());
    const pending = makePayment({ createdAt: new Date() });
    findPaymentChain(pending);
    const res = createRes();
    await createUpgradePayment(req, res);

    expect(Payment.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        reused: true,
        redirectUrl: 'https://pay.example/checkout'
      })
    );
  });

  test('transaksi pending yang sudah tua ditandai expired dan order baru dibuat', async () => {
    User.findOne.mockResolvedValue(makeUser());
    const tua = makePayment({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
    findPaymentChain(tua);
    paymentGateway.createPayment.mockResolvedValue({
      redirectUrl: 'https://pay.example/baru',
      reference: 'REF-BARU',
      payCode: '',
      qrUrl: ''
    });
    Payment.create.mockImplementation(async (doc) => makePayment(doc));
    const res = createRes();
    await createUpgradePayment(req, res);

    expect(tua.status).toBe('expired');
    expect(tua.save).toHaveBeenCalled();
    expect(Payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'uid-1', amount: 49000, status: 'pending' })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].redirectUrl).toBe('https://pay.example/baru');
  });

  test('gagal membuat transaksi di gateway -> 502, record tidak dibuat', async () => {
    User.findOne.mockResolvedValue(makeUser());
    findPaymentChain(null);
    paymentGateway.createPayment.mockRejectedValue(new Error('Duitku down'));
    const res = createRes();
    await createUpgradePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(Payment.create).not.toHaveBeenCalled();
  });

  test('gateway menolak karena tidak dikonfigurasi -> 503, bukan 502', async () => {
    User.findOne.mockResolvedValue(makeUser());
    findPaymentChain(null);
    const error = new Error('Pembayaran belum dikonfigurasi');
    error.code = 'PAYMENT_NOT_CONFIGURED';
    paymentGateway.createPayment.mockRejectedValue(error);
    const res = createRes();
    await createUpgradePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(Payment.create).not.toHaveBeenCalled();
  });
});

describe('GET /payment/status', () => {
  test('melaporkan paket, kuota, dan pembayaran terakhir', async () => {
    User.findOne.mockResolvedValue(makeUser({ plan: 'paid', isApproved: true }));
    findPaymentChain(makePayment({ status: 'paid', paidAt: new Date() }));
    const res = createRes();
    await getPaymentStatus({ user: { uid: 'uid-1' } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.plan).toBe('paid');
    expect(body.awaitingPayment).toBe(false);
    expect(body.latestPayment.orderId).toBe('PAID-1-ABC');
  });

  test('transaksi pending -> awaitingPayment true (dipakai tombol lanjutkan bayar)', async () => {
    User.findOne.mockResolvedValue(makeUser());
    findPaymentChain(makePayment({ status: 'pending' }));
    const res = createRes();
    await getPaymentStatus({ user: { uid: 'uid-1' } }, res);

    expect(res.json.mock.calls[0][0].awaitingPayment).toBe(true);
  });
});

describe('POST /payment/callback (webhook gateway)', () => {
  const notifikasi = (overrides = {}) => ({
    merchantOrderId: 'PAID-1-ABC',
    amount: 49000,
    resultCode: '00',
    ...overrides
  });

  test('signature salah -> 403 dan tidak ada yang diubah', async () => {
    paymentGateway.verifyNotificationSignature.mockReturnValue(false);
    const res = createRes();
    await handlePaymentNotification({ body: notifikasi() }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(Payment.findOne).not.toHaveBeenCalled();
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('order tidak dikenal -> 404', async () => {
    paymentGateway.verifyNotificationSignature.mockReturnValue(true);
    findPaymentDirect(null);
    const res = createRes();
    await handlePaymentNotification({ body: notifikasi({ merchantOrderId: 'ORDER-ANEH' }) }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('jumlah uang tidak cocok dengan tagihan -> 400', async () => {
    paymentGateway.verifyNotificationSignature.mockReturnValue(true);
    const payment = makePayment();
    findPaymentDirect(payment);
    const res = createRes();

    await handlePaymentNotification({ body: notifikasi({ amount: 1 }) }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(payment.save).not.toHaveBeenCalled();
  });

  test('pembayaran sukses -> member diaktifkan sebagai paid dengan kuota 5x', async () => {
    paymentGateway.verifyNotificationSignature.mockReturnValue(true);
    paymentGateway.mapNotificationStatus.mockReturnValue('paid');
    const payment = makePayment();
    findPaymentDirect(payment);
    const user = makeUser();
    User.findOne.mockResolvedValue(user);
    const res = createRes();

    await handlePaymentNotification({ body: notifikasi() }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(payment.status).toBe('paid');
    expect(payment.paidAt).toBeInstanceOf(Date);
    expect(user.plan).toBe('paid');
    expect(user.role).toBe('member');
    expect(user.isApproved).toBe(true);
    expect(user.quota).toEqual(quotaForPlan('paid'));
    expect(user.save).toHaveBeenCalled();
  });

  test('notifikasi sukses yang datang dua kali TIDAK mengisi ulang kuota dua kali', async () => {
    paymentGateway.verifyNotificationSignature.mockReturnValue(true);
    paymentGateway.mapNotificationStatus.mockReturnValue('paid');
    const payment = makePayment({ status: 'paid', paidAt: new Date() });
    findPaymentDirect(payment);

    // Sudah paid dari notifikasi pertama; sisa kuota sudah terpakai sebagian.
    const user = makeUser({ plan: 'paid', planActivatedAt: new Date(), quota: { ...quotaForPlan('paid'), chat: 210 } });
    User.findOne.mockResolvedValue(user);
    const res = createRes();

    await handlePaymentNotification({ body: notifikasi() }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(user.quota.chat).toBe(210);
  });

  test('kedaluwarsa -> status expired, akun TIDAK diaktifkan', async () => {
    paymentGateway.verifyNotificationSignature.mockReturnValue(true);
    paymentGateway.mapNotificationStatus.mockReturnValue('expired');
    const payment = makePayment();
    findPaymentDirect(payment);
    const res = createRes();

    await handlePaymentNotification({ body: notifikasi() }, res);

    expect(payment.status).toBe('expired');
    expect(User.findOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
