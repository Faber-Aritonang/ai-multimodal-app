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
  const res = { statusCode: 200 };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
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
  beforeEach(() => {
    User.findOneAndUpdate.mockReset();
  });

  test('menolak saat quota habis tanpa menyentuh database', async () => {
    const req = { member: { uid: 'uid-q', quota: { chat: 0 } } };
    const res = createRes();
    const next = jest.fn();

    await checkQuota('chat')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    // Gerbang cepat: permintaan yang pasti ditolak tidak perlu satu tulisan DB.
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('menolak saat jenis quota tidak dikenal', async () => {
    const req = { member: { uid: 'uid-q', quota: { chat: 10 } } };
    const res = createRes();
    const next = jest.fn();

    await checkQuota('videoGeneration')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('mereservasi jatah secara atomik sebelum handler berjalan', async () => {
    User.findOneAndUpdate.mockResolvedValue({ quota: { chat: 6 } });

    const req = { member: { uid: 'uid-q', quota: { chat: 7 } } };
    const res = createRes();
    const next = jest.fn();

    await checkQuota('chat')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { uid: 'uid-q', 'quota.chat': { $gte: 1 } },
      { $inc: { 'quota.chat': -1 } },
      { new: true }
    );
    expect(req.quota).toEqual({
      type: 'chat',
      key: 'chat',
      quota: { chat: 6 },
      remaining: 6
    });
  });

  test('kalah balapan reservasi dijawab 403, bukan diloloskan', async () => {
    // Sisa 1 menurut requireMember, tetapi permintaan lain sudah mengambilnya
    // lebih dulu — itulah kasus yang dulu membuat kuota minus / pekerjaan gratis.
    User.findOneAndUpdate.mockResolvedValue(null);

    const req = { member: { uid: 'uid-q', quota: { chat: 1 } } };
    const res = createRes();
    const next = jest.fn();

    await checkQuota('chat')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('mengembalikan jatah sebelum respons gagal dikirim', async () => {
    User.findOneAndUpdate
      .mockResolvedValueOnce({ quota: { chat: 6 } })
      .mockResolvedValueOnce({ quota: { chat: 7 } });

    const req = { member: { uid: 'uid-q', quota: { chat: 7 } } };
    const res = createRes();
    const next = jest.fn();

    // Middleware membungkus res.json, jadi mock aslinya disimpan dulu.
    const kirimJson = res.json;

    await checkQuota('chat')(req, res, next);

    // Handler gagal (mis. provider 502): respons dikirim lewat res.json.
    await res.status(502).json({ success: false });

    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(User.findOneAndUpdate.mock.calls[1]).toEqual([
      { uid: 'uid-q' },
      { $inc: { 'quota.chat': 1 } },
      { new: true }
    ]);
    // Respons tetap terkirim, setelah pengembalian selesai.
    expect(kirimJson).toHaveBeenCalledWith({ success: false });
  });

  test('kegagalan mengembalikan jatah tidak menahan respons gagal', async () => {
    User.findOneAndUpdate
      .mockResolvedValueOnce({ quota: { chat: 6 } })
      .mockRejectedValueOnce(new Error('db down'));

    // Logger menulis ke stderr; dibisukan supaya output test tetap bersih.
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const req = { member: { uid: 'uid-q', quota: { chat: 7 } } };
    const res = createRes();
    const next = jest.fn();
    const kirimJson = res.json;

    await checkQuota('chat')(req, res, next);
    await res.status(502).json({ success: false });

    // Kuota bisa hilang kalau pengembaliannya gagal, tetapi user tetap
    // menerima respons galatnya — bukan request yang menggantung.
    expect(kirimJson).toHaveBeenCalledWith({ success: false });

    stderr.mockRestore();
  });

  test('respons sukses tidak mengembalikan jatah', async () => {
    User.findOneAndUpdate.mockResolvedValue({ quota: { chat: 6 } });

    const req = { member: { uid: 'uid-q', quota: { chat: 7 } } };
    const res = createRes();
    const next = jest.fn();
    const kirimJson = res.json;

    await checkQuota('chat')(req, res, next);
    await res.json({ success: true });

    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(kirimJson).toHaveBeenCalledWith({ success: true });
  });

  // Akun yang dibuat sebelum kuota audio dipisahkan tidak punya
  // `audioGeneration`. Tanpa cadangan ini, seluruh fitur suara akan terjawab 403
  // untuk member yang jatahnya sebenarnya masih ada.
  test('akun lama tanpa audioGeneration memakai sisa videoGeneration', async () => {
    User.findOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ quota: { chat: 10, videoGeneration: 2 } });

    const req = { member: { uid: 'uid-q', quota: { chat: 10, videoGeneration: 3 } } };
    const res = createRes();
    const next = jest.fn();

    await checkQuota('audioGeneration')(req, res, next);

    expect(next).toHaveBeenCalled();
    // Yang dipotong adalah videoGeneration, dan `key` itulah yang akan dipakai
    // saat pengembalian kalau permintaannya gagal.
    expect(req.quota).toEqual({
      type: 'audioGeneration',
      key: 'videoGeneration',
      quota: { chat: 10, videoGeneration: 2 },
      remaining: 2
    });
  });

  test('audioGeneration 0 tetap menolak walau videoGeneration masih ada', async () => {
    const req = { member: { uid: 'uid-q', quota: { videoGeneration: 9, audioGeneration: 0 } } };
    const res = createRes();
    const next = jest.fn();

    await checkQuota('audioGeneration')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
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
