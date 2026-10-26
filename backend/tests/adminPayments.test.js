/**
 * Test endpoint daftar transaksi admin.
 *
 * Halaman `/admin/transactions` membaca endpoint ini, jadi yang dijaga: pemilik
 * transaksi ikut dikirim (agar admin tahu siapa pembelinya), filter status
 * bekerja, nilai `limit` tidak bisa dipakai untuk menarik seluruh koleksi, dan
 * `totalPaid` tetap menghitung semua transaksi `paid` walau daftarnya difilter.
 */

process.env.JWT_SECRET = 'payments-test-secret';

jest.mock('../models/User');
jest.mock('../models/Admin');
jest.mock('../models/Payment', () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn()
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const User = require('../models/User');
const Admin = require('../models/Admin');
const Payment = require('../models/Payment');
const { app } = require('../server');

const tokenFor = (uid) =>
  jwt.sign({ uid, email: `${uid}@example.com` }, process.env.JWT_SECRET);

// Rantai query Mongoose: find().sort().limit() dan find().select().
const chainable = (result) => {
  const promise = Promise.resolve(result);
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    then: (...args) => promise.then(...args)
  };
  return chain;
};

const transaksi = () => [
  {
    orderId: 'ORD-2',
    uid: 'uid-1',
    provider: 'duitku',
    amount: 25000,
    status: 'paid',
    paymentType: 'qris',
    createdAt: new Date('2026-09-20T00:00:00Z'),
    paidAt: new Date('2026-09-20T00:05:00Z')
  },
  {
    orderId: 'ORD-1',
    uid: 'uid-2',
    provider: 'duitku',
    amount: 10000,
    status: 'pending',
    createdAt: new Date('2026-09-19T00:00:00Z')
  }
];

const pengguna = () => [
  {
    uid: 'uid-1',
    displayName: 'Member Satu',
    email: 'satu@example.com',
    plan: 'paid',
    isApproved: true
  },
  {
    uid: 'uid-2',
    displayName: 'Member Dua',
    email: 'dua@example.com',
    plan: 'free',
    isApproved: false
  }
];

describe('GET /api/v1/admin/payments', () => {
  let paymentChain;
  let userChain;

  beforeEach(() => {
    jest.clearAllMocks();

    paymentChain = chainable(transaksi());
    userChain = chainable(pengguna());

    Admin.findOne.mockResolvedValue({ uid: 'uid-admin', role: 'admin' });
    Payment.find.mockReturnValue(paymentChain);
    Payment.countDocuments.mockResolvedValue(2);
    Payment.aggregate.mockResolvedValue([{ _id: null, total: 25000 }]);
    User.find.mockReturnValue(userChain);
  });

  test('mengirim transaksi beserta pemiliknya dan total pembayaran', async () => {
    const response = await request(app)
      .get('/api/v1/admin/payments')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(2);
    expect(response.body.returned).toBe(2);
    expect(response.body.totalPaid).toBe(25000);

    const pertama = response.body.payments[0];
    expect(pertama.orderId).toBe('ORD-2');
    expect(pertama.user).toEqual({
      uid: 'uid-1',
      displayName: 'Member Satu',
      email: 'satu@example.com',
      plan: 'paid',
      isApproved: true
    });

    // Satu query untuk semua pemilik transaksi, bukan satu per baris.
    expect(User.find).toHaveBeenCalledTimes(1);
    expect(User.find).toHaveBeenCalledWith({ uid: { $in: ['uid-1', 'uid-2'] } });
    expect(userChain.select).toHaveBeenCalledWith(
      'uid displayName email plan isApproved'
    );
  });

  test('memakai batas bawaan 100 transaksi', async () => {
    await request(app)
      .get('/api/v1/admin/payments')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(paymentChain.limit).toHaveBeenCalledWith(100);
    expect(Payment.find).toHaveBeenCalledWith({});
  });

  test('filter status diteruskan ke query daftar dan hitungan', async () => {
    await request(app)
      .get('/api/v1/admin/payments?status=paid')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(Payment.find).toHaveBeenCalledWith({ status: 'paid' });
    expect(Payment.countDocuments).toHaveBeenCalledWith({ status: 'paid' });

    // Filter daftar tidak boleh mengubah arti "total uang masuk".
    expect(Payment.aggregate).toHaveBeenCalledWith([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
  });

  test('status tak dikenal diabaikan dan limit dibatasi 200', async () => {
    const response = await request(app)
      .get('/api/v1/admin/payments?status=entah&limit=500')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(response.status).toBe(200);
    expect(Payment.find).toHaveBeenCalledWith({});
    expect(response.body.limit).toBe(200);
    expect(paymentChain.limit).toHaveBeenCalledWith(200);
  });

  test('pencarian user menyaring transaksi lewat uid pemiliknya', async () => {
    const searchChain = chainable([{ uid: 'uid-1' }]);
    User.find.mockReturnValueOnce(searchChain);

    const response = await request(app)
      .get('/api/v1/admin/payments?q=satu')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(response.status).toBe(200);
    expect(searchChain.select).toHaveBeenCalledWith('uid');
    expect(Payment.find).toHaveBeenCalledWith({ uid: { $in: ['uid-1'] } });
    expect(Payment.countDocuments).toHaveBeenCalledWith({ uid: { $in: ['uid-1'] } });

    // Nama dan email dicari sekaligus, tanpa membedakan huruf besar/kecil.
    const filterPencarian = User.find.mock.calls[0][0];
    const pola = filterPencarian.$or[0].displayName;
    expect(pola.test('satu')).toBe(true);
    expect(pola.test('SATU')).toBe(true);
  });

  test('pencarian dan filter status dipakai bersamaan', async () => {
    User.find.mockReturnValueOnce(chainable([{ uid: 'uid-2' }]));

    await request(app)
      .get('/api/v1/admin/payments?q=dua&status=pending')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(Payment.find).toHaveBeenCalledWith({
      status: 'pending',
      uid: { $in: ['uid-2'] }
    });
  });

  test('karakter regex pada kata kunci diperlakukan sebagai teks biasa', async () => {
    User.find.mockReturnValueOnce(chainable([]));

    await request(app)
      .get('/api/v1/admin/payments?q=a%2Bb')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    const pola = User.find.mock.calls[0][0].$or[0].displayName;
    expect(pola.test('a+b')).toBe(true);
    expect(pola.test('aab')).toBe(false);
  });

  test('pencarian tanpa hasil mengembalikan daftar kosong', async () => {
    User.find.mockReturnValueOnce(chainable([]));
    Payment.find.mockReturnValue(chainable([]));
    Payment.countDocuments.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/v1/admin/payments?q=tidak-ada')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(response.status).toBe(200);
    expect(response.body.payments).toEqual([]);
    expect(response.body.count).toBe(0);
    expect(Payment.find).toHaveBeenCalledWith({ uid: { $in: [] } });
    // Tidak ada transaksi, jadi pemilik tidak perlu diambil lagi.
    expect(User.find).toHaveBeenCalledTimes(1);
  });

  test('403 untuk akun yang bukan admin', async () => {
    Admin.findOne.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/payments')
      .set('Authorization', `Bearer ${tokenFor('uid-member')}`);

    expect(response.status).toBe(403);
  });
});
