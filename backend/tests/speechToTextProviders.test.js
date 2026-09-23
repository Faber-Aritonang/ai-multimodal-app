/**
 * Test: config/speechToTextProviders
 *
 * Klien OpenAI SDK dan `fetch` (dipakai Gemini) di-mock, jadi test tidak
 * menembak jaringan dan bisa jalan tanpa kredensial provider mana pun. Yang
 * diuji adalah bentuk permintaan ke tiap provider, pembacaan balasannya, dan
 * pemilihan rantai providernya.
 */

const mockTranscriptionsCreate = jest.fn();
const mockGetClient = jest.fn();
const mockFetch = jest.fn();
const fetchAsli = global.fetch;

jest.mock('../config/openai', () => ({
  getClient: (...args) => mockGetClient(...args)
}));

const {
  transcribeAudio,
  getSpeechToTextChain,
  getSpeechToTextStatus,
  getTranscribeOptions,
  detectAudioFormat,
  mimeTypeFor,
  ALLOWED_AUDIO_FORMATS,
  SUPPORTED_FORMATS_BY_PROVIDER,
  DEFAULT_GROQ_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  GROQ_BASE_URL,
  PROVIDERS,
  PROVIDER_ORDER
} = require('../config/speechToTextProviders');

const STT_ENV_VARS = [
  'STT_PROVIDER',
  'STT_FALLBACK_PROVIDER',
  'STT_REQUEST_TIMEOUT_MS',
  'STT_DEFAULT_LANGUAGE',
  'GROQ_API_KEY',
  'GROQ_BASE_URL',
  'GROQ_TRANSCRIBE_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_TRANSCRIBE_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_TRANSCRIBE_MODEL'
];

/** WAV minimal (header saja cukup untuk deteksi format). */
const wavBytes = () => {
  const buffer = Buffer.alloc(64);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(56, 4);
  buffer.write('WAVE', 8, 'ascii');
  return buffer;
};

const mp3Bytes = () => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(32, 1)]);
const webmBytes = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32, 2)]);

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

const geminiTextReply = (text) => ({
  candidates: [{ content: { parts: [{ text }] } }]
});

const bodyDipanggil = (n = 0) => JSON.parse(mockFetch.mock.calls[n][1].body);

let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(STT_ENV_VARS.map((key) => [key, process.env[key]]));
  STT_ENV_VARS.forEach((key) => delete process.env[key]);

  mockTranscriptionsCreate.mockReset();
  mockGetClient.mockReset();
  mockGetClient.mockReturnValue({
    audio: { transcriptions: { create: mockTranscriptionsCreate } }
  });
  mockTranscriptionsCreate.mockResolvedValue({ text: 'Selamat pagi, ini transkripnya.' });

  mockFetch.mockReset();
  global.fetch = mockFetch;
  mockFetch.mockResolvedValue(jsonResponse(geminiTextReply('Selamat pagi.')));
});

afterEach(() => {
  global.fetch = fetchAsli;

  STT_ENV_VARS.forEach((key) => {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  });
});

describe('pemilihan provider', () => {
  test('tanpa kredensial: Groq utama dan Gemini cadangan (keduanya gratis)', () => {
    expect(getSpeechToTextChain()).toEqual(['groq', 'gemini']);
  });

  test('kunci Groq membuat Groq yang melayani lebih dulu', () => {
    process.env.GROQ_API_KEY = 'gsk-uji';

    expect(getSpeechToTextChain()).toEqual(['groq', 'gemini']);
  });

  test('hanya kunci Gemini: Gemini dipakai, tanpa duplikat di rantai', () => {
    process.env.GEMINI_API_KEY = 'gemini-uji';

    // Cadangan defaultnya Gemini juga, jadi namanya tidak muncul dua kali.
    expect(getSpeechToTextChain()).toEqual(['gemini']);
  });

  test('provider gratis menahan provider berbayar di belakangnya', () => {
    process.env.GROQ_API_KEY = 'gsk-uji';
    process.env.OPENAI_API_KEY = 'sk-uji';

    // OpenAI tidak pernah masuk rantai selama provider gratis punya kunci.
    expect(getSpeechToTextChain()).toEqual(['groq', 'gemini']);
    expect(getSpeechToTextChain()).not.toContain('openai');
  });

  test('provider berbayar baru dipakai kalau tidak ada provider gratis ber-kunci', () => {
    process.env.OPENAI_API_KEY = 'sk-uji';

    expect(getSpeechToTextChain()).toEqual(['openai', 'gemini']);
  });

  test('STT_PROVIDER=openai memaksa provider berbayar, dan itu disengaja', () => {
    process.env.OPENAI_API_KEY = 'sk-uji';
    process.env.STT_PROVIDER = 'openai';

    expect(getSpeechToTextChain()).toEqual(['openai', 'gemini']);
  });

  test('STT_PROVIDER=none mematikan fitur', () => {
    process.env.STT_PROVIDER = 'none';

    expect(getSpeechToTextChain()).toEqual([]);
  });

  test('STT_FALLBACK_PROVIDER=none mematikan cadangan', () => {
    process.env.STT_FALLBACK_PROVIDER = 'none';

    expect(getSpeechToTextChain()).toEqual(['groq']);
  });

  test('nama provider yang tidak dikenal ditolak, bukan diabaikan diam-diam', () => {
    process.env.STT_PROVIDER = 'whisperx';

    expect(() => getSpeechToTextChain()).toThrow('Unknown STT_PROVIDER');
    expect(getSpeechToTextChain).toThrow(
      expect.objectContaining({ code: 'INVALID_PROVIDER_CONFIG' })
    );
  });

  test('cadangan yang tidak dikenal ditolak', () => {
    process.env.STT_FALLBACK_PROVIDER = 'deepgram';

    expect(() => getSpeechToTextChain()).toThrow('Unknown STT_FALLBACK_PROVIDER');
  });

  test('placeholder .env.example tidak dianggap kredensial valid', () => {
    process.env.GROQ_API_KEY = 'gsk-your-groq-key-here';

    expect(getSpeechToTextStatus().status.groq).toBe('missing');
  });

  test('urutan provider dan format yang didukung tiap provider tercatat apa adanya', () => {
    expect(PROVIDER_ORDER).toEqual(['groq', 'gemini', 'openai']);
    // Gemini TIDAK menerima WebM — inilah yang membuat rekaman browser harus
    // dikonversi ke WAV sebelum dikirim, atau dilayani provider lain.
    expect(SUPPORTED_FORMATS_BY_PROVIDER.gemini).not.toContain('webm');
    expect(SUPPORTED_FORMATS_BY_PROVIDER.groq).toContain('webm');
    expect(SUPPORTED_FORMATS_BY_PROVIDER.openai).toContain('wav');
  });
});

describe('detectAudioFormat', () => {
  test('mengenali format dari magic bytes-nya', () => {
    expect(detectAudioFormat(wavBytes())).toBe('wav');
    expect(detectAudioFormat(mp3Bytes())).toBe('mp3');
    expect(detectAudioFormat(webmBytes())).toBe('webm');

    const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32)]);
    const flac = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(32)]);
    const m4a = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(32)]);
    // MP3 tanpa tag ID3: frame sync 0xFFE0.
    const mp3Sync = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(32)]);

    expect(detectAudioFormat(ogg)).toBe('ogg');
    expect(detectAudioFormat(flac)).toBe('flac');
    expect(detectAudioFormat(m4a)).toBe('m4a');
    expect(detectAudioFormat(mp3Sync)).toBe('mp3');
  });

  test('mengembalikan null untuk yang bukan audio', () => {
    // PNG — gambar yang sengaja dikirim ke endpoint audio.
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32)]);

    expect(detectAudioFormat(png)).toBeNull();
    expect(detectAudioFormat(Buffer.from('halo'))).toBeNull();
    expect(detectAudioFormat(null)).toBeNull();
  });

  test('mime type mengikuti format yang dikenali', () => {
    expect(mimeTypeFor('wav')).toBe('audio/wav');
    expect(mimeTypeFor('mp3')).toBe('audio/mpeg');
    expect(mimeTypeFor('tidak-ada')).toBe('application/octet-stream');
    expect(ALLOWED_AUDIO_FORMATS).toContain('webm');
  });
});

describe('groq', () => {
  test('memakai whisper-large-v3 dan mengirim bahasa yang diminta', async () => {
    process.env.GROQ_API_KEY = 'gsk-uji';

    const result = await transcribeAudio({
      buffer: wavBytes(),
      format: 'wav',
      mimeType: 'audio/wav',
      language: 'id'
    });

    expect(mockGetClient).toHaveBeenCalledWith({
      apiKey: 'gsk-uji',
      baseURL: GROQ_BASE_URL,
      timeout: 120000,
      maxRetries: 0
    });

    const params = mockTranscriptionsCreate.mock.calls[0][0];

    expect(params.model).toBe(DEFAULT_GROQ_MODEL);
    expect(params.language).toBe('id');
    // Berkasnya dikirim dari buffer, tanpa berkas sementara di disk.
    expect(params.file.name).toBe('audio.wav');
    expect(typeof params.file.arrayBuffer).toBe('function');
    expect(result.provider).toBe('groq');
    expect(result.text).toBe('Selamat pagi, ini transkripnya.');
    expect(result.language).toBe('id');
  });

  test('bahasa `auto` berarti parameternya tidak dikirim sama sekali', async () => {
    process.env.GROQ_API_KEY = 'gsk-uji';

    const result = await transcribeAudio({
      buffer: wavBytes(),
      format: 'wav',
      mimeType: 'audio/wav',
      language: 'auto'
    });

    expect(mockTranscriptionsCreate.mock.calls[0][0]).not.toHaveProperty('language');
    expect(result.language).toBeNull();
  });

  test('prompt tambahan ikut dikirim untuk membantu akurasi', async () => {
    process.env.GROQ_API_KEY = 'gsk-uji';

    await transcribeAudio({
      buffer: wavBytes(),
      format: 'wav',
      mimeType: 'audio/wav',
      language: 'id',
      prompt: 'istilah: neural network'
    });

    expect(mockTranscriptionsCreate.mock.calls[0][0].prompt).toBe('istilah: neural network');
  });

  test('kunci yang ditolak dibedakan dari gangguan sesaat', async () => {
    process.env.GROQ_API_KEY = 'gsk-salah';

    const unauthorized = new Error('Unauthorized');
    unauthorized.status = 401;
    mockTranscriptionsCreate.mockRejectedValue(unauthorized);

    await expect(
      transcribeAudio({ buffer: wavBytes(), format: 'wav', mimeType: 'audio/wav', language: 'id' })
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_CONFIG' });
  });

  test('gangguan server bisa dicoba ulang (cadangan yang menanganinya)', async () => {
    process.env.GROQ_API_KEY = 'gsk-uji';
    process.env.GEMINI_API_KEY = 'gemini-uji';

    const gangguan = new Error('upstream error');
    gangguan.status = 503;
    mockTranscriptionsCreate.mockRejectedValue(gangguan);

    const result = await transcribeAudio({
      buffer: wavBytes(),
      format: 'wav',
      mimeType: 'audio/wav',
      language: 'id'
    });

    expect(result.provider).toBe('gemini');
    expect(result.attempts).toEqual([
      { provider: 'groq', reason: expect.stringContaining('HTTP 503') }
    ]);
  });

  test('balasan tanpa teks gagal jelas, bukan disimpan sebagai transkrip kosong', async () => {
    process.env.GROQ_API_KEY = 'gsk-uji';
    process.env.STT_FALLBACK_PROVIDER = 'none';
    mockTranscriptionsCreate.mockResolvedValue({ text: '   ' });

    await expect(
      transcribeAudio({ buffer: wavBytes(), format: 'wav', mimeType: 'audio/wav', language: 'id' })
    ).rejects.toThrow(/tidak mengembalikan teks/);
  });
});

describe('openai', () => {
  test('memakai Whisper dan kredensialnya sendiri, tanpa baseURL khusus', async () => {
    process.env.OPENAI_API_KEY = 'sk-uji';
    process.env.STT_PROVIDER = 'openai';

    const result = await transcribeAudio({
      buffer: mp3Bytes(),
      format: 'mp3',
      mimeType: 'audio/mpeg',
      language: 'en'
    });

    expect(mockGetClient).toHaveBeenCalledWith({
      apiKey: 'sk-uji',
      timeout: 120000,
      maxRetries: 0
    });
    expect(mockTranscriptionsCreate.mock.calls[0][0].model).toBe(DEFAULT_OPENAI_MODEL);
    expect(result.provider).toBe('openai');
  });

  test('model bisa diganti lewat env', async () => {
    process.env.OPENAI_API_KEY = 'sk-uji';
    process.env.STT_PROVIDER = 'openai';
    process.env.OPENAI_TRANSCRIBE_MODEL = 'gpt-4o-transcribe';

    const result = await transcribeAudio({
      buffer: mp3Bytes(),
      format: 'mp3',
      mimeType: 'audio/mpeg',
      language: 'id'
    });

    expect(mockTranscriptionsCreate.mock.calls[0][0].model).toBe('gpt-4o-transcribe');
    expect(result.model).toBe('gpt-4o-transcribe');
    expect(PROVIDERS.openai.getModel()).toBe('gpt-4o-transcribe');
  });
});

describe('gemini', () => {
  test('mengirim audio inline sebagai base64 ke generateContent', async () => {
    process.env.GEMINI_API_KEY = 'gemini-uji';
    process.env.STT_PROVIDER = 'gemini';

    const result = await transcribeAudio({
      buffer: wavBytes(),
      format: 'wav',
      mimeType: 'audio/wav',
      language: 'id'
    });

    expect(String(mockFetch.mock.calls[0][0])).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`
    );
    expect(mockFetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('gemini-uji');

    const parts = bodyDipanggil().contents[0].parts;

    expect(parts[0].text).toMatch(/bahasa Indonesia/i);
    expect(parts[1].inlineData.mimeType).toBe('audio/wav');
    expect(parts[1].inlineData.data).toBe(wavBytes().toString('base64'));
    expect(result.provider).toBe('gemini');
    expect(result.text).toBe('Selamat pagi.');
  });

  test('bahasa auto meminta provider mendeteksi sendiri', async () => {
    process.env.GEMINI_API_KEY = 'gemini-uji';
    process.env.STT_PROVIDER = 'gemini';

    const result = await transcribeAudio({
      buffer: wavBytes(),
      format: 'wav',
      mimeType: 'audio/wav',
      language: 'auto'
    });

    expect(bodyDipanggil().contents[0].parts[0].text).toMatch(/deteksi bahasanya/i);
    expect(result.language).toBeNull();
  });

  test('prompt tambahan masuk sebagai konteks di dalam permintaan', async () => {
    process.env.GEMINI_API_KEY = 'gemini-uji';
    process.env.STT_PROVIDER = 'gemini';

    await transcribeAudio({
      buffer: wavBytes(),
      format: 'wav',
      mimeType: 'audio/wav',
      language: 'id',
      prompt: 'nama: Aritonang'
    });

    expect(bodyDipanggil().contents[0].parts[0].text).toContain('nama: Aritonang');
  });

  test('kuota habis (429) dibedakan dari kunci yang ditolak', async () => {
    process.env.GEMINI_API_KEY = 'gemini-uji';
    process.env.STT_PROVIDER = 'gemini';
    process.env.STT_FALLBACK_PROVIDER = 'none';
    mockFetch.mockResolvedValue(jsonResponse({ error: { message: 'Quota exceeded' } }, 429));

    await expect(
      transcribeAudio({ buffer: wavBytes(), format: 'wav', mimeType: 'audio/wav', language: 'id' })
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

    mockFetch.mockResolvedValue(jsonResponse({ error: { message: 'nope' } }, 401));

    await expect(
      transcribeAudio({ buffer: wavBytes(), format: 'wav', mimeType: 'audio/wav', language: 'id' })
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_CONFIG' });
  });

  test('balasan tanpa teks menyebut kunci yang benar-benar diterima', async () => {
    process.env.GEMINI_API_KEY = 'gemini-uji';
    process.env.STT_PROVIDER = 'gemini';
    process.env.STT_FALLBACK_PROVIDER = 'none';
    mockFetch.mockResolvedValue(jsonResponse({ candidates: [], catatan: 'kosong' }));

    await expect(
      transcribeAudio({ buffer: wavBytes(), format: 'wav', mimeType: 'audio/wav', language: 'id' })
    ).rejects.toThrow(/tidak mengembalikan teks.*candidates/m);
  });
});

describe('format yang tidak didukung', () => {
  test('provider dilewati sebelum dipanggil kalau formatnya tidak dibacanya', async () => {
    process.env.GEMINI_API_KEY = 'gemini-uji';
    process.env.STT_PROVIDER = 'gemini';
    process.env.STT_FALLBACK_PROVIDER = 'none';

    // WebM (format paling umum dari MediaRecorder) tidak didukung Gemini.
    await expect(
      transcribeAudio({ buffer: webmBytes(), format: 'webm', mimeType: 'audio/webm', language: 'id' })
    ).rejects.toThrow(/format webm is not supported/);

    // Tidak ada permintaan yang dikirim: provider yang tidak sanggup membaca
    // formatnya tidak boleh membuang kuota.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('rekaman WebM tetap dilayani Groq karena providernya sanggup membacanya', async () => {
    process.env.GROQ_API_KEY = 'gsk-uji';

    const result = await transcribeAudio({
      buffer: webmBytes(),
      format: 'webm',
      mimeType: 'audio/webm',
      language: 'id'
    });

    expect(result.provider).toBe('groq');
  });
});

describe('tanpa kredensial sama sekali', () => {
  test('pesannya menyebut variabel yang harus diisi', async () => {
    await expect(
      transcribeAudio({ buffer: wavBytes(), format: 'wav', mimeType: 'audio/wav', language: 'id' })
    ).rejects.toMatchObject({ code: 'MISSING_CREDENTIALS' });

    await expect(
      transcribeAudio({ buffer: wavBytes(), format: 'wav', mimeType: 'audio/wav', language: 'id' })
    ).rejects.toThrow(/GROQ_API_KEY.*GEMINI_API_KEY/s);
  });

  test('STT_PROVIDER=none juga berakhir sebagai MISSING_CREDENTIALS', async () => {
    process.env.STT_PROVIDER = 'none';

    await expect(
      transcribeAudio({ buffer: wavBytes(), format: 'wav', mimeType: 'audio/wav', language: 'id' })
    ).rejects.toMatchObject({ code: 'MISSING_CREDENTIALS' });
  });
});

describe('getSpeechToTextStatus & getTranscribeOptions', () => {
  test('status melaporkan rantai, kesiapan, dan model tiap provider', () => {
    process.env.GROQ_API_KEY = 'gsk-uji';

    const status = getSpeechToTextStatus();

    expect(status.chain).toEqual(['groq', 'gemini']);
    expect(status.ready).toBe(true);
    expect(status.defaultPrimary).toBe('groq');
    expect(status.status).toEqual({
      groq: 'configured',
      gemini: 'missing',
      openai: 'missing'
    });
    expect(status.models.groq).toBe(DEFAULT_GROQ_MODEL);
  });

  test('belum siap bila tidak ada kredensial, dan itu terlihat dari status', () => {
    const status = getSpeechToTextStatus();

    expect(status.ready).toBe(false);
    expect(status.chain).toEqual(['groq', 'gemini']);
  });

  test('opsi yang dilayani ke frontend menyebut bahasa, format, dan batas ukuran', () => {
    const opsi = getTranscribeOptions();

    expect(opsi.provider).toBe('groq');
    expect(opsi.defaultLanguage).toBe('id');
    expect(opsi.languages.map((item) => item.value)).toEqual(['id', 'en', 'auto']);
    expect(opsi.acceptedFormats).toEqual(ALLOWED_AUDIO_FORMATS);
    expect(opsi.maxAudioBytes).toBe(25 * 1024 * 1024);
  });
});
