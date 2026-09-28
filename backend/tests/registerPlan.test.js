/**
 * Test: pilihan paket saat registrasi (authController.register)
 *
 * - `plan: 'paid'` tersimpan sebagai selectedPlan='paid' (paket AKTIF tetap
 *   'free' sampai pembayaran diterima — lihat paymentController)
 * - nilai selain 'paid' jatuh ke 'free'
 * - respons membawa selectedPlan supaya frontend tahu harus mengarahkan ke
 *   halaman pembayaran (/upgrade) atau pending approval
 */

jest.mock('../models/User');
jest.mock('../models/Admin');
jest.mock('../config/firebase', () => ({
  getFirebaseAdmin: () => ({
    auth: () => ({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'uid-new',
        email: 'new@example.com',
        picture: 'https://example.com/pic.png'
      })
    })
  })
}));
jest.mock('../config/ipGeo', () => ({
  lookupIp: jest.fn().mockResolvedValue(null)
}));

process.env.JWT_SECRET = 'test-secret';

const User = require('../models/User');
const { register } = require('../controllers/authController');

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const makeReq = ({ body } = {}) => ({
  body: {
    email: 'new@example.com',
    displayName: 'New User',
    firebaseToken: 'firebase-id-token',
    deviceId: 'device-abc-12345',
    ...body
  },
  ip: '103.45.67.89',
  headers: {},
  get: (header) => (header === 'user-agent' ? 'Mozilla/5.0 (Test)' : undefined)
});

const lastCreateDoc = () => User.create.mock.calls[User.create.mock.calls.length - 1][0];

beforeEach(() => {
  jest.clearAllMocks();

  User.findOne.mockResolvedValue(null);
  User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
  User.create.mockImplementation(async (doc) => ({ ...doc, referralCode: 'REFNEW01' }));
});

describe('pilihan paket saat registrasi', () => {
  test('plan "paid" tersimpan sebagai selectedPlan paid, paket aktif tetap free', async () => {
    const res = createRes();
    await register(makeReq({ body: { plan: 'paid' } }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(lastCreateDoc().selectedPlan).toBe('paid');
    // Paket AKTIF baru menjadi 'paid' setelah pembayaran diterima.
    expect(lastCreateDoc().plan).toBeUndefined();
  });

  test('plan "free" (default) tersimpan sebagai selectedPlan free', async () => {
    const res = createRes();
    await register(makeReq({ body: { plan: 'free' } }), res);

    expect(lastCreateDoc().selectedPlan).toBe('free');
  });

  test('tanpa field plan -> free', async () => {
    const res = createRes();
    await register(makeReq({ body: { plan: undefined } }), res);

    expect(lastCreateDoc().selectedPlan).toBe('free');
  });

  test('nilai plan yang tidak sah tidak membuat paket lain selain free/paid', async () => {
    const res = createRes();
    await register(makeReq({ body: { plan: 'platinum-vip' } }), res);

    expect(lastCreateDoc().selectedPlan).toBe('free');
  });

  test('respons membawa selectedPlan untuk arahan frontend (bayar vs pending)', async () => {
    const res = createRes();
    await register(makeReq({ body: { plan: 'paid' } }), res);

    const body = res.json.mock.calls[0][0];
    expect(body.user.selectedPlan).toBe('paid');
  });
});
