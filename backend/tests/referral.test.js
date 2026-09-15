/**
 * Test: alur referral
 * - register menyimpan kode referral (referredBy) pemilik kode yang valid
 * - kode referral tidak dikenal ditolak dengan 400
 * - statistik referral dihitung dari field referredBy, bukan referralCode sendiri
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

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { register } = require('../controllers/authController');
const { getReferralStats, getMemberByReferralCode } = require('../controllers/memberController');

process.env.JWT_SECRET = 'test-secret';

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const registerBody = {
  email: 'new@example.com',
  displayName: 'New User',
  firebaseToken: 'firebase-id-token'
};

beforeEach(() => {
  User.create.mockImplementation(async (doc) => ({
    ...doc,
    referralCode: 'REFNEW01',
    quota: { chat: 100, imageGeneration: 10, videoGeneration: 5, total: 1000 }
  }));
});

describe('register dengan kode referral', () => {
  test('menyimpan referredBy saat kode valid', async () => {
    User.findOne.mockImplementation(async (query) =>
      query.referralCode ? { referralCode: 'REFABC1' } : null
    );

    const req = { body: { ...registerBody, referralCode: 'refabc1' } };
    const res = createRes();

    await register(req, res);

    expect(User.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ referralCode: 'REFABC1', isApproved: true })
    );
    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({ referredBy: 'REFABC1' })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('menolak kode referral yang tidak dikenal', async () => {
    User.findOne.mockResolvedValue(null);

    const req = { body: { ...registerBody, referralCode: 'REFINVALID' } };
    const res = createRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Referral code not found') })
    );
    expect(User.create).not.toHaveBeenCalled();
  });

  test('referredBy null jika tidak ada kode referral', async () => {
    User.findOne.mockResolvedValue(null);

    const req = { body: registerBody };
    const res = createRes();

    await register(req, res);

    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({ referredBy: null })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('token JWT berisi uid user yang baru terdaftar', async () => {
    User.findOne.mockResolvedValue(null);

    const req = { body: registerBody };
    const res = createRes();

    await register(req, res);

    const payload = res.json.mock.calls[0][0];
    const decoded = jwt.verify(payload.token, process.env.JWT_SECRET);

    expect(decoded.uid).toBe('uid-new');
    expect(decoded.isApproved).toBe(false);
  });
});

describe('getReferralStats', () => {
  test('menghitung member yang mendaftar memakai kode referral ini', async () => {
    const referrals = [{ displayName: 'Invited One', isApproved: true }];

    User.countDocuments.mockResolvedValue(1);
    User.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          limit: () => Promise.resolve(referrals)
        })
      })
    });

    const req = {
      member: { referralCode: 'REFOWNER', quota: { chat: 5, imageGeneration: 2 } }
    };
    const res = createRes();

    await getReferralStats(req, res);

    // Penting: yang dihitung adalah referredBy (orang yang diajak),
    // bukan referralCode milik user itu sendiri.
    expect(User.countDocuments).toHaveBeenCalledWith({ referredBy: 'REFOWNER' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        referralCode: 'REFOWNER',
        totalReferrals: 1,
        referrals
      })
    );
  });
});

describe('getMemberByReferralCode', () => {
  test('mencari dengan kode yang dinormalisasi ke huruf besar', async () => {
    const member = { displayName: 'Owner', referralCode: 'REFOWNER' };

    User.findOne.mockReturnValue({
      select: () => Promise.resolve(member)
    });

    const req = { params: { referralCode: 'refowner' } };
    const res = createRes();

    await getMemberByReferralCode(req, res);

    expect(User.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ referralCode: 'REFOWNER' })
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, member });
  });

  test('mengembalikan 404 saat kode tidak ditemukan', async () => {
    User.findOne.mockReturnValue({
      select: () => Promise.resolve(null)
    });

    const req = { params: { referralCode: 'REFNONE' } };
    const res = createRes();

    await getMemberByReferralCode(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
