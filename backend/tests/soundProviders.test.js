/**
 * Test: config/soundProviders
 *
 * Klien OpenAI SDK di-mock, jadi test tidak menembak jaringan dan bisa jalan
 * tanpa kredensial MiMo. Yang diuji di sini adalah bentuk permintaan ke provider
 * (endpoint, model, pesan, parameter `audio`) dan pembacaan balasannya.
 */

const mockCreate = jest.fn();
const mockGetClient = jest.fn();

jest.mock('../config/openai', () => ({
  getClient: (...args) => mockGetClient(...args)
}));

const {
  generateSpeech,
  getSpeechChain,
  getSpeechProviderStatus,
  measureWavDuration,
  BUILT_IN_VOICES,
  DEFAULT_TTS_MODEL,
  DEFAULT_VOICEDESIGN_MODEL,
  MIMO_BASE_URL
} = require('../config/soundProviders');

const SOUND_ENV_VARS = [
  'SOUND_PROVIDER',
  'SOUND_REQUEST_TIMEOUT_MS',
  'MIMO_API_KEY',
  'MIMO_BASE_URL',
  'MIMO_TTS_MODEL',
  'MIMO_TTS_VOICEDESIGN_MODEL',
  'MIMO_TTS_OPTIMIZE_TEXT'
];

/** WAV minimal (PCM 16-bit mono 8 kHz) supaya durasinya bisa dihitung. */
const wavBytes = (seconds = 1, sampleRate = 8000) => {
  const bytesPerSample = 2;
  const dataSize = Math.round(seconds * sampleRate) * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byteRate
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
};

const audioReply = (buffer) => ({
  choices: [{ message: { role: 'assistant', audio: { data: buffer.toString('base64') } } }]
});

const providerError = (message, status) => {
  const error = new Error(message);
  if (status) error.status = status;
  return error;
};

let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(SOUND_ENV_VARS.map((key) => [key, process.env[key]]));
  SOUND_ENV_VARS.forEach((key) => delete process.env[key]);

  mockCreate.mockReset();
  mockGetClient.mockReset();
  mockGetClient.mockReturnValue({ chat: { completions: { create: mockCreate } } });
  mockCreate.mockResolvedValue(audioReply(wavBytes(1)));
});

afterEach(() => {
  SOUND_ENV_VARS.forEach((key) => {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  });
});

describe('pemilihan provider', () => {
  test('default memakai MiMo', () => {
    expect(getSpeechChain()).toEqual(['mimo']);
  });

  test('SOUND_PROVIDER=none mematikan fitur suara', () => {
    process.env.SOUND_PROVIDER = 'none';

    expect(getSpeechChain()).toEqual([]);
  });

  test('nama provider yang tidak dikenal ditolak', () => {
    process.env.SOUND_PROVIDER = 'elevenlabs';

    expect(() => getSpeechChain()).toThrow('Unknown SOUND_PROVIDER "elevenlabs"');
    expect(getSpeechChain).toThrow(
      expect.objectContaining({ code: 'INVALID_PROVIDER_CONFIG' })
    );
  });
});

describe('mimo', () => {
  test('mengirim teks sebagai pesan assistant ke endpoint chat completions', async () => {
    process.env.MIMO_API_KEY = 'mimo-kunci-uji';

    const result = await generateSpeech({ text: 'Halo, saya siap membantu.' });

    expect(mockGetClient).toHaveBeenCalledWith({
      apiKey: 'mimo-kunci-uji',
      baseURL: MIMO_BASE_URL,
      timeout: 120000,
      // Retry bawaan SDK dimatikan: dua request berbayar untuk kegagalan yang
      // sama (mis. kredensial atau kuota) tidak menolong siapa pun.
      maxRetries: 0
    });

    expect(mockCreate).toHaveBeenCalledWith({
      model: DEFAULT_TTS_MODEL,
      messages: [{ role: 'assistant', content: 'Halo, saya siap membantu.' }],
      audio: { format: 'wav', voice: 'mimo_default' },
      stream: false
    });

    expect(result.provider).toBe('mimo');
    expect(result.model).toBe(DEFAULT_TTS_MODEL);
    expect(result.format).toBe('wav');
    expect(result.mimeType).toBe('audio/wav');
    expect(result.buffer.equals(wavBytes(1))).toBe(true);
    // Durasi dibaca dari header WAV, bukan diminta ke provider.
    expect(result.duration).toBe(1);
  });

  test('membersihkan kunci yang tercemar baris `export`', async () => {
    process.env.MIMO_API_KEY = 'mimo-bersih\nexport MIMO_API_KEY=mimo-bersih';

    await generateSpeech({ text: 'halo' });

    expect(mockGetClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'mimo-bersih' })
    );
  });

  test('voice bawaan yang dipilih diteruskan lewat parameter audio', async () => {
    process.env.MIMO_API_KEY = 'mimo-kunci-uji';

    await generateSpeech({ text: 'halo', voice: 'Mia', format: 'mp3' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ audio: { format: 'mp3', voice: 'Mia' } })
    );
  });

  test('deskripsi gaya suara memakai model voicedesign dan pesan user', async () => {
    process.env.MIMO_API_KEY = 'mimo-kunci-uji';

    const result = await generateSpeech({
      text: 'Yes, I had a sandwich.',
      style: 'Give me a young male tone.'
    });

    const [params] = mockCreate.mock.calls[0];

    expect(params.model).toBe(DEFAULT_VOICEDESIGN_MODEL);
    expect(params.messages).toEqual([
      { role: 'user', content: 'Give me a young male tone.' },
      { role: 'assistant', content: 'Yes, I had a sandwich.' }
    ]);
    // Model ini menolak field `voice` — mengirimnya membuat permintaan gagal.
    expect(params.audio).toEqual({ format: 'wav' });
    expect(result.model).toBe(DEFAULT_VOICEDESIGN_MODEL);
  });

  test('optimize_text_preview hanya dikirim saat diminta lewat env', async () => {
    process.env.MIMO_API_KEY = 'mimo-kunci-uji';
    process.env.MIMO_TTS_OPTIMIZE_TEXT = 'true';

    await generateSpeech({ text: 'halo', style: 'suara hangat' });

    // Default-nya false: teks yang diketik user diucapkan apa adanya, karena
    // teks hasil polesan membuat audio tidak sesuai dengan yang diketik.
    expect(mockCreate.mock.calls[0][0].audio).toEqual({
      format: 'wav',
      optimize_text_preview: true
    });
  });

  test('model dan base URL bisa dioverride lewat env', async () => {
    process.env.MIMO_API_KEY = 'mimo-kunci-uji';
    process.env.MIMO_BASE_URL = 'https://proxy.internal/v1';
    process.env.MIMO_TTS_MODEL = 'mimo-v2.5-tts-voiceclone';
    process.env.SOUND_REQUEST_TIMEOUT_MS = '5000';

    await generateSpeech({ text: 'halo' });

    expect(mockGetClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://proxy.internal/v1', timeout: 5000 })
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'mimo-v2.5-tts-voiceclone' })
    );
  });

  test('balasan tanpa audio gagal dengan jelas, bukan menyimpan berkas kosong', async () => {
    process.env.MIMO_API_KEY = 'mimo-kunci-uji';
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'tidak ada audio' } }] });

    await expect(generateSpeech({ text: 'halo' })).rejects.toThrow(
      /tidak mengembalikan audio/
    );
  });

  test('kredensial ditolak dibedakan dari kegagalan sesaat', async () => {
    process.env.MIMO_API_KEY = 'mimo-salah';
    mockCreate.mockRejectedValue(providerError('Unauthorized', 401));

    await expect(generateSpeech({ text: 'halo' })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_CONFIG'
    });
    await expect(generateSpeech({ text: 'halo' })).rejects.toThrow(/HTTP 401/);
  });

  test('gangguan provider dilaporkan sebagai kegagalan yang bisa dicoba ulang', async () => {
    process.env.MIMO_API_KEY = 'mimo-kunci-uji';
    mockCreate.mockRejectedValue(providerError('upstream error', 503));

    await expect(generateSpeech({ text: 'halo' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE'
    });
  });

  test('tanpa MIMO_API_KEY: tidak menembak provider, pesannya menyebut variabelnya', async () => {
    await expect(generateSpeech({ text: 'halo' })).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS'
    });
    await expect(generateSpeech({ text: 'halo' })).rejects.toThrow(/MIMO_API_KEY/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('nilai placeholder di .env.example tidak dianggap kredensial valid', async () => {
    process.env.MIMO_API_KEY = 'mimo-your-key-here';

    expect(getSpeechProviderStatus().status.mimo).toBe('missing');
  });
});

describe('measureWavDuration', () => {
  test('menghitung durasi dari byteRate dan ukuran chunk data', () => {
    expect(measureWavDuration(wavBytes(2))).toBe(2);
    expect(measureWavDuration(wavBytes(0.5))).toBe(0.5);
  });

  test('mengembalikan null untuk MP3 dan buffer yang bukan WAV', () => {
    expect(measureWavDuration(Buffer.from('ID3\x03\x00\x00'))).toBeNull();
    expect(measureWavDuration(Buffer.alloc(0))).toBeNull();
    expect(measureWavDuration(null)).toBeNull();
  });
});

describe('getSpeechProviderStatus', () => {
  test('melaporkan rantai, ketersediaan, voice, dan format', () => {
    process.env.MIMO_API_KEY = 'mimo-kunci-uji';

    expect(getSpeechProviderStatus()).toEqual({
      chain: ['mimo'],
      status: { mimo: 'configured' },
      ready: true,
      defaultPrimary: 'mimo',
      voices: BUILT_IN_VOICES,
      formats: ['wav', 'mp3']
    });
  });

  test('tanpa kredensial dilaporkan belum siap', () => {
    const status = getSpeechProviderStatus();

    expect(status.ready).toBe(false);
    expect(status.status.mimo).toBe('missing');
  });
});
