/**
 * Test: config/chatProviders
 *
 * Klien OpenAI SDK di-mock, jadi test tidak menembak jaringan dan bisa jalan
 * di CI tanpa kredensial apa pun.
 */

const mockCreate = jest.fn();
const mockGetClient = jest.fn();

jest.mock('../config/openai', () => ({
  getClient: (...args) => mockGetClient(...args),
  getChatModel: () => process.env.OPENAI_CHAT_MODEL || 'gpt-3.5-turbo'
}));

const {
  generateChatReply,
  getChatChain,
  getChatProviderStatus,
  DEFAULT_GROQ_MODEL,
  DEFAULT_GEMINI_MODEL
} = require('../config/chatProviders');

const CHAT_ENV_VARS = [
  'CHAT_PROVIDER',
  'CHAT_FALLBACK_PROVIDER',
  'CHAT_MAX_TOKENS',
  'CHAT_REQUEST_TIMEOUT_MS',
  'GROQ_API_KEY',
  'GROQ_BASE_URL',
  'GROQ_CHAT_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_CHAT_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_CHAT_MODEL'
];

const completion = (content) => ({
  choices: [{ message: { content } }],
  usage: { total_tokens: 42 }
});

const groqError = (message, status) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const messages = [{ role: 'user', content: 'halo' }];

let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(CHAT_ENV_VARS.map((key) => [key, process.env[key]]));
  CHAT_ENV_VARS.forEach((key) => delete process.env[key]);

  mockCreate.mockReset();
  mockGetClient.mockReset();
  mockGetClient.mockReturnValue({ chat: { completions: { create: mockCreate } } });
  mockCreate.mockResolvedValue(completion('Halo! Ada yang bisa saya bantu?'));
});

afterEach(() => {
  CHAT_ENV_VARS.forEach((key) => {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  });
});

describe('pemilihan provider', () => {
  test('default memakai groq, provider gratis dengan prioritas tertinggi', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';

    expect(getChatChain()).toEqual(['groq', 'gemini']);
  });

  test('provider tanpa key dilewati otomatis', () => {
    process.env.GEMINI_API_KEY = 'gemini-test';

    expect(getChatChain()).toEqual(['gemini']);
  });

  test('tanpa key apa pun tetap mengembalikan groq supaya pesan errornya jelas', () => {
    expect(getChatChain()).toEqual(['groq']);
  });

  test('CHAT_PROVIDER memaksa provider utama', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.CHAT_PROVIDER = 'openai';

    expect(getChatChain()).toEqual(['openai', 'groq']);
  });

  test('CHAT_FALLBACK_PROVIDER=none mematikan fallback', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.CHAT_FALLBACK_PROVIDER = 'none';

    expect(getChatChain()).toEqual(['groq']);
  });

  test('fallback bisa diarahkan ke provider tertentu', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.CHAT_FALLBACK_PROVIDER = 'gemini';

    expect(getChatChain()).toEqual(['groq', 'gemini']);
  });

  test.each(['chatgpt', 'llama'])('nama provider tidak dikenal "%s" ditolak', (name) => {
    process.env.CHAT_PROVIDER = name;

    expect(() => getChatChain()).toThrow(`Unknown CHAT_PROVIDER "${name}"`);
    expect(getChatChain).toThrow(
      expect.objectContaining({ code: 'INVALID_PROVIDER_CONFIG' })
    );
  });
});

describe('groq', () => {
  test('memakai baseURL Groq dan parameter max_completion_tokens', async () => {
    process.env.GROQ_API_KEY = 'gsk-test';

    const result = await generateChatReply({ messages });

    expect(mockGetClient).toHaveBeenCalledWith({
      apiKey: 'gsk-test',
      baseURL: 'https://api.groq.com/openai/v1',
      timeout: 90000,
      maxRetries: 1
    });
    expect(mockCreate).toHaveBeenCalledWith({
      model: DEFAULT_GROQ_MODEL,
      messages,
      max_completion_tokens: 2000
    });

    expect(result.provider).toBe('groq');
    expect(result.model).toBe(DEFAULT_GROQ_MODEL);
    expect(result.content).toBe('Halo! Ada yang bisa saya bantu?');
    expect(result.usage).toEqual({ total_tokens: 42 });
  });

  test('membersihkan nilai key yang tercemar baris `export` (kasus ~/.bashrc)', async () => {
    // Pernah terjadi: tanda kutip yang tidak ditutup membuat dua baris ~/.bashrc
    // bergabung, sehingga nilai env berisi key + baris `export ...` lagi.
    // Nilai seperti itu ditolak fetch sebagai header tidak valid.
    process.env.GROQ_API_KEY = 'gsk-clean\nexport GROQ_API_KEY=gsk-clean';

    await generateChatReply({ messages });

    expect(mockGetClient).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'gsk-clean',
        baseURL: 'https://api.groq.com/openai/v1'
      })
    );
  });

  test('model bisa dioverride lewat env', async () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GROQ_CHAT_MODEL = 'qwen/qwen3.8-27b';

    await generateChatReply({ messages });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'qwen/qwen3.8-27b' })
    );
  });
});

describe('gemini', () => {
  test('memakai endpoint kompatibel OpenAI dan parameter max_tokens', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.CHAT_PROVIDER = 'gemini';

    const result = await generateChatReply({ messages });

    expect(mockGetClient).toHaveBeenCalledWith({
      apiKey: 'gemini-test',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      timeout: 90000,
      maxRetries: 1
    });
    expect(mockCreate).toHaveBeenCalledWith({
      model: DEFAULT_GEMINI_MODEL,
      messages,
      max_tokens: 2000
    });

    expect(result.provider).toBe('gemini');
  });
});

describe('batas token', () => {
  test('CHAT_MAX_TOKENS menimpa default', async () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.CHAT_MAX_TOKENS = '512';

    await generateChatReply({ messages });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_completion_tokens: 512 })
    );
  });

  test('argumen maxTokens menang atas env', async () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.CHAT_MAX_TOKENS = '512';

    await generateChatReply({ messages, maxTokens: 128 });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_completion_tokens: 128 })
    );
  });

  test('timeout bisa dioverride lewat CHAT_REQUEST_TIMEOUT_MS', async () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.CHAT_REQUEST_TIMEOUT_MS = '5000';

    await generateChatReply({ messages });

    expect(mockGetClient).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 5000, maxRetries: 1 })
    );
  });
});

describe('rantai fallback', () => {
  test('kegagalan provider utama otomatis dicoba ke fallback', async () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';

    mockCreate
      .mockRejectedValueOnce(groqError('Rate limit reached', 429))
      .mockResolvedValueOnce(completion('Balasan dari Gemini'));

    const result = await generateChatReply({ messages });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe('gemini');
    expect(result.content).toBe('Balasan dari Gemini');
    expect(result.attempts).toEqual([
      { provider: 'groq', reason: expect.stringContaining('429') }
    ]);
  });

  test('tanpa key sama sekali -> MISSING_CREDENTIALS, bukan panggilan jaringan', async () => {
    await expect(generateChatReply({ messages })).rejects.toThrow(
      expect.objectContaining({ code: 'MISSING_CREDENTIALS' })
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('balasan kosong dianggap gagal dan jatuh ke provider berikutnya', async () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';

    mockCreate
      .mockResolvedValueOnce(completion('   '))
      .mockResolvedValueOnce(completion('Balasan dari Gemini'));

    const result = await generateChatReply({ messages });

    expect(result.provider).toBe('gemini');
    expect(result.attempts[0].reason).toMatch(/empty reply/i);
  });

  test('semua provider gagal -> satu error berisi ringkasan percobaan', async () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';

    mockCreate.mockRejectedValue(groqError('upstream error', 503));

    await expect(generateChatReply({ messages })).rejects.toThrow(
      /groq: .*503.*gemini: /
    );
  });
});

describe('getChatProviderStatus', () => {
  test('melaporkan chain & ketersediaan tiap provider', () => {
    process.env.GROQ_API_KEY = 'gsk-test';

    expect(getChatProviderStatus()).toEqual({
      chain: ['groq'],
      status: { groq: 'configured', gemini: 'missing', openai: 'missing' },
      defaultPrimary: 'groq'
    });
  });
});
