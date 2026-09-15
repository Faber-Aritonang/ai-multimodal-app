/**
 * Test: middleware/auth.js
 * Memastikan gate approval, role, dan quota bekerja sesuai aturan.
 * Model di-mock sehingga test tidak butuh koneksi MongoDB.
 */

jest.mock('../models/User');
jest.mock('../models/Admin');

const User = require('../models/User');
const Admin = require('../models/Admin');
const {
  authenticate,
  optionalAuth,
  requireMember,
  requireAdmin,
  checkQuota
} = require('../middleware/auth');

process.env.JWT_SECRET = 'test-secret';

// Helper untuk membuat request/response Express tiruan
function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
}

describe('requireMember', () => {
  test('menolak request tanpa autentikasi', async () => {
    const req = { user: null };
    const res = createRes();
    const next = jest.fn();

    await requireMember(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('mengembalikan 404 jika user tidak ada di database', async () => {
    User.findOne.mockResolvedValue(null);

    const req = { user: { uid: 'uid-1' } };
    const res = createRes();
    const next = jest.fn();

    await requireMember(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test('menolak member yang belum di-approve admin', async () => {
    User.findOne.mockResolvedValue({
      uid: 'uid-2',
      role: 'guest',
      isApproved: false
    });

    const req = { user: { uid: 'uid-2' } };
    const res = createRes();
    const next = jest.fn();

    await requireMember(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'pending' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('menolak user yang sudah approved tapi bukan member', async () => {
    User.findOne.mockResolvedValue({
      uid: 'uid-3',
      role: 'guest',
      isApproved: true
    });

    const req = { user: { uid: 'uid-3' } };
    const res = createRes();
    const next = jest.fn();

    await requireMember(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('meloloskan member yang sudah disetujui dan mengisi req.member', async () => {
    const member = {
      uid: 'uid-4',
      role: 'member',
      isApproved: true,
      quota: { chat: 100 }
    };
    User.findOne.mockResolvedValue(member);

    const req = { user: { uid: 'uid-4' } };
    const res = createRes();
    const next = jest.fn();

    await requireMember(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.member).toBe(member);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('requireAdmin', () => {
  test('menolak user tanpa record admin', async () => {
    Admin.findOne.mockResolvedValue(null);

    const req = { user: { uid: 'uid-5' } };
    const res = createRes();
    const next = jest.fn();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('meloloskan admin terdaftar dan mengisi req.admin', async () => {
    const admin = { uid: 'uid-6', role: 'admin' };
    Admin.findOne.mockResolvedValue(admin);

    const req = { user: { uid: 'uid-6' } };
    const res = createRes();
    const next = jest.fn();

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.admin).toBe(admin);
  });
});

describe('checkQuota', () => {
  test('menolak saat quota habis', async () => {
    const req = { member: { quota: { chat: 0 } } };
    const res = createRes();
    const next = jest.fn();

    await checkQuota('chat')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('menolak saat jenis quota tidak dikenal', async () => {
    const req = { member: { quota: { chat: 10 } } };
    const res = createRes();
    const next = jest.fn();

    await checkQuota('videoGeneration')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('meloloskan saat quota masih tersedia dan mencatat sisa', async () => {
    const req = { member: { quota: { chat: 7 } } };
    const res = createRes();
    const next = jest.fn();

    await checkQuota('chat')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.quota).toEqual({ type: 'chat', remaining: 7 });
  });
});

describe('optionalAuth', () => {
  test('meneruskan request tanpa token dengan req.user null', async () => {
    const req = { headers: {} };
    const res = createRes();
    const next = jest.fn();

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeNull();
  });

  test('mengisi req.user dari JWT yang valid', async () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { uid: 'uid-7', email: 'user@example.com', role: 'member' },
      process.env.JWT_SECRET
    );

    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = createRes();
    const next = jest.fn();

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({
      uid: 'uid-7',
      email: 'user@example.com',
      role: 'member',
      iat: expect.any(Number)
    });
  });
});

describe('authenticate', () => {
  test('menolak request tanpa token', async () => {
    const req = { headers: {} };
    const res = createRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('menolak token yang tidak valid', async () => {
    const req = { headers: { authorization: 'Bearer token-palsu' } };
    const res = createRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('meloloskan token JWT yang valid', async () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ uid: 'uid-8' }, process.env.JWT_SECRET);

    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = createRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.uid).toBe('uid-8');
  });
});
