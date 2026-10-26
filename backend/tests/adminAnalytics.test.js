/**
 * Test ringkasan transaksi per status di GET /admin/analytics.
 *
 * Dashboard admin menampilkan jumlah dan nominal per status. Angka itu harus
 * datang dari agregasi server: daftar transaksi dibatasi 100 baris, jadi
 * menghitungnya dari daftar yang terlihat akan salah begitu transaksinya banyak.
 */

process.env.JWT_SECRET = 'analytics-test-secret';

jest.mock('../models/User');
jest.mock('../models/Admin');
// Model di-mock eksplisit: automock Jest menabrak getter internal Mongoose saat
// modul model-nya dibaca.
jest.mock('../models/MediaContent', () => ({
  countDocuments: jest.fn(),
  aggregate: jest.fn()
}));
jest.mock('../models/Payment', () => ({
  aggregate: jest.fn()
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const User = require('../models/User');
const Admin = require('../models/Admin');
const MediaContent = require('../models/MediaContent');
const Payment = require('../models/Payment');
const { app } = require('../server');

const tokenFor = (uid) =>
  jwt.sign({ uid, email: `${uid}@example.com` }, process.env.JWT_SECRET);

describe('GET /api/v1/admin/analytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Admin.findOne.mockResolvedValue({ uid: 'uid-admin', role: 'admin' });
    User.countDocuments.mockResolvedValue(10);
    MediaContent.countDocuments.mockResolvedValue(4);
    MediaContent.aggregate.mockResolvedValue([{ _id: 'text-to-image', count: 4 }]);
    Payment.aggregate.mockResolvedValue([
      { _id: 'paid', count: 2, amount: 35000 },
      { _id: 'pending', count: 1, amount: 10000 }
    ]);
  });

  test('mengirim jumlah dan nominal transaksi per status', async () => {
    const response = await request(app)
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(response.status).toBe(200);
    expect(response.body.analytics.paymentsByStatus).toEqual([
      { _id: 'paid', count: 2, amount: 35000 },
      { _id: 'pending', count: 1, amount: 10000 }
    ]);
  });

  test('agregasi mengelompokkan transaksi berdasarkan status', async () => {
    await request(app)
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(Payment.aggregate).toHaveBeenCalledWith([
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }
    ]);
  });

  test('403 untuk akun yang bukan admin', async () => {
    Admin.findOne.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${tokenFor('uid-member')}`);

    expect(response.status).toBe(403);
  });
});
