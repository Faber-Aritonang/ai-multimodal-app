/**
 * Test endpoint rincian user untuk admin.
 *
 * Halaman `/admin/members/:uid` membaca satu endpoint ini, jadi yang dijaga:
 * isinya lengkap (chat, media, pembayaran), total pembayaran hanya menghitung
 * transaksi berstatus `paid`, query dibatasi, dan endpoint tetap tertutup untuk
 * akun non-admin.
 */

process.env.JWT_SECRET = 'detail-test-secret';

jest.mock('../models/User');
jest.mock('../models/Admin');
// Model-model ini di-mock eksplisit: automock Jest menabrak getter internal
// Mongoose (Symbol(mongoose#Document#scope)) saat modul model-nya dibaca.
jest.mock('../models/ChatSession', () => ({
  find: jest.fn(),
  countDocuments: jest.fn()
}));
jest.mock('../models/MediaContent', () => ({
  find: jest.fn(),
  countDocuments: jest.fn()
}));
jest.mock('../models/Payment', () => ({
  find: jest.fn()
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const User = require('../models/User');
const Admin = require('../models/Admin');
const ChatSession = require('../models/ChatSession');
const MediaContent = require('../models/MediaContent');
const Payment = require('../models/Payment');
const { app } = require('../server');

const tokenFor = (uid) =>
  jwt.sign({ uid, email: `${uid}@example.com` }, process.env.JWT_SECRET);

// Model query Mongoose yang bisa dirantai .select().sort().limit().
// Method-nya jest.fn supaya test bisa memeriksa batas & bidang yang diminta.
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

const member = () => ({
  uid: 'uid-1',
  email: 'member@example.com',
  displayName: 'Member Satu',
  role: 'member',
  plan: 'paid',
  selectedPlan: 'paid',
  isApproved: true,
  referralCode: 'REF123',
  quota: { chat: 10, imageGeneration: 5, audioGeneration: 4, videoGeneration: 3 }
});

const chatSessions = () => [
  {
    sessionId: 'chat_1',
    title: 'Rencana liburan',
    provider: 'groq',
    model: 'llama',
    updatedAt: new Date('2026-09-20T09:00:00Z'),
    messages: [
      { role: 'user', content: 'Halo', timestamp: new Date('2026-09-20T08:59:00Z') },
      { role: 'assistant', content: 'Hai!', timestamp: new Date('2026-09-20T09:00:00Z') }
    ]
  }
];

const media = () => [
  {
    contentId: 'media_1',
    type: 'text-to-image',
    prompt: 'kucing astronot',
    status: 'completed',
    outputUrl: '/uploads/media_1.png',
    shareToken: 'token-rahasia',
    createdAt: new Date('2026-09-21T10:00:00Z')
  }
];

const payments = () => [
  { orderId: 'ORD-1', status: 'paid', amount: 10000, createdAt: new Date('2026-09-19T00:00:00Z') },
  { orderId: 'ORD-2', status: 'paid', amount: 25000, createdAt: new Date('2026-09-20T00:00:00Z') },
  { orderId: 'ORD-3', status: 'pending', amount: 10000, createdAt: new Date('2026-09-22T00:00:00Z') }
];

describe('GET /api/v1/admin/members/:uid', () => {
  let chatChain;
  let mediaChain;
  let paymentChain;

  beforeEach(() => {
    jest.clearAllMocks();

    chatChain = chainable(chatSessions());
    mediaChain = chainable(media());
    paymentChain = chainable(payments());

    Admin.findOne.mockResolvedValue({ uid: 'uid-admin', role: 'admin' });
    User.findOne.mockResolvedValue(member());
    ChatSession.find.mockReturnValue(chatChain);
    ChatSession.countDocuments.mockResolvedValue(7);
    MediaContent.find.mockReturnValue(mediaChain);
    MediaContent.countDocuments.mockResolvedValue(9);
    Payment.find.mockReturnValue(paymentChain);
  });

  test('mengembalikan profil, chat, media, dan pembayaran user', async () => {
    const response = await request(app)
      .get('/api/v1/admin/members/uid-1')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(response.status).toBe(200);
    expect(response.body.user.uid).toBe('uid-1');
    expect(response.body.user.plan).toBe('paid');
    expect(response.body.chatSessions).toHaveLength(1);
    expect(response.body.chatSessions[0].messages).toHaveLength(2);
    expect(response.body.media).toHaveLength(1);
    expect(response.body.payments).toHaveLength(3);

    // Hanya transaksi `paid` yang dijumlahkan: 10.000 + 25.000.
    expect(response.body.summary.totalPaid).toBe(35000);
    expect(response.body.summary.chatSessions).toBe(7);
    expect(response.body.summary.media).toBe(9);
    expect(response.body.summary.payments).toBe(3);
  });

  test('membatasi query dan tidak mengirim shareToken media', async () => {
    await request(app)
      .get('/api/v1/admin/members/uid-1')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(ChatSession.find).toHaveBeenCalledWith({ userId: 'uid-1' });
    expect(chatChain.limit).toHaveBeenCalledWith(20);

    expect(MediaContent.find).toHaveBeenCalledWith({ userId: 'uid-1' });
    expect(mediaChain.limit).toHaveBeenCalledWith(50);
    expect(mediaChain.select).toHaveBeenCalledWith('-shareToken');

    expect(Payment.find).toHaveBeenCalledWith({ uid: 'uid-1' });
    expect(paymentChain.limit).not.toHaveBeenCalled();
  });

  test('404 bila uid tidak dikenal', async () => {
    User.findOne.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/members/uid-tidak-ada')
      .set('Authorization', `Bearer ${tokenFor('uid-admin')}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  test('403 untuk akun yang bukan admin', async () => {
    Admin.findOne.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/admin/members/uid-1')
      .set('Authorization', `Bearer ${tokenFor('uid-member')}`);

    expect(response.status).toBe(403);
  });
});
