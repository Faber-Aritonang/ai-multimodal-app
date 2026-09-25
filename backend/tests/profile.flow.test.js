/**
 * Test: penyuntingan profil lewat HTTP (PUT /api/v1/member/profile).
 *
 * Yang dikunci di sini bukan hanya "berhasil menyimpan", tetapi juga batas
 * wewenang: hanya `displayName`, `bio`, dan `photoURL` yang boleh diubah user
 * sendiri. `role`, `isApproved`, `email`, dan `quota` harus tetap seperti semula
 * walau ikut dikirim — kalau tidak, siapa pun bisa menyetujui akunnya sendiri
 * atau menambah kuotanya lewat endpoint ini.
 */

process.env.JWT_SECRET = 'profile-flow-test-secret';

jest.mock('../models/User');
jest.mock('../models/Admin');

const jwt = require('jsonwebtoken');
const request = require('supertest');
const User = require('../models/User');
const { app } = require('../server');

const authHeader = (uid = 'uid-member') => ({
  Authorization: `Bearer ${jwt.sign({ uid }, process.env.JWT_SECRET)}`
});

const member = (overrides = {}) => ({
  uid: 'uid-member',
  email: 'member@example.com',
  displayName: 'Nama Lama',
  photoURL: 'https://example.com/lama.png',
  bio: '',
  role: 'member',
  isApproved: true,
  quota: { chat: 10, imageGeneration: 5, audioGeneration: 5, videoGeneration: 5 },
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides
});

const put = (body, uid = 'uid-member') =>
  request(app).put('/api/v1/member/profile').set(authHeader(uid)).send(body);

describe('PUT /api/v1/member/profile', () => {
  test('menyimpan nama tampilan, bio, dan foto', async () => {
    const user = member();
    User.findOne.mockResolvedValue(user);

    const response = await put({
      displayName: '  Nama Baru  ',
      bio: 'Suka bikin video pendek.',
      photoURL: 'https://example.com/baru.png'
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    // Nilai disimpan tanpa spasi di ujungnya.
    expect(response.body.user.displayName).toBe('Nama Baru');
    expect(response.body.user.bio).toBe('Suka bikin video pendek.');
    expect(response.body.user.photoURL).toBe('https://example.com/baru.png');
    expect(user.save).toHaveBeenCalled();
  });

  test('field wewenang admin diabaikan, bukan diterapkan', async () => {
    const user = member();
    User.findOne.mockResolvedValue(user);

    const response = await put({
      displayName: 'Nama Baru',
      role: 'admin',
      isApproved: true,
      email: 'penyerang@example.com',
      quota: { chat: 999999 }
    });

    expect(response.status).toBe(200);
    expect(user.displayName).toBe('Nama Baru');
    expect(user.role).toBe('member');
    expect(user.email).toBe('member@example.com');
    expect(user.quota.chat).toBe(10);
  });

  test('nama terlalu pendek atau kosong ditolak 400', async () => {
    const user = member();
    User.findOne.mockResolvedValue(user);

    const pendek = await put({ displayName: 'A' });
    const kosong = await put({ displayName: '   ' });

    expect(pendek.status).toBe(400);
    expect(pendek.body.message).toMatch(/between 2 and 60/);
    expect(kosong.status).toBe(400);
    expect(user.save).not.toHaveBeenCalled();
  });

  test('bio melebihi 200 karakter ditolak 400', async () => {
    User.findOne.mockResolvedValue(member());

    const response = await put({ bio: 'x'.repeat(201) });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/at most 200/);
  });

  test('photoURL dengan skema selain http(s)/data gambar ditolak 400', async () => {
    User.findOne.mockResolvedValue(member());

    const response = await put({ photoURL: 'javascript:alert(1)' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/http\(s\) URL/);
  });

  test('photoURL kosong diterima untuk menghapus foto', async () => {
    const user = member();
    User.findOne.mockResolvedValue(user);

    const response = await put({ photoURL: '' });

    expect(response.status).toBe(200);
    expect(user.photoURL).toBe('');
  });

  test('permintaan tanpa field yang bisa diubah ditolak 400', async () => {
    User.findOne.mockResolvedValue(member());

    const response = await put({});

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Nothing to update/);
  });

  test('tanpa token tetap 401', async () => {
    const response = await request(app).put('/api/v1/member/profile').send({ displayName: 'Nama Baru' });

    expect(response.status).toBe(401);
  });
});
