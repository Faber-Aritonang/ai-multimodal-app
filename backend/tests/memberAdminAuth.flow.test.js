/**
 * Test regresi: route member & admin harus bisa diakses dengan JWT yang valid.
 *
 * Sebelumnya route tersebut hanya memakai requireMember/requireAdmin tanpa
 * authenticate, sehingga req.user selalu kosong dan semua request membalas 401.
 */

process.env.JWT_SECRET = 'flow-test-secret';

jest.mock('../models/User');
jest.mock('../models/Admin');

const jwt = require('jsonwebtoken');
const request = require('supertest');
const User = require('../models/User');
const Admin = require('../models/Admin');
const { app } = require('../server');

const tokenFor = (uid) =>
  jwt.sign({ uid, email: `${uid}@example.com` }, process.env.JWT_SECRET);

// Model query Mongoose yang bisa dirantai .select().sort().limit()
const chainable = (result) => {
  const promise = Promise.resolve(result);
  const chain = {
    select: () => chain,
    sort: () => chain,
    limit: () => chain,
    then: (...args) => promise.then(...args)
  };
  return chain;
};

const approvedMember = () => ({
  uid: 'uid-member',
  role: 'member',
  isApproved: true,
  referralCode: 'REFMEMBER',
  quota: { chat: 9, imageGeneration: 4 },
  save: jest.fn().mockResolvedValue(undefined)
});

describe('route member dengan JWT valid', () => {
  test('GET /api/v1/member/profile mengembalikan profil member', async () => {
    User.findOne.mockResolvedValue(approvedMember());

    const response = await request(app)
      .get('/api/v1/member/profile')
      .set('Authorization', `Bearer ${tokenFor('uid-member')}`);

    expect(response.status).toBe(200);
    expect(response.body.user.uid).toBe('uid-member');
  });

  test('GET /api/v1/member/referral-stats mengembalikan statistik referral', async () => {
    User.findOne.mockResolvedValue(approvedMember());
    User.countDocuments.mockResolvedValue(2);
    User.find.mockReturnValue(chainable([{ displayName: 'A' }, { displayName: 'B' }]));

    const response = await request(app)
      .get('/api/v1/member/referral-stats')
      .set('Authorization', `Bearer ${tokenFor('uid-member')}`);

    expect(response.status).toBe(200);
    expect(response.body.referralCode).toBe('REFMEMBER');
    expect(response.body.totalReferrals).toBe(2);
    expect(User.countDocuments).toHaveBeenCalledWith({ referredBy: 'REFMEMBER' });
  });

  test('GET /api/v1/member/members mengembalikan daftar member', async () => {
    User.findOne.mockResolvedValue(approvedMember());
    User.find.mockReturnValue(chainable([{ displayName: 'Member A' }]));

    const response = await request(app)
      .get('/api/v1/member/members')
      .set('Authorization', `Bearer ${tokenFor('uid-member')}`);

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(1);
  });
});

describe('route admin dengan JWT valid', () => {
  test('GET /api/v1/admin/pending-members mengembalikan daftar pending', async () => {
    Admin.findOne.mockResolvedValue({ uid: 'uid-admin', role: 'admin' });
    User.find.mockReturnValue(chainable([{ uid: 'uid-pending', isApproved: false }]));

    const response = await request(app)
      .get('/api/v1/admin/pending-members')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(1);
  });

  test('GET /api/v1/admin/pending-members oleh non-admin tetap 403', async () => {
    Admin.findOne.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/pending-members')
      .set('Authorization', `Bearer ${tokenFor('uid-member')}`);

    expect(response.status).toBe(403);
  });

  test('token yang tidak valid tetap 401', async () => {
    const response = await request(app)
      .get('/api/v1/admin/pending-members')
      .set('Authorization', 'Bearer token-palsu');

    expect(response.status).toBe(401);
  });
});
