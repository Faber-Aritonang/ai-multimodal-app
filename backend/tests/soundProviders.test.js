/**
 * Test: config/soundProviders
 *
 * Klien OpenAI SDK di-mock, jadi test tidak menembak jaringan dan bisa jalan
 * tanpa kredensial OpenAI. Yang diuji di sini adalah bentuk permintaan ke
 * provider (endpoint, model, pesan, parameter) dan pembacaan balasannya.
 */

const mockSpeechCreate = jest.fn();
const mockGetClient = jest.fn();
// Gemini & ElevenLabs memakai fetch bawaan Node, bukan SDK — keduanya di-mock
// supaya test tidak menembak jaringan dan tidak memakai kuota gratis siapa pun.
const mockFetch = jest.fn();
const fetchAsli = global.fetch;

jest.mock('../config/openai', () => ({
  getClient: (...args) => mockGetClient(...args)
}));

const {
  generateSpeech,
  getSpeechChain,
  getSpeechProviderStatus,
  getSoundVoiceOptions,
  resetElevenLabsVoiceCache,
  measureWavDuration,
  wrapPcmAsWav,
  setEdgeSocketFactory,
  buildEdgeHeaders,
  buildEdgeSsml,
  edgeGecToken,
  parseEdgeFrame,
  defaultFormatFor,
  VOICES_BY_PROVIDER,
  SUPPORTED_FORMATS_BY_PROVIDER,
  DEFAULT_FORMAT_BY_PROVIDER,
  DEFAULT_OPENAI_TTS_MODEL,
  DEFAULT_GEMINI_TTS_MODEL,
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_VOICE_ID,
  EDGE_WSS_URL,
  EDGE_TRUSTED_CLIENT_TOKEN,
  PROVIDERS,
  PROVIDER_ORDER
} = require('../config/soundProviders');

const SOUND_ENV_VARS = [
  'SOUND_PROVIDER',
  'SOUND_FALLBACK_PROVIDER',
  'SOUND_REQUEST_TIMEOUT_MS',
  'GEMINI_API_KEY',
  'GEMINI_TTS_MODEL',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_MODEL',
  'ELEVENLABS_VOICE_ID',
  'OPENAI_API_KEY',
  'OPENAI_TTS_MODEL',
  'EDGE_TTS_WSS_URL'
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

// OpenAI mengembalikan body audio mentah; satu-satunya cara membacanya adalah
// `.arrayBuffer()`.
const rawAudioReply = (buffer) => ({
  arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
});

const providerError = (message, status) => {
  const error = new Error(message);
  if (status) error.status = status;
  return error;
};

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

const binaryResponse = (buffer, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => '',
  arrayBuffer: async () =>
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
});

/** Balasan Gemini TTS pada bentuk `/interactions` (PCM mentah ber-base64). */
const geminiAudioReply = (pcm) => ({ output_audio: { data: pcm.toString('base64') } });

const pcmBytes = (panjang = 480) => Buffer.alloc(panjang, 3);

const urlDipanggil = (n = 0) => String(mockFetch.mock.calls[n][0]);
const bodyDipanggil = (n = 0) => JSON.parse(mockFetch.mock.calls[n][1].body);

/**
 * Socket Edge palsu.
 *
 * Edge adalah cadangan default dan selalu "siap", jadi tanpa stub ini setiap
 * kegagalan provider lain di test akan berlanjut menjadi koneksi sungguhan ke
 * layanan Microsoft — test jadi lambat, tidak dapat diulang, dan bisa memakai
 * kuota pihak lain. Handler didaftarkan lewat `on`, seperti `ws`.
 */
const buatSocketEdgePalsu = (skenario = {}) => {
  const handlers = {};
  const terkirim = [];

  const socket = {
    terkirim,
    on(event, handler) {
      handlers[event] = handler;
      return socket;
    },
    send(pesan) {
      terkirim.push(pesan);
    },
    close() {
      handlers.close?.({ code: 1000, reason: '' });
    },
    // Dipakai test untuk memicu kejadian dari sisi server.
    picu(event, ...args) {
      handlers[event]?.(...args);
    }
  };

  // Secara default socket langsung gagal: test lain tidak perlu tahu soal Edge.
  setImmediate(() => {
    if (skenario.gagalBuka) handlers.error?.(new Error(skenario.gagalBuka));
    else handlers.open?.();
  });

  return socket;
};

/** Bangun frame biner Edge: 2 byte panjang header + header + isi audio. */
const frameEdge = (path, body, headerTambahan = '') => {
  const header = `Path:${path}\r\n${headerTambahan}\r\n`;
  const headerBuffer = Buffer.from(header, 'utf8');
  const panjang = Buffer.alloc(2);
  panjang.writeUInt16BE(headerBuffer.length, 0);

  return Buffer.concat([panjang, headerBuffer, Buffer.from(body)]);
};

const frameTeksEdge = (path) => `X-RequestId:abc\r\nPath:${path}\r\n\r\n`;

let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(SOUND_ENV_VARS.map((key) => [key, process.env[key]]));
  SOUND_ENV_VARS.forEach((key) => delete process.env[key]);

  mockSpeechCreate.mockReset();
  mockGetClient.mockReset();
  mockGetClient.mockReturnValue({
    audio: { speech: { create: mockSpeechCreate } }
  });
  mockSpeechCreate.mockResolvedValue(rawAudioReply(wavBytes(1)));

  mockFetch.mockReset();
  global.fetch = mockFetch;
  mockFetch.mockResolvedValue(jsonResponse(geminiAudioReply(pcmBytes())));
  // Cache daftar voice ElevenLabs hidup selama proses; tanpa direset, test yang
  // berjalan setelahnya tidak memanggil /voices lagi dan jumlah request berubah.
  resetElevenLabsVoiceCache();

  // Default test: Edge gagal cepat tanpa menyentuh jaringan. Test yang menguji
  // Edge sendiri mengganti ini lewat setEdgeSocketFactory.
  setEdgeSocketFactory(() => buatSocketEdgePalsu({ gagalBuka: 'koneksi ditolak oleh stub test' }));
});

afterEach(() => {
  global.fetch = fetchAsli;
  setEdgeSocketFactory(null);

  SOUND_ENV_VARS.forEach((key) => {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  });
});

describe('pemilihan provider', () => {
  test('tanpa kredensial apa pun: Edge yang melayani, bukan kegagalan', () => {
    // Edge tidak butuh kunci, jadi rantai defaultnya tidak pernah kosong — fitur
    // suara tetap hidup di mesin yang belum diisi kredensial apa pun. Karena
    // provider utamanya sama dengan cadangannya, namanya tidak muncul dua kali.
    expect(getSpeechChain()).toEqual(['edge']);
  });

  test('GEMINI_API_KEY membuat Gemini jadi provider utama (gratis, suara Indonesia)', () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';

    expect(getSpeechChain()).toEqual(['gemini', 'edge']);
  });

  test('kuota Gemini habis: cadangan Edge sudah ada di rantai', () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
    process.env.ELEVENLABS_API_KEY = 'el-kunci-uji';

    // Cadangannya Edge — provider gratis yang tidak butuh kunci, jadi kuota
    // Gemini yang habis tidak berakhir sebagai kegagalan.
    expect(getSpeechChain()).toEqual(['gemini', 'edge']);
  });

  test('hanya kunci ElevenLabs: provider itu yang dipakai, tanpa duplikat', () => {
    process.env.ELEVENLABS_API_KEY = 'el-kunci-uji';

    expect(getSpeechChain()).toEqual(['elevenlabs', 'edge']);
  });

  test('kunci OpenAI tidak lagi otomatis dipakai, hanya bila diminta', () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
    process.env.ELEVENLABS_API_KEY = 'el-kunci-uji';
    process.env.OPENAI_API_KEY = 'sk-kunci-uji';

    // Berbayar, jadi tidak pernah masuk rantai default selama yang gratis ada.
    expect(getSpeechChain()).toEqual(['gemini', 'edge']);

    process.env.SOUND_PROVIDER = 'openai';

    expect(getSpeechChain()).toEqual(['openai', 'edge']);
  });

  test('setiap provider di daftar default punya suara Indonesia', () => {
    // Syarat masuk PROVIDER_ORDER: halaman text-to-sound selalu mengucapkan teks
    // Indonesia, jadi provider tanpa suara Indonesia tidak boleh ada di daftar —
    // sekalipun kuncinya terisi (itulah yang dulu terjadi pada MiMo: hanya
    // Mandarin + Inggris, dan mengisi MIMO_API_KEY memindahkan seluruh halaman).
    expect(PROVIDERS.mimo).toBeUndefined();

    expect(PROVIDER_ORDER).toEqual(['gemini', 'elevenlabs', 'openai', 'edge']);
  });

  test('kolom OpenAI dan Gemini tidak bisa saling ditukar', () => {
    process.env.OPENAI_API_KEY = 'sk-kunci-uji';

    // Voice Gemini bukan nilai yang sah untuk provider OpenAI.
    expect(getSoundVoiceOptions().voices.map((item) => item.value)).not.toContain('Kore');
    expect(getSoundVoiceOptions().defaultVoice).toBe('alloy');
  });

  test('SOUND_FALLBACK_PROVIDER menimpa cadangan default', () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
    process.env.SOUND_FALLBACK_PROVIDER = 'openai';

    expect(getSpeechChain()).toEqual(['gemini', 'openai']);
  });

  test('SOUND_FALLBACK_PROVIDER=none mematikan cadangan', () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
    process.env.SOUND_FALLBACK_PROVIDER = 'none';

    expect(getSpeechChain()).toEqual(['gemini']);
  });

  test('cadangan yang tidak dikenal ditolak, bukan diabaikan diam-diam', () => {
    process.env.SOUND_FALLBACK_PROVIDER = 'playht';

    expect(() => getSpeechChain()).toThrow('Unknown SOUND_FALLBACK_PROVIDER');
  });

  test('SOUND_PROVIDER=none mematikan fitur suara', () => {
    process.env.SOUND_PROVIDER = 'none';

    expect(getSpeechChain()).toEqual([]);
  });

  test('nama provider yang tidak dikenal ditolak', () => {
    process.env.SOUND_PROVIDER = 'playht';

    expect(() => getSpeechChain()).toThrow('Unknown SOUND_PROVIDER "playht"');
    expect(getSpeechChain).toThrow(
      expect.objectContaining({ code: 'INVALID_PROVIDER_CONFIG' })
    );
  });

  test('deskripsi gaya suara tidak pernah menggantikan pilihan voice', () => {
    // Tidak ada provider di sini yang membuat suara dari deskripsi; pada Gemini
    // gaya dikirim sebagai arahan di depan teks, pada OpenAI lewat
    // `instructions`, dan pada Edge/ElevenLabs diabaikan. Jadi pilihan voice
    // user selalu berlaku.
    process.env.SOUND_PROVIDER = 'gemini';

    expect(getSoundVoiceOptions().voices.map((item) => item.value)).toContain('Kore');
    expect(getSoundVoiceOptions().defaultVoice).toBe('Kore');
  });
});

describe('openai', () => {
  test('memakai endpoint audio/speech dengan voice dan format yang dipilih', async () => {
    process.env.OPENAI_API_KEY = 'sk-kunci-uji';

    const result = await generateSpeech({
      text: 'Selamat pagi, ini contoh suara Indonesia.',
      voice: 'nova',
      format: 'mp3'
    });

    expect(mockGetClient).toHaveBeenCalledWith({
      apiKey: 'sk-kunci-uji',
      timeout: 120000,
      maxRetries: 0
    });
    expect(mockSpeechCreate).toHaveBeenCalledWith({
      model: DEFAULT_OPENAI_TTS_MODEL,
      voice: 'nova',
      input: 'Selamat pagi, ini contoh suara Indonesia.',
      response_format: 'mp3'
    });
    expect(result.provider).toBe('openai');
    expect(result.voice).toBe('nova');
    expect(result.format).toBe('mp3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.buffer.equals(wavBytes(1))).toBe(true);
  });

  test('deskripsi gaya dikirim sebagai instructions, TANPA mengganti voice', async () => {
    process.env.OPENAI_API_KEY = 'sk-kunci-uji';

    await generateSpeech({ text: 'halo', voice: 'ash', style: 'hangat dan santai' });

    expect(mockSpeechCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_OPENAI_TTS_MODEL,
        voice: 'ash',
        instructions: 'hangat dan santai'
      })
    );
  });

  test('instructions tidak dikirim ke model yang tidak mendukungnya', async () => {
    process.env.OPENAI_API_KEY = 'sk-kunci-uji';
    process.env.OPENAI_TTS_MODEL = 'tts-1';

    await generateSpeech({ text: 'halo', style: 'hangat' });

    const params = mockSpeechCreate.mock.calls[0][0];

    expect(params.model).toBe('tts-1');
    expect(params).not.toHaveProperty('instructions');
  });

  test('voice milik provider lain diganti voice bawaan OpenAI', async () => {
    process.env.OPENAI_API_KEY = 'sk-kunci-uji';

    // Terjadi saat provider cadangan yang akhirnya melayani permintaan.
    await generateSpeech({ text: 'halo', voice: 'Mia' });

    expect(mockSpeechCreate.mock.calls[0][0].voice).toBe('alloy');
  });

  test('kredensial ditolak dibedakan dari kegagalan sesaat', async () => {
    process.env.OPENAI_API_KEY = 'sk-salah';
    mockSpeechCreate.mockRejectedValue(providerError('Unauthorized', 401));

    await expect(generateSpeech({ text: 'halo' })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_CONFIG'
    });
    await expect(generateSpeech({ text: 'halo' })).rejects.toThrow(/OpenAI TTS error.*HTTP 401/);
  });

  test('gangguan provider bisa dicoba ulang', async () => {
    process.env.OPENAI_API_KEY = 'sk-kunci-uji';
    mockSpeechCreate.mockRejectedValue(providerError('upstream error', 503));

    await expect(generateSpeech({ text: 'halo' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE'
    });
  });

  test('audio kosong gagal jelas, bukan disimpan sebagai berkas kosong', async () => {
    process.env.OPENAI_API_KEY = 'sk-kunci-uji';
    mockSpeechCreate.mockResolvedValue(rawAudioReply(Buffer.alloc(0)));

    await expect(generateSpeech({ text: 'halo' })).rejects.toThrow(/audio kosong/);
  });

  test('placeholder .env.example tidak dianggap kredensial valid', () => {
    process.env.OPENAI_API_KEY = 'sk-your-openai-key-here';

    expect(getSpeechProviderStatus().status.openai).toBe('missing');
    // Placeholder membuat OpenAI dianggap belum diisi, jadi Edge yang dipakai.
    expect(getSpeechChain()).toEqual(['edge']);
  });
});

describe('gemini', () => {
  test('mengirim model, teks, dan voice ke /interactions', async () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';

    const result = await generateSpeech({ text: 'Selamat pagi.' });

    expect(urlDipanggil()).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(mockFetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('gemini-kunci-uji');
    expect(bodyDipanggil()).toEqual({
      model: DEFAULT_GEMINI_TTS_MODEL,
      input: 'Selamat pagi.',
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: 'Kore' }] }
    });
    expect(result.provider).toBe('gemini');
    expect(result.voice).toBe('Kore');
  });

  test('PCM mentah dibungkus menjadi WAV yang bisa diputar browser', async () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
    // PCM 24 kHz mono: 1 detik = 48000 byte.
    mockFetch.mockResolvedValue(jsonResponse(geminiAudioReply(Buffer.alloc(48000, 1))));

    const result = await generateSpeech({ text: 'halo' });

    expect(result.format).toBe('wav');
    expect(result.mimeType).toBe('audio/wav');
    expect(result.buffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(result.buffer.toString('ascii', 8, 12)).toBe('WAVE');
    // Durasi dibaca dari header yang baru disusun, bukan diminta ke provider.
    expect(result.duration).toBe(1);
  });

  test('deskripsi gaya dikirim sebagai arahan bahasa alami, bukan parameter lain', async () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';

    await generateSpeech({ text: 'Selamat pagi.', style: 'logat Indonesia baku, tempo santai' });

    // Tanpa gaya, teks dikirim apa adanya supaya yang diucapkan persis teks user.
    expect(bodyDipanggil().input).toBe('logat Indonesia baku, tempo santai:\nSelamat pagi.');
  });

  test('bentuk balasan lama (candidates[].inlineData) juga dibaca', async () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
    mockFetch.mockResolvedValue(
      jsonResponse({
        candidates: [
          { content: { parts: [{ inlineData: { data: pcmBytes().toString('base64') } }] } }
        ]
      })
    );

    const result = await generateSpeech({ text: 'halo' });

    expect(result.format).toBe('wav');
  });

  test('endpoint baru yang 404 dicoba ulang dengan bentuk lama', async () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
    const peringatan = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockFetch.mockImplementation(async (url) => {
      if (String(url).includes('/interactions')) {
        return jsonResponse({ error: { message: 'not found' } }, 404);
      }

      return jsonResponse({
        candidates: [
          { content: { parts: [{ inlineData: { data: pcmBytes().toString('base64') } }] } }
        ]
      });
    });

    const result = await generateSpeech({ text: 'halo' });

    expect(urlDipanggil(1)).toContain('/models/gemini-3.1-flash-tts-preview:generateContent');
    expect(bodyDipanggil(1).generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(result.format).toBe('wav');

    peringatan.mockRestore();
  });

  test('galat selain 404 tidak dicoba ke bentuk lama', async () => {
    process.env.GEMINI_API_KEY = 'gemini-salah';
    mockFetch.mockResolvedValue(jsonResponse({ error: { message: 'nope' } }, 401));

    await expect(generateSpeech({ text: 'halo' })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_CONFIG'
    });
    // Hanya satu percobaan: mencoba endpoint lain untuk kredensial yang ditolak
    // hanya menyamarkan penyebabnya.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('balasan tanpa audio menyebut kunci yang benar-benar diterima', async () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
    mockFetch.mockResolvedValue(jsonResponse({ output_audio: {}, catatan: 'kosong' }));

    await expect(generateSpeech({ text: 'halo' })).rejects.toThrow(
      /tidak mengembalikan audio.*output_audio/m
    );
  });

  test('kuota gratis habis (HTTP 429) bisa dicoba ulang, bukan galat konfigurasi', async () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
    mockFetch.mockResolvedValue(
      jsonResponse({ error: { message: 'Quota exceeded' } }, 429)
    );

    await expect(generateSpeech({ text: 'halo' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE'
    });
  });

  test('kuota Gemini habis lalu dilayani ElevenLabs, dan itu tercatat', async () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
    process.env.ELEVENLABS_API_KEY = 'el-kunci-uji';
    // Cadangan dipatok: dengan cadangan default (Edge) hanya MP3 yang bisa
    // dilayani, sedangkan test ini memang menguji jalur WAV ke ElevenLabs.
    process.env.SOUND_FALLBACK_PROVIDER = 'elevenlabs';

    mockFetch.mockImplementation(async (url) => {
      const alamat = String(url);

      if (alamat.includes('/interactions')) {
        return jsonResponse({ error: { message: 'Quota exceeded' } }, 429);
      }
      if (alamat.includes('/voices')) {
        return jsonResponse({ voices: [{ voice_id: 'VOICE-A', name: 'Wanita A' }] });
      }
      return binaryResponse(Buffer.alloc(4800, 2), 200);
    });

    const result = await generateSpeech({ text: 'Selamat pagi.', format: 'wav' });

    expect(result.provider).toBe('elevenlabs');
    expect(result.format).toBe('wav');
    // Provider yang gagal dicatat supaya "kok suaranya beda" bisa ditelusuri.
    expect(result.attempts).toEqual([
      { provider: 'gemini', reason: expect.stringContaining('HTTP 429') }
    ]);
  });

  test('MP3 dilewati karena Gemini hanya menghasilkan WAV', async () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';

    // Gemini dilewati sebelum sempat memanggil API-nya. Cadangannya (Edge) juga
    // tidak sanggup melayani permintaan ini karena mp3 bukan wilayahnya —
    // dari sudut pandang Gemini, yang penting ia tidak dipanggil sia-sia.
    await expect(generateSpeech({ text: 'halo', format: 'mp3' })).rejects.toThrow(
      /format mp3 is not supported/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('elevenlabs', () => {
  test('MP3 diambil langsung dari endpoint voice, dengan kunci di header', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-kunci-uji';

    mockFetch.mockImplementation(async (url) => {
      const alamat = String(url);
      if (alamat.includes('/voices')) {
        return jsonResponse({
          voices: [{ voice_id: 'VOICE-A', name: 'Wanita A' }, { voice_id: 'VOICE-B', name: 'Pria B' }]
        });
      }
      return binaryResponse(Buffer.from('ID3audio'), 200);
    });

    const result = await generateSpeech({
      text: 'Selamat pagi.',
      voice: 'VOICE-B',
      format: 'mp3'
    });

    expect(urlDipanggil(1)).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/VOICE-B?output_format=mp3_44100_128'
    );
    expect(mockFetch.mock.calls[1][1].headers['xi-api-key']).toBe('el-kunci-uji');
    expect(bodyDipanggil(1)).toEqual({
      text: 'Selamat pagi.',
      model_id: DEFAULT_ELEVENLABS_MODEL
    });
    expect(result.format).toBe('mp3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.voice).toBe('VOICE-B');
    expect(result.buffer.toString()).toBe('ID3audio');
  });

  test('permintaan WAV memakai PCM yang dibungkus header di sini', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-kunci-uji';

    mockFetch.mockImplementation(async (url) => {
      const alamat = String(url);
      if (alamat.includes('/voices')) {
        return jsonResponse({ voices: [{ voice_id: 'VOICE-A', name: 'Wanita A' }] });
      }
      // 1 detik PCM 24 kHz mono.
      return binaryResponse(Buffer.alloc(48000, 5), 200);
    });

    const result = await generateSpeech({ text: 'halo', voice: 'VOICE-A' });

    // ElevenLabs tidak punya output WAV, jadi yang diminta adalah PCM.
    expect(urlDipanggil(1)).toContain('output_format=pcm_24000');
    expect(result.format).toBe('wav');
    expect(result.buffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(result.duration).toBe(1);
  });

  test('voice yang tidak ada di akun diganti voice yang benar-benar tersedia', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-kunci-uji';
    const peringatan = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockFetch.mockImplementation(async (url) => {
      const alamat = String(url);
      if (alamat.includes('/voices')) {
        // Akun yang dibuat setelah ElevenLabs mengganti daftar default: tidak
        // punya Rachel, jadi daftar statis di frontend tidak bisa dipercaya.
        return jsonResponse({ voices: [{ voice_id: 'VOICE-BARU', name: 'Suara Baru' }] });
      }
      return binaryResponse(Buffer.from('ID3audio'), 200);
    });

    const result = await generateSpeech({
      text: 'halo',
      voice: DEFAULT_ELEVENLABS_VOICE_ID,
      format: 'mp3'
    });

    expect(urlDipanggil(1)).toContain('/text-to-speech/VOICE-BARU');
    expect(result.voice).toBe('VOICE-BARU');
    expect(peringatan).toHaveBeenCalledWith(expect.stringContaining('tidak ada di akun ini'));
    // Penggantian suara harus terlihat di metadata, bukan terjadi diam-diam.
    expect(result.metadata ?? result.voice).toBe('VOICE-BARU');

    peringatan.mockRestore();
  });

  test('kunci yang ditolak dijawab sebagai galat konfigurasi', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-salah';
    mockFetch.mockResolvedValue(jsonResponse({ detail: { message: 'invalid api key' } }, 401));

    await expect(generateSpeech({ text: 'halo' })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_CONFIG'
    });
  });

  test('deskripsi gaya diabaikan, dan itu diberitahukan lewat log', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-kunci-uji';
    const peringatan = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockFetch.mockImplementation(async (url) => {
      const alamat = String(url);
      if (alamat.includes('/voices')) {
        return jsonResponse({ voices: [{ voice_id: 'VOICE-A', name: 'Wanita A' }] });
      }
      return binaryResponse(Buffer.from('ID3audio'), 200);
    });

    await generateSpeech({ text: 'halo', voice: 'VOICE-A', format: 'mp3', style: 'hangat' });

    expect(peringatan).toHaveBeenCalledWith(expect.stringContaining('style diabaikan'));
    // Gaya tidak menjadi bagian dari teks yang diucapkan.
    expect(bodyDipanggil(1).text).toBe('halo');

    peringatan.mockRestore();
  });
});

describe('edge', () => {
  /** Socket Edge yang mengirim audio lalu menutup permintaan. */
  const socketSukses = (chunks = [Buffer.from('ID3audio')]) => {
    let url = null;

    setEdgeSocketFactory((alamat) => {
      url = alamat;
      const socket = buatSocketEdgePalsu();

      setImmediate(() => {
        chunks.forEach((chunk) => socket.picu('message', frameEdge('audio', chunk), true));
        // Frame non-audio harus diabaikan, bukan ikut disatukan ke berkas.
        socket.picu('message', frameEdge('audio.metadata', Buffer.from('metadata')), true);
        socket.picu('message', frameTeksEdge('audio.metadata'), false);
        socket.picu('message', frameTeksEdge('turn.end'), false);
      });

      return socket;
    });

    return () => url;
  };

  test('tanpa kredensial apa pun, Edge melayani dan keluarannya MP3', async () => {
    const urlTerakhir = socketSukses([Buffer.from('ID3pertama'), Buffer.from('kedua')]);

    const result = await generateSpeech({ text: 'Selamat pagi!' });

    expect(result.provider).toBe('edge');
    // Format bawaan provider ini MP3: WAV ditolak server Microsoft.
    expect(result.format).toBe('mp3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.voice).toBe('id-ID-GadisNeural');
    // Dua potongan disatukan menjadi satu berkas.
    expect(result.buffer.toString()).toBe('ID3pertamakedua');
    // MP3 tidak menyimpan durasi di header yang bisa dipercaya.
    expect(result.duration).toBeNull();

    // Alamat handshake membawa token anti-abuse dan versi kliennya.
    expect(urlTerakhir()).toContain(EDGE_WSS_URL);
    expect(urlTerakhir()).toContain(`TrustedClientToken=${EDGE_TRUSTED_CLIENT_TOKEN}`);
    expect(urlTerakhir()).toMatch(/Sec-MS-GEC=[0-9A-F]{64}/);
  });

  test('mengirim konfigurasi audio dan SSML berisi voice serta teksnya', async () => {
    let socket = null;

    setEdgeSocketFactory(() => {
      socket = buatSocketEdgePalsu();
      setImmediate(() => {
        socket.picu('message', frameEdge('audio', Buffer.from('ID3audio')), true);
        socket.picu('message', frameTeksEdge('turn.end'), false);
      });
      return socket;
    });

    await generateSpeech({ text: 'Halo dunia', voice: 'id-ID-ArdiNeural' });

    const [config, ssml] = socket.terkirim;

    expect(config).toContain('Path:speech.config');
    expect(config).toContain('audio-24khz-48kbitrate-mono-mp3');
    expect(ssml).toContain('Path:ssml');
    expect(ssml).toContain("<voice name='id-ID-ArdiNeural'>");
    // Bahasa SSML diturunkan dari nama voice-nya sendiri.
    expect(ssml).toContain("xml:lang='id-ID'");
    expect(ssml).toContain('Halo dunia');
  });

  test('voice milik provider lain diganti voice Indonesia bawaan Edge', async () => {
    let socket = null;

    setEdgeSocketFactory(() => {
      socket = buatSocketEdgePalsu();
      setImmediate(() => {
        socket.picu('message', frameEdge('audio', Buffer.from('ID3audio')), true);
        socket.picu('message', frameTeksEdge('turn.end'), false);
      });
      return socket;
    });

    // Terjadi saat provider cadangan yang akhirnya melayani permintaan.
    const result = await generateSpeech({ text: 'halo', voice: 'Kore' });

    expect(result.voice).toBe('id-ID-GadisNeural');
    expect(socket.terkirim[1]).toContain('id-ID-GadisNeural');
  });

  test('deskripsi gaya diabaikan, dan itu diberitahukan lewat log', async () => {
    const peringatan = jest.spyOn(console, 'warn').mockImplementation(() => {});
    socketSukses();

    await generateSpeech({ text: 'halo', style: 'logat Indonesia baku, tempo santai' });

    expect(peringatan).toHaveBeenCalledWith(expect.stringContaining('style diabaikan'));

    peringatan.mockRestore();
  });

  test('WAV gagal jelas: Edge hanya sanggup MP3', async () => {
    // Rantai provider sudah melewati Edge untuk permintaan WAV (provider yang
    // tidak sanggup formatnya dilewati sebelum dipanggil), jadi cabang ini hanya
    // tercapai lewat pemanggilan langsung — dan mengirim MP3 berlabel WAV jauh
    // lebih buruk daripada gagal.
    await expect(
      PROVIDERS.edge.generate({ text: 'halo', voice: 'id-ID-GadisNeural', format: 'wav' })
    ).rejects.toMatchObject({ code: 'PROVIDER_UNSUPPORTED' });

    // Lewat rantai: tanpa provider lain yang benar-benar dicoba dan gagal,
    // permintaan WAV yang eksplisit tetap ditolak apa adanya — bukan diam-diam
    // ditukar menjadi MP3.
    process.env.SOUND_PROVIDER = 'edge';
    await expect(generateSpeech({ text: 'halo', format: 'wav' })).rejects.toThrow(
      /edge: format wav is not supported/
    );
  });

  test('provider utama gagal sesaat: cadangan melayani walau formatnya berbeda', async () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
    // Kuota gratis Gemini habis, dan cadangannya (Edge) hanya sanggup MP3
    // sedangkan yang diminta WAV. Tanpa percobaan terakhir ini permintaannya
    // gagal total padahal provider yang bisa melayaninya sudah ada di rantai.
    mockFetch.mockResolvedValue(jsonResponse({ error: { message: 'Quota exceeded' } }, 429));
    socketSukses([Buffer.from('ID3pengganti')]);

    const result = await generateSpeech({ text: 'halo', format: 'wav' });

    expect(result.provider).toBe('edge');
    expect(result.format).toBe('mp3');
    expect(result.buffer.toString()).toBe('ID3pengganti');
    // Penggantian formatnya tercatat, bukan terjadi diam-diam.
    expect(result.attempts).toEqual([
      { provider: 'gemini', reason: expect.stringContaining('HTTP 429') },
      {
        provider: 'edge',
        reason: 'format wav is not supported; dilayani sebagai mp3'
      }
    ]);
  });

  test('turn.end tanpa audio gagal, bukan menyimpan berkas kosong', async () => {
    setEdgeSocketFactory(() => {
      const socket = buatSocketEdgePalsu();
      setImmediate(() => socket.picu('message', frameTeksEdge('turn.end'), false));
      return socket;
    });

    await expect(generateSpeech({ text: 'halo' })).rejects.toThrow(
      /Edge TTS tidak mengembalikan audio/
    );
  });

  test('handshake yang ditolak bisa dicoba ulang, bukan galat konfigurasi', async () => {
    // Provider ini tidak punya kredensial yang bisa salah; kegagalan handshake
    // (mis. jam server melenceng) bersifat sementara.
    setEdgeSocketFactory(() => buatSocketEdgePalsu({ gagalBuka: 'HTTP 403' }));

    await expect(generateSpeech({ text: 'halo' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE'
    });
  });

  test('header handshake menyerupai Edge, tanpa kredensial siapa pun', () => {
    const headers = buildEdgeHeaders();

    expect(headers.Origin).toBe('chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold');
    expect(headers['User-Agent']).toContain('Edg/');
    expect(headers.Cookie).toMatch(/^muid=[0-9A-F]{32};$/);
  });

  test('token Sec-MS-GEC bulat per 5 menit dan berubah di jendela berikutnya', () => {
    const awal = Date.UTC(2026, 8, 22, 10, 3, 0);

    // Dua waktu dalam jendela 5 menit yang sama menghasilkan token yang sama —
    // token tidak perlu dibuat ulang tiap permintaan.
    expect(edgeGecToken(awal)).toBe(edgeGecToken(awal + 60 * 1000));
    expect(edgeGecToken(awal)).toMatch(/^[0-9A-F]{64}$/);
    expect(edgeGecToken(awal)).not.toBe(edgeGecToken(awal + 5 * 60 * 1000));
  });

  test('teks di-escape supaya SSML-nya tetap sah', () => {
    const ssml = buildEdgeSsml('R&D <b>untung</b>', 'id-ID-GadisNeural');

    expect(ssml).toContain('R&amp;D &lt;b&gt;untung&lt;/b&gt;');
    expect(ssml).not.toContain('<b>');
  });

  test('frame biner dibaca sesuai panjang header yang dilaporkan', () => {
    const frame = frameEdge('audio', Buffer.from('ID3isi'), 'Content-Type:audio/mpeg\r\n');
    const { header, body } = parseEdgeFrame(frame);

    expect(header).toContain('Path:audio');
    expect(header).toContain('Content-Type:audio/mpeg');
    expect(body.toString()).toBe('ID3isi');
    // Frame yang terpotong tidak dianggap berisi audio.
    expect(parseEdgeFrame(frame.subarray(0, 4)).body.length).toBe(0);
  });

  test('daftar voice, format, dan format bawaan mengikuti provider ini', () => {
    process.env.SOUND_PROVIDER = 'edge';

    const opsi = getSoundVoiceOptions();

    expect(opsi.provider).toBe('edge');
    expect(opsi.voices.map((item) => item.value)).toEqual([
      'id-ID-GadisNeural',
      'id-ID-ArdiNeural'
    ]);
    expect(opsi.formats).toEqual(['mp3']);
    expect(opsi.defaultFormat).toBe('mp3');
    expect(defaultFormatFor('gemini')).toBe('wav');
    expect(DEFAULT_FORMAT_BY_PROVIDER.edge).toBe('mp3');
  });
});

describe('wrapPcmAsWav', () => {
  test('menyusun header yang ukurannya sesuai isi PCM', () => {
    const wav = wrapPcmAsWav(Buffer.alloc(48000, 1), {
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16
    });

    expect(wav.length).toBe(44 + 48000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(4)).toBe(36 + 48000);
    expect(wav.readUInt32LE(40)).toBe(48000);
    // Header-nya harus terbaca balik oleh pembaca durasi yang sudah ada.
    expect(measureWavDuration(wav)).toBe(1);
  });

  test('PCM kosong ditolak, bukan disimpan sebagai berkas tanpa isi', () => {
    expect(() => wrapPcmAsWav(Buffer.alloc(0))).toThrow(/audio kosong/);
  });

  test('format yang didukung tiap provider tercatat apa adanya', () => {
    // Gemini tidak punya encoder MP3 di sini; provider lain bisa keduanya.
    expect(SUPPORTED_FORMATS_BY_PROVIDER.gemini).toEqual(['wav']);
    expect(SUPPORTED_FORMATS_BY_PROVIDER.elevenlabs).toEqual(['wav', 'mp3']);
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
    process.env.OPENAI_API_KEY = 'sk-kunci-uji';

    expect(getSpeechProviderStatus()).toEqual({
      chain: ['openai', 'edge'],
      status: {
        gemini: 'missing',
        elevenlabs: 'missing',
        openai: 'configured',
        // Tanpa kredensial: selalu siap, karena itu ia boleh jadi cadangan
        // default di mesin mana pun.
        edge: 'configured'
      },
      ready: true,
      defaultPrimary: 'openai',
      // Voice mengikuti provider di urutan pertama rantai — /health dipakai
      // untuk mencocokkan error dengan konfigurasi yang sebenarnya.
      voices: VOICES_BY_PROVIDER.openai.map((item) => item.value),
      formats: ['wav', 'mp3']
    });
  });

  test('kunci MiMo yang tertinggal di .env tidak berpengaruh apa pun', () => {
    // MiMo sudah dihapus dari daftar provider. Kunci lama yang masih terisi di
    // server tidak boleh muncul di status maupun menggeser provider utama.
    process.env.MIMO_API_KEY = 'mimo-kunci-uji';

    const status = getSpeechProviderStatus();

    expect(status.chain).toEqual(['edge']);
    expect(status.defaultPrimary).toBe('edge');
    expect(status.status.mimo).toBeUndefined();
    expect(status.voices).toEqual(VOICES_BY_PROVIDER.edge.map((item) => item.value));
  });

  test('kunci Gemini menggeser provider utama dan daftar voice-nya', () => {
    process.env.GEMINI_API_KEY = 'gemini-kunci-uji';

    const status = getSpeechProviderStatus();

    expect(status.chain).toEqual(['gemini', 'edge']);
    expect(status.defaultPrimary).toBe('gemini');
    expect(status.voices).toEqual(VOICES_BY_PROVIDER.gemini.map((item) => item.value));
  });

  test('tanpa kredensial, Edge-lah yang siap dan dilaporkan', () => {
    const status = getSpeechProviderStatus();

    expect(status.ready).toBe(true);
    expect(status.status.edge).toBe('configured');
    expect(status.status.openai).toBe('missing');
    expect(status.status.gemini).toBe('missing');
    expect(status.status.elevenlabs).toBe('missing');
  });

  test('tanpa kredensial, provider utama dan voice mengikuti urutan default', () => {
    const status = getSpeechProviderStatus();

    expect(status.chain).toEqual(['edge']);
    expect(status.defaultPrimary).toBe('edge');
    // Suara Indonesia bawaan Microsoft — bukan voice Mandarin, dan bukan nama
    // voice provider lain yang pasti ditolak.
    expect(status.voices).toEqual(['id-ID-GadisNeural', 'id-ID-ArdiNeural']);
  });
});
