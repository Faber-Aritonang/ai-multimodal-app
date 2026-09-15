/**
 * Test: dev-login
 *
 * Fitur bantu untuk pengembangan lokal: login tanpa Firebase dengan cara
 * mencocokkan email ke database. Yang diuji:
 * - user baru dibuat sebagai member yang sudah disetujui
 * - user lama dipakai ulang (tidak diduplikasi)
 * - email admin mendapat token role 'admin'
 * - role 'guest' dipakai untuk menguji alur pending approval
 * - route TIDAK tersedia saat NODE_ENV=production (baik route maupun controller)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// server.js membaca UPLOAD_DIR saat mounting express.static
const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devlogin-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;
process.env.JWT_SECRET = 'dev-login-test-secret';

jest.mock('../models/User');
jest.mock('../models/Admin');

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admin = require('../models/Admin');
const { devLogin } = require('../controllers/authController');

const originalNodeEnv = process.env.NODE_ENV;

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const lastBody = (res) => res.json.mock.calls[0][0];

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NODE_ENV = 'test';

  // Secara default: bukan admin, dan user belum ada di database.
  Admin.findOne.mockResolvedValue(null);
  User.findOne.mockResolvedValue(null);
  User.create.mockImplementation(async (doc) => ({
    ...doc,
    photoURL: doc.photoURL || '',
    quota: { chat: 100, imageGeneration: 10, videoGeneration: 5, total: 1000 },
    save: jest.fn().mockResolvedValue(undefined)
  }));
});

afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv;
  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

describe('devLogin - user biasa', () => {
  test('membuat member yang sudah disetujui dan mengembalikan token yang valid', async () => {
    const req = { body: { email: 'Dev.Member@Example.com' } };
    const res = createRes();

    await devLogin(req, res);

    // Email dinormalisasi sebelum dipakai
    expect(User.findOne).toHaveBeenCalledWith({ email: 'dev.member@example.com' });
    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'dev.member@example.com',
        displayName: 'dev.member',
        role: 'member',
        isApproved: true
      })
    );

    const body = lastBody(res);
    expect(body.success).toBe(true);
    expect(body.user.role).toBe('member');
    expect(body.user.isApproved).toBe(true);

    const decoded = jwt.verify(body.token, process.env.JWT_SECRET);
    expect(decoded.uid).toBe('dev_dev.member@example.com');
    expect(decoded.role).toBe('member');
    expect(decoded.isApproved).toBe(true);
  });

  test('memakai ulang user yang sudah ada tanpa membuat duplikat', async () => {
    const existing = {
      uid: 'dev_lama@example.com',
      email: 'lama@example.com',
      displayName: 'Lama',
      role: 'member',
      isApproved: true,
      save: jest.fn().mockResolvedValue(undefined)
    };
    User.findOne.mockResolvedValue(existing);

    const req = { body: { email: 'lama@example.com' } };
    const res = createRes();

    await devLogin(req, res);

    expect(User.create).not.toHaveBeenCalled();
    expect(lastBody(res).user.uid).toBe('dev_lama@example.com');
  });

  test('displayName dari body dipakai saat diisi', async () => {
    const req = { body: { email: 'baru@example.com', displayName: 'Nama Pilihan' } };
    const res = createRes();

    await devLogin(req, res);

    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Nama Pilihan' })
    );
  });
});

describe('devLogin - role', () => {
  test('role guest menghasilkan akun yang belum disetujui', async () => {
    const req = { body: { email: 'pending@example.com', role: 'guest' } };
    const res = createRes();

    await devLogin(req, res);

    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'guest', isApproved: false })
    );

    const decoded = jwt.verify(lastBody(res).token, process.env.JWT_SECRET);
    expect(decoded.isApproved).toBe(false);
  });

  test('user lama ikut disesuaikan ketika role yang diminta berbeda', async () => {
    const member = {
      uid: 'dev_boss@example.com',
      email: 'boss@example.com',
      displayName: 'Boss',
      role: 'member',
      isApproved: true,
      save: jest.fn().mockResolvedValue(undefined)
    };
    User.findOne.mockResolvedValue(member);

    const res = createRes();
    await devLogin({ body: { email: 'boss@example.com', role: 'guest' } }, res);

    expect(member.role).toBe('guest');
    expect(member.isApproved).toBe(false);
    expect(member.save).toHaveBeenCalled();
  });

  test('email yang terdaftar sebagai admin mendapat token role admin', async () => {
    Admin.findOne.mockResolvedValue({
      uid: 'admin-uid-1',
      email: 'admin@example.com',
      displayName: 'Admin',
      save: jest.fn().mockResolvedValue(undefined)
    });

    const res = createRes();
    await devLogin({ body: { email: 'Admin@Example.com' } }, res);

    expect(Admin.findOne).toHaveBeenCalledWith({ email: 'admin@example.com' });
    expect(User.create).not.toHaveBeenCalled();

    const body = lastBody(res);
    expect(body.user.role).toBe('admin');
    expect(jwt.verify(body.token, process.env.JWT_SECRET).role).toBe('admin');
  });
});

describe('devLogin - validasi & keamanan', () => {
  test('email kosong ditolak 400', async () => {
    const res = createRes();

    await devLogin({ body: { email: '   ' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('body kosong tidak membuat server error', async () => {
    const res = createRes();

    await devLogin({}, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('menolak 404 saat NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';

    const res = createRes();
    await devLogin({ body: { email: 'siapapun@example.com' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(User.findOne).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });
});

describe('pemasangan route dev-login', () => {
  const originalUploadDir = process.env.UPLOAD_DIR;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.UPLOAD_DIR = originalUploadDir;
    jest.resetModules();
  });

  test('tersedia (bukan 404) di luar production', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';

    const request = require('supertest');
    const { app } = require('../server');

    // Body kosong -> 400 dari controller, artinya route benar-benar terpasang
    const response = await request(app).post('/api/v1/auth/dev-login').send({});

    expect(response.status).toBe(400);
  });

  test('benar-benar tidak dipasang saat NODE_ENV=production', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';

    const request = require('supertest');
    const { app } = require('../server');

    const response = await request(app)
      .post('/api/v1/auth/dev-login')
      .send({ email: 'siapapun@example.com' });

    expect(response.status).toBe(404);
  });
});
