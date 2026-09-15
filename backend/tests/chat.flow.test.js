/**
 * Test: alur chat lewat HTTP (integrasi).
 *
 * Stack asli yang diuji: route -> authenticate -> requireMember -> checkQuota ->
 * chatController -> penyimpanan sesi. Hanya model MongoDB dan provider LLM yang
 * di-mock, jadi test jalan di CI tanpa kredensial.
 */

const mockReply = jest.fn();

process.env.JWT_SECRET = 'chat-flow-secret';

jest.mock('../models/User');
jest.mock('../models/Admin');
// ChatSession di-mock eksplisit: automock Jest menabrak getter internal Mongoose
// (Symbol(mongoose#Document#scope)) saat modul model-nya dibaca.
jest.mock('../models/ChatSession', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  findOneAndDelete: jest.fn()
}));
jest.mock('../config/chatProviders', () => ({
  generateChatReply: (...args) => mockReply(...args),
  getChatProviderStatus: () => ({
    chain: ['groq'],
    status: { groq: 'missing', gemini: 'missing', openai: 'missing' },
    defaultPrimary: 'groq'
  }),
  // Dipakai config/chatPersona untuk menyebutkan identitas model yang benar
  // di system prompt.
  getChatChain: () => ['groq'],
  PROVIDERS: { groq: { label: 'Groq (gratis)', getModel: () => 'openai/gpt-oss-120b' } }
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const User = require('../models/User');
const ChatSession = require('../models/ChatSession');
const { app } = require('../server');

const authHeader = () => ({
  Authorization: `Bearer ${jwt.sign({ uid: 'uid-chat' }, process.env.JWT_SECRET)}`
});

const approvedMember = (chat = 5) => ({
  uid: 'uid-chat',
  role: 'member',
  isApproved: true,
  quota: { chat, imageGeneration: 3 },
  save: jest.fn().mockResolvedValue(undefined)
});

const createSession = (overrides = {}) => ({
  sessionId: 'chat_flow',
  userId: 'uid-chat',
  title: 'New Chat',
  messages: [],
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides
});

const postMessage = (body = { message: 'halo' }) =>
  request(app)
    .post('/api/v1/member/chat/sessions/chat_flow/message')
    .set(authHeader())
    .send(body);

beforeEach(() => {
  mockReply.mockReset();
  mockReply.mockResolvedValue({
    content: 'Halo! Ada yang bisa saya bantu?',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    usage: { total_tokens: 42 },
    attempts: []
  });
});

describe('POST /api/v1/member/chat/sessions/:sessionId/message', () => {
  test('member terverifikasi mendapat balasan dan kuotanya berkurang', async () => {
    const member = approvedMember(5);
    User.findOne.mockResolvedValue(member);

    const session = createSession();
    ChatSession.findOne.mockResolvedValue(session);

    const response = await postMessage();

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.response).toBe('Halo! Ada yang bisa saya bantu?');
    expect(response.body.provider).toBe('groq');
    expect(response.body.model).toBe('openai/gpt-oss-120b');
    expect(response.body.quota.chat).toBe(4);

    // Percakapan tersimpan lengkap dan judul sesi ikut terisi. Balasan assistant
    // menyimpan provider/model-nya sendiri untuk label di UI.
    expect(session.messages).toEqual([
      { role: 'user', content: 'halo' },
      {
        role: 'assistant',
        content: 'Halo! Ada yang bisa saya bantu?',
        provider: 'groq',
        model: 'openai/gpt-oss-120b'
      }
    ]);
    expect(session.title).toBe('halo');
    // Provider & model yang benar-benar menjawab ikut tersimpan (bukan default lama 'gpt-4')
    expect(session.provider).toBe('groq');
    expect(session.model).toBe('openai/gpt-oss-120b');
    expect(session.save).toHaveBeenCalled();
    expect(member.save).toHaveBeenCalled();
  });

  test('riwayat percakapan diteruskan ke provider', async () => {
    User.findOne.mockResolvedValue(approvedMember(5));
    ChatSession.findOne.mockResolvedValue(
      createSession({
        title: 'Percakapan lama',
        messages: [
          { role: 'user', content: 'pesan pertama' },
          { role: 'assistant', content: 'balasan pertama' }
        ]
      })
    );

    await postMessage({ message: 'pesan kedua' });

    expect(mockReply).toHaveBeenCalledTimes(1);
    const { messages } = mockReply.mock.calls[0][0];

    // System prompt dikirim paling depan, tapi TIDAK ikut tersimpan ke sesi
    // (lihat assertion session.messages di test pertama).
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('openai/gpt-oss-120b');
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'pesan pertama' },
      { role: 'assistant', content: 'balasan pertama' },
      { role: 'user', content: 'pesan kedua' }
    ]);
  });

  test('provider fallback dicatat pada pesan yang ia jawab, bukan pada sesi saja', async () => {
    User.findOne.mockResolvedValue(approvedMember(5));

    // Groq gagal, Gemini yang menjawab
    const session = createSession();
    ChatSession.findOne.mockResolvedValue(session);
    mockReply.mockResolvedValue({
      content: 'Balasan dari Gemini',
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      usage: null,
      attempts: [{ provider: 'groq', reason: 'Connection error' }]
    });

    const response = await postMessage();

    expect(response.status).toBe(200);
    expect(session.provider).toBe('gemini');
    // Inilah yang dipakai UI untuk menulis "via gemini · gemini-3.8-flash"
    expect(session.messages[1]).toEqual({
      role: 'assistant',
      content: 'Balasan dari Gemini',
      provider: 'gemini',
      model: 'gemini-3.8-flash'
    });
  });

  test('system prompt menyebut kuota user yang sebenarnya', async () => {
    User.findOne.mockResolvedValue(approvedMember(5));
    ChatSession.findOne.mockResolvedValue(createSession());

    await postMessage();

    const { content } = mockReply.mock.calls[0][0].messages[0];
    expect(content).toContain('5 pesan tersisa');
    expect(content).toContain('3 gambar tersisa');
  });

  test('kuota chat habis ditolak 403 sebelum provider dipanggil', async () => {
    const member = approvedMember(0);
    User.findOne.mockResolvedValue(member);

    const response = await postMessage();

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/quota/i);
    expect(mockReply).not.toHaveBeenCalled();
    expect(member.save).not.toHaveBeenCalled();
  });

  test('sesi milik user lain tidak bisa diakses (404)', async () => {
    User.findOne.mockResolvedValue(approvedMember(5));
    ChatSession.findOne.mockResolvedValue(null);

    const response = await postMessage();

    expect(response.status).toBe(404);
    expect(mockReply).not.toHaveBeenCalled();
  });

  test('pesan kosong ditolak 400', async () => {
    User.findOne.mockResolvedValue(approvedMember(5));

    const response = await postMessage({ message: '' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/message is required/i);
    expect(mockReply).not.toHaveBeenCalled();
  });

  test('provider belum dikonfigurasi -> 503 dengan pesan yang jelas, kuota tetap', async () => {
    const member = approvedMember(5);
    User.findOne.mockResolvedValue(member);
    ChatSession.findOne.mockResolvedValue(createSession());

    const error = new Error(
      'All chat providers failed (groq: missing credentials). Set a free API key in backend/.env: GROQ_API_KEY.'
    );
    error.code = 'MISSING_CREDENTIALS';
    mockReply.mockRejectedValue(error);

    const response = await postMessage();

    expect(response.status).toBe(503);
    expect(response.body.message).toContain('GROQ_API_KEY');
    expect(response.body.quota.chat).toBe(5);
    expect(member.save).not.toHaveBeenCalled();
  });

  test('kegagalan provider -> 502 dan pesan user tetap tersimpan', async () => {
    const member = approvedMember(5);
    User.findOne.mockResolvedValue(member);

    const session = createSession();
    ChatSession.findOne.mockResolvedValue(session);

    const error = new Error('All chat providers failed (groq: Rate limit reached (HTTP 429))');
    error.code = 'PROVIDER_UNAVAILABLE';
    mockReply.mockRejectedValue(error);

    const response = await postMessage();

    expect(response.status).toBe(502);
    expect(response.body.message).toMatch(/temporarily unavailable/i);
    expect(session.messages).toEqual([{ role: 'user', content: 'halo' }]);
    expect(session.save).toHaveBeenCalled();
    expect(member.save).not.toHaveBeenCalled();
  });
});

describe('sesi chat', () => {
  test('membuat sesi baru', async () => {
    User.findOne.mockResolvedValue(approvedMember(5));
    ChatSession.create.mockResolvedValue(createSession({ sessionId: 'chat_new' }));

    const response = await request(app)
      .post('/api/v1/member/chat/sessions')
      .set(authHeader());

    expect(response.status).toBe(201);
    expect(response.body.session.sessionId).toBe('chat_new');
  });

  test('daftar sesi diurutkan dari yang terbaru', async () => {
    User.findOne.mockResolvedValue(approvedMember(5));

    const sort = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue([{ sessionId: 'chat_1' }])
    });
    ChatSession.find.mockReturnValue({ sort });

    const response = await request(app)
      .get('/api/v1/member/chat/sessions')
      .set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.sessions).toHaveLength(1);
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 });
  });
});
