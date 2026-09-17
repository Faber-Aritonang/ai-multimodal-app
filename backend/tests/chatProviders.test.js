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
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_MODELS,
  DEFAULT_OPENROUTER_COOLDOWN_MS,
  OPENROUTER_BASE_URL,
  PROVIDERS,
  resetOpenRouterCooldowns
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
  'OPENAI_CHAT_MODEL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_CHAT_MODEL',
  'OPENROUTER_REASONING',
  'OPENROUTER_FAILURE_COOLDOWN_MS'
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

  // Jeda kegagalan disimpan di level modul, jadi harus dibersihkan antar-test
  // supaya satu test tidak mewarisi model "dijeda" dari test sebelumnya.
  resetOpenRouterCooldowns();
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

  test('daftar cadangan tidak menutup provider berkey yang tidak disebut', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_FALLBACK_PROVIDER = 'gemini';

    // Kasus nyata: operator menambah OPENROUTER_API_KEY ke platform, sementara
    // daftar cadangan lama masih `gemini`. Key baru itu tidak boleh diam.
    expect(getChatChain()).toEqual(['groq', 'gemini', 'openrouter']);
  });

  test('urutan yang ditulis operator tetap didahulukan', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_FALLBACK_PROVIDER = 'openrouter';

    expect(getChatChain()).toEqual(['groq', 'openrouter', 'gemini']);
  });

  test('CHAT_FALLBACK_PROVIDER=none tetap mematikan cadangan berkey', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_FALLBACK_PROVIDER = 'none';

    expect(getChatChain()).toEqual(['groq']);
  });

  test('OpenRouter jadi cadangan terakhir saat key-nya diisi', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';

    // Provider utama (groq) dan cadangan lama (gemini) tidak bergeser;
    // OpenRouter hanya ditambahkan di urutan terakhir.
    expect(getChatChain()).toEqual(['groq', 'gemini', 'openrouter']);
  });

  test('tanpa OPENROUTER_API_KEY, rantai cadangan tidak berubah', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';

    expect(getChatChain()).toEqual(['groq', 'gemini']);
  });

  test('cadangan eksplisit boleh berisi beberapa provider dipisah koma', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_FALLBACK_PROVIDER = 'gemini,openrouter';

    expect(getChatChain()).toEqual(['groq', 'gemini', 'openrouter']);
  });

  test('nama provider asing di dalam daftar cadangan ditolak', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.CHAT_FALLBACK_PROVIDER = 'gemini,mistral';

    expect(() => getChatChain()).toThrow('Unknown CHAT_FALLBACK_PROVIDER "mistral"');
    expect(getChatChain).toThrow(
      expect.objectContaining({ code: 'INVALID_PROVIDER_CONFIG' })
    );
  });

  test('CHAT_PROVIDER=openrouter menempatkannya sebagai provider utama', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_PROVIDER = 'openrouter';
    process.env.CHAT_FALLBACK_PROVIDER = 'groq';

    expect(getChatChain()).toEqual(['openrouter', 'groq']);
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

describe('openrouter', () => {
  test('memakai baseURL OpenRouter dan model gratis tercepat secara default', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_PROVIDER = 'openrouter';

    const result = await generateChatReply({ messages });

    expect(mockGetClient).toHaveBeenCalledWith({
      apiKey: 'sk-or-test',
      baseURL: OPENROUTER_BASE_URL,
      timeout: 90000,
      // Tanpa retry bawaan SDK: percobaan ulang ditangani dengan pindah ke model
      // berikutnya, jadi retry internal hanya menggandakan waktu tunggu.
      maxRetries: 0
    });
    expect(mockCreate).toHaveBeenCalledWith({
      model: DEFAULT_OPENROUTER_MODEL,
      messages,
      max_tokens: 2000,
      // Model ini reasoning model: tanpa ini jatah token habis untuk berpikir
      // dan `content` hanya berisi jejak berpikir, bukan jawaban.
      reasoning: { enabled: false }
    });

    expect(result.provider).toBe('openrouter');
    // Model yang dipakai adalah hasil pembandingan model `:free` (lihat
    // docs/setup-kredensial.md bagian 3c) — bukan yang paling populer.
    expect(result.model).toBe('nex-agi/nex-n2.5-mini:free');
  });

  test('OPENROUTER_REASONING=exclude menyembunyikan jejak berpikir', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_REASONING = 'exclude';
    process.env.CHAT_PROVIDER = 'openrouter';

    await generateChatReply({ messages });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { exclude: true } })
    );
  });

  test('OPENROUTER_REASONING=default tidak mengirim parameter reasoning', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_REASONING = 'default';
    process.env.CHAT_PROVIDER = 'openrouter';

    await generateChatReply({ messages });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ reasoning: expect.anything() })
    );
  });

  test('nilai OPENROUTER_REASONING yang tidak dikenal tidak mematikan chat', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_REASONING = 'terlalu-tinggi';
    process.env.CHAT_PROVIDER = 'openrouter';

    const result = await generateChatReply({ messages });

    expect(result.provider).toBe('openrouter');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ reasoning: expect.anything() })
    );
  });

  test('model default dipakai berurutan: cepat dulu, lalu dua model cadangan', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';

    expect(DEFAULT_OPENROUTER_MODELS).toEqual([
      'nex-agi/nex-n2.5-mini:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'inclusionai/ling-3.0-flash-vl:free',
      'inclusionai/ling-3.0-flash-fin:free'
    ]);
    expect(PROVIDERS.openrouter.getModels()).toEqual(DEFAULT_OPENROUTER_MODELS);
  });

  test('model terakhir dipakai setelah dua model sebelumnya gagal', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_PROVIDER = 'openrouter';

    mockCreate
      .mockRejectedValueOnce(groqError('Rate limit reached', 429))
      .mockRejectedValueOnce(groqError('Service temporarily overloaded', 503))
      .mockResolvedValueOnce(completion('Balasan dari jaring pengaman terakhir'));

    const result = await generateChatReply({ messages });

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockCreate).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ model: 'inclusionai/ling-3.0-flash-vl:free' })
    );
    expect(result.model).toBe('inclusionai/ling-3.0-flash-vl:free');
    expect(result.provider).toBe('openrouter');
  });

  test('model kedua dipakai saat model pertama kena rate limit', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_PROVIDER = 'openrouter';

    mockCreate
      .mockRejectedValueOnce(groqError('Rate limit reached', 429))
      .mockResolvedValueOnce(completion('Balasan dari model cadangan'));

    const result = await generateChatReply({ messages });

    expect(mockCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: DEFAULT_OPENROUTER_MODELS[0] })
    );
    expect(mockCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: DEFAULT_OPENROUTER_MODELS[1] })
    );
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('nvidia/nemotron-3-super-120b-a12b:free');
    expect(result.content).toBe('Balasan dari model cadangan');
  });

  test('semua model OpenRouter gagal -> error menyebut tiap model', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_PROVIDER = 'openrouter';
    process.env.CHAT_FALLBACK_PROVIDER = 'none';

    mockCreate.mockRejectedValue(groqError('upstream error', 503));

    await expect(generateChatReply({ messages })).rejects.toThrow(
      /All OpenRouter models failed \(nex-agi\/nex-n2\.5-mini:free: .*503.*nvidia\/nemotron-3-super-120b-a12b:free: /
    );
  });

  test('OPENROUTER_CHAT_MODEL boleh berisi beberapa model dipisah koma', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    // Id model dikirim apa adanya seperti ditulis operator (tidak diubah
    // huruf besar/kecilnya), karena nilainya adalah pengenal dari katalog
    // OpenRouter — beda dari env nama provider yang memang dinormalkan.
    process.env.OPENROUTER_CHAT_MODEL =
      'meta-llama/Llama-3.3-70B-Instruct:free, nex-agi/nex-n2.5-mini:free';

    expect(PROVIDERS.openrouter.getModels()).toEqual([
      'meta-llama/Llama-3.3-70B-Instruct:free',
      'nex-agi/nex-n2.5-mini:free'
    ]);
    expect(PROVIDERS.openrouter.getModel()).toBe('meta-llama/Llama-3.3-70B-Instruct:free');
  });

  test('model kembar di OPENROUTER_CHAT_MODEL dihitung sekali', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_CHAT_MODEL =
      'nex-agi/nex-n2.5-mini:free, inclusionai/ling-3.0-flash-vl:free,nex-agi/nex-n2.5-mini:free';

    // Tanpa ini, model yang sama dicoba dua kali dan kegagalannya dibayar dua
    // kali dalam satu permintaan yang sama.
    expect(PROVIDERS.openrouter.getModels()).toEqual([
      'nex-agi/nex-n2.5-mini:free',
      'inclusionai/ling-3.0-flash-vl:free'
    ]);
  });

  test('OPENROUTER_CHAT_MODEL kosong kembali ke daftar default', async () => {
    process.env.OPENROUTER_CHAT_MODEL = '';

    expect(PROVIDERS.openrouter.getModels()).toEqual(DEFAULT_OPENROUTER_MODELS);
  });

  test('model yang baru gagal tidak dicoba ulang pada request berikutnya', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_PROVIDER = 'openrouter';
    process.env.CHAT_FALLBACK_PROVIDER = 'none';

    mockCreate
      .mockRejectedValueOnce(groqError('Rate limit reached', 429))
      .mockResolvedValue(completion('Balasan model sehat'));

    const pertama = await generateChatReply({ messages });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(pertama.model).toBe(DEFAULT_OPENROUTER_MODELS[1]);

    // Request berikutnya: model pertama masih dijeda, jadi hanya satu percobaan
    // yang dibayar — inilah yang membuat kegagalan tidak terasa lama.
    mockCreate.mockClear();
    const kedua = await generateChatReply({ messages });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: DEFAULT_OPENROUTER_MODELS[1] })
    );
    expect(kedua.model).toBe(DEFAULT_OPENROUTER_MODELS[1]);
  });

  test('semua model sedang dijeda -> gagal cepat tanpa panggilan jaringan', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_PROVIDER = 'openrouter';
    process.env.CHAT_FALLBACK_PROVIDER = 'none';

    // Percobaan pertama menghabiskan semua model.
    mockCreate.mockRejectedValue(groqError('Service temporarily overloaded', 503));
    await expect(generateChatReply({ messages })).rejects.toThrow(/All OpenRouter models failed/);
    expect(mockCreate).toHaveBeenCalledTimes(DEFAULT_OPENROUTER_MODELS.length);

    // Percobaan kedua: seluruh model dijeda, jadi tidak ada request sama sekali.
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(completion('seharusnya tidak terpakai'));

    await expect(generateChatReply({ messages })).rejects.toThrow(/dijeda \d+ detik lagi/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('jeda punya batas waktu, jadi model pasti dicoba lagi', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_PROVIDER = 'openrouter';
    process.env.CHAT_FALLBACK_PROVIDER = 'none';
    process.env.OPENROUTER_FAILURE_COOLDOWN_MS = String(DEFAULT_OPENROUTER_COOLDOWN_MS);

    jest.useFakeTimers();

    try {
      mockCreate.mockRejectedValueOnce(groqError('Rate limit reached', 429));
      await generateChatReply({ messages });

      // Lewati jendela jeda: model pertama harus dicoba lagi.
      const lewatJeda = DEFAULT_OPENROUTER_COOLDOWN_MS + 1000;
      jest.setSystemTime(Date.now() + lewatJeda);

      mockCreate.mockClear();
      await generateChatReply({ messages });

      expect(mockCreate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ model: DEFAULT_OPENROUTER_MODELS[0] })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test('OPENROUTER_FAILURE_COOLDOWN_MS=0 selalu mencoba semua model', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.CHAT_PROVIDER = 'openrouter';
    process.env.CHAT_FALLBACK_PROVIDER = 'none';
    process.env.OPENROUTER_FAILURE_COOLDOWN_MS = '0';

    mockCreate.mockRejectedValue(groqError('Service temporarily overloaded', 503));

    await expect(generateChatReply({ messages })).rejects.toThrow(/All OpenRouter models failed/);
    expect(mockCreate).toHaveBeenCalledTimes(DEFAULT_OPENROUTER_MODELS.length);

    mockCreate.mockClear();
    await expect(generateChatReply({ messages })).rejects.toThrow(/All OpenRouter models failed/);
    expect(mockCreate).toHaveBeenCalledTimes(DEFAULT_OPENROUTER_MODELS.length);
  });

  test('baseURL dan model bisa dioverride lewat env', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_BASE_URL = 'https://proxy.internal/v1';
    process.env.OPENROUTER_CHAT_MODEL = 'inclusionai/ling-3.0-flash-vl:free';
    process.env.CHAT_PROVIDER = 'openrouter';

    await generateChatReply({ messages });

    expect(mockGetClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://proxy.internal/v1' })
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'inclusionai/ling-3.0-flash-vl:free' })
    );
    // Daftar berisi satu model: tidak ada model cadangan di dalam provider ini.
    expect(PROVIDERS.openrouter.getModels()).toEqual(['inclusionai/ling-3.0-flash-vl:free']);
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
      status: {
        groq: 'configured',
        gemini: 'missing',
        openai: 'missing',
        openrouter: 'missing'
      },
      defaultPrimary: 'groq'
    });
  });
});
