/**
 * Test: config/imageProviders
 *
 * fetch global di-mock, sehingga test tidak menembak jaringan dan bisa jalan
 * di CI tanpa kredensial apa pun.
 */

const {
  generateImage,
  editImage,
  getProviderChain,
  getEditProviderChain,
  getProviderStatus,
  resolveDefaultPrimary,
  parseSize,
  detectFormat,
  measureImage,
  looksLikeImage
} = require('../config/imageProviders');

const PROVIDER_ENV_VARS = [
  'IMAGE_PROVIDER',
  'IMAGE_FALLBACK_PROVIDER',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'BYNARA_API_KEY',
  'BYNARA_BASE_URL',
  'BYNARA_DOWNLOAD_BASE_URL',
  'BYNARA_IMAGE_MODEL',
  'CLOUDFLARE_IMAGE_MODEL',
  'CLOUDFLARE_IMAGE_STEPS',
  'POLLINATIONS_TOKEN',
  'POLLINATIONS_MODEL',
  'POLLINATIONS_BASE_URL',
  'POLLINATIONS_EDIT_MODEL',
  'POLLINATIONS_FALLBACK_MODELS',
  'POLLINATIONS_ATTEMPTS',
  'OPENAI_API_KEY',
  'IMAGE_EDIT_PROVIDER',
  'IMAGE_EDIT_FALLBACK_PROVIDER',
  'CLOUDFLARE_EDIT_MODEL',
  'PUBLIC_BASE_URL'
];

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body')
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

/** PNG minimal yang cukup untuk dibaca measureImage (signature + chunk IHDR). */
const pngBytes = (width, height) => {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

/** JPEG minimal: SOI + segmen SOF0 yang memuat dimensi. */
const jpegBytes = (width, height) => {
  const buffer = Buffer.alloc(11);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer.writeUInt16BE(17, 4);
  buffer[6] = 8; // presisi bit
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
};

const realFetch = global.fetch;
const mockFetch = jest.fn();

/**
 * Respons bergaya Worker/REST API (body JSON).
 */
const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  statusText: ok ? 'OK' : 'Bad Request',
  text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0))
});

/**
 * Respons berisi bytes gambar.
 */
const binaryResponse = (buffer, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  statusText: ok ? 'OK' : 'Too Many Requests',
  text: jest.fn().mockResolvedValue(''),
  arrayBuffer: jest.fn().mockResolvedValue(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  )
});

const cloudflareOk = (buffer = JPEG_BYTES) =>
  jsonResponse({ result: { image: buffer.toString('base64') }, success: true, errors: [], messages: [] });

let savedEnv;

beforeAll(() => {
  global.fetch = mockFetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  savedEnv = Object.fromEntries(PROVIDER_ENV_VARS.map((key) => [key, process.env[key]]));
  PROVIDER_ENV_VARS.forEach((key) => delete process.env[key]);
  mockFetch.mockReset();
});

afterEach(() => {
  PROVIDER_ENV_VARS.forEach((key) => {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  });
});

const configureCloudflare = () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-123';
  process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
};

const configureBynara = () => {
  process.env.BYNARA_API_KEY = 'sk-nry-uji';
};

describe('parseSize', () => {
  test('memecah ukuran menjadi lebar & tinggi', () => {
    expect(parseSize('1792x1024')).toEqual({ width: 1792, height: 1024 });
  });

  test('melempar INVALID_SIZE untuk format yang salah', () => {
    expect(() => parseSize('besar')).toThrow('Invalid image size');
    expect(parseSize).toThrow(expect.objectContaining({ code: 'INVALID_SIZE' }));
  });
});

describe('detectFormat', () => {
  test.each([
    [PNG_BYTES, 'png', 'image/png'],
    [JPEG_BYTES, 'jpeg', 'image/jpeg'],
    [Buffer.from('RIFF____WEBPVP8 '), 'webp', 'image/webp'],
    [Buffer.from('tidak-dikenal'), 'png', 'image/png']
  ])('mendeteksi %# menjadi %s', (buffer, format, mimeType) => {
    expect(detectFormat(buffer)).toEqual({ format, mimeType });
  });
});

describe('measureImage', () => {
  test('membaca dimensi dari chunk IHDR pada PNG', () => {
    expect(measureImage(pngBytes(1024, 1792))).toEqual({ width: 1024, height: 1792 });
  });

  test('membaca dimensi dari marker SOF pada JPEG', () => {
    expect(measureImage(jpegBytes(768, 768))).toEqual({ width: 768, height: 768 });
  });

  test('mengembalikan null untuk buffer yang bukan gambar', () => {
    expect(measureImage(Buffer.from('bukan-gambar-sama-sekali'))).toBeNull();
    expect(measureImage(Buffer.alloc(0))).toBeNull();
    expect(measureImage(null)).toBeNull();
  });
});

describe('pemilihan provider', () => {
  test('default memilih cloudflare bila kredensialnya ada', () => {
    configureCloudflare();

    expect(getProviderChain()).toEqual(['cloudflare', 'pollinations']);
  });

  test('default jatuh ke pollinations tanpa kredensial apa pun', () => {
    expect(getProviderChain()).toEqual(['pollinations']);
  });

  test('IMAGE_FALLBACK_PROVIDER=none mematikan fallback', () => {
    process.env.IMAGE_PROVIDER = 'cloudflare';
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';

    expect(getProviderChain()).toEqual(['cloudflare']);
  });

  test('provider utama duplikat dengan fallback tidak diulang', () => {
    process.env.IMAGE_PROVIDER = 'pollinations';

    expect(getProviderChain()).toEqual(['pollinations']);
  });

  test('nama provider yang tidak dikenal ditolak', () => {
    process.env.IMAGE_PROVIDER = 'midjourney';

    expect(() => getProviderChain()).toThrow('Unknown IMAGE_PROVIDER "midjourney"');
    expect(getProviderChain).toThrow(
      expect.objectContaining({ code: 'INVALID_PROVIDER_CONFIG' })
    );
  });
});

describe('cloudflare', () => {
  test('mengirim prompt ke Workers AI dan mengembalikan bytes gambar', async () => {
    configureCloudflare();
    process.env.IMAGE_PROVIDER = 'cloudflare';
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';
    mockFetch.mockResolvedValue(cloudflareOk());

    const result = await generateImage({ prompt: 'a red apple', size: '1024x1024' });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc-123/ai/run/@cf/black-forest-labs/flux-1-schnell'
    );
    expect(options.headers.Authorization).toBe('Bearer cf-token');
    expect(JSON.parse(options.body)).toEqual(
      expect.objectContaining({ prompt: 'a red apple', steps: 4 })
    );

    // FLUX.1 [schnell] menolak properti di luar schemanya, dan `seed` termasuk
    // yang ditolak ("Additional or unevaluated properties '/seed' at '/' not
    // allowed"). Kegagalan itu dulu tersamar sebagai fallback ke Pollinations,
    // jadi gambar user selalu 768x768 dari provider publik.
    expect(Object.keys(JSON.parse(options.body))).not.toContain('seed');

    expect(result.provider).toBe('cloudflare');
    expect(result.format).toBe('jpeg');
    expect(result.buffer.equals(JPEG_BYTES)).toBe(true);
  });

  test('membersihkan kredensial yang tercemar baris baru', async () => {
    // Nilai env yang ikut membawa baris kedua (mis. `export VAR=...` akibat tanda
    // kutip yang tidak ditutup) harus dibersihkan sebelum jadi header HTTP.
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-123\nexport CLOUDFLARE_ACCOUNT_ID=acc-123';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token\nexport CLOUDFLARE_API_TOKEN=cf-token';
    process.env.IMAGE_PROVIDER = 'cloudflare';
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';
    mockFetch.mockResolvedValue(cloudflareOk());

    await generateImage({ prompt: 'a cat', size: '1024x1024' });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc-123/ai/run/@cf/black-forest-labs/flux-1-schnell'
    );
    expect(options.headers.Authorization).toBe('Bearer cf-token');
  });

  test('tanpa kredensial Cloudflare dilewati ke Pollinations', async () => {
    process.env.IMAGE_PROVIDER = 'cloudflare';
    mockFetch.mockResolvedValue(binaryResponse(PNG_BYTES));

    const result = await generateImage({ prompt: 'a cat', size: '1024x1024' });

    expect(result.provider).toBe('pollinations');
    expect(result.attempts).toEqual([
      { provider: 'cloudflare', reason: 'missing credentials' }
    ]);
  });

  test('tanpa kredensial & tanpa fallback -> MISSING_CREDENTIALS', async () => {
    process.env.IMAGE_PROVIDER = 'cloudflare';
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';

    await expect(generateImage({ prompt: 'a cat', size: '1024x1024' })).rejects.toThrow(
      expect.objectContaining({ code: 'MISSING_CREDENTIALS' })
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('ukuran non-square dilewati karena FLUX schnell keluaran tetap 1024x1024', async () => {
    configureCloudflare();
    process.env.IMAGE_PROVIDER = 'cloudflare';
    mockFetch.mockResolvedValue(binaryResponse(JPEG_BYTES));

    const result = await generateImage({ prompt: 'a wide landscape', size: '1792x1024' });

    expect(result.provider).toBe('pollinations');
    expect(result.attempts).toEqual([
      { provider: 'cloudflare', reason: 'size 1792x1024 is not supported' }
    ]);
    expect(String(mockFetch.mock.calls[0][0])).toContain('image.pollinations.ai');
  });

  test('error dari Workers AI dilaporkan apa adanya', async () => {
    configureCloudflare();
    process.env.IMAGE_PROVIDER = 'cloudflare';
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';
    mockFetch.mockResolvedValue(
      jsonResponse({ success: false, errors: [{ message: 'daily neurons exceeded' }] }, { ok: false, status: 429 })
    );

    await expect(generateImage({ prompt: 'a cat', size: '1024x1024' })).rejects.toThrow(
      /daily neurons exceeded/
    );
  });

  // Gangguan jaringan sesaat pernah membuat permintaan user gagal dengan pesan
  // "fetch failed" saja, sehingga tidak jelas apakah kredensialnya salah atau
  // koneksinya bermasalah. Sebab sebenarnya (error.cause) harus diteruskan.
  test('kegagalan jaringan menyebut sebabnya, bukan hanya "fetch failed"', async () => {
    configureCloudflare();
    process.env.IMAGE_PROVIDER = 'cloudflare';
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';

    const networkError = new Error('fetch failed');
    networkError.cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    mockFetch.mockRejectedValue(networkError);

    let caught;
    try {
      await generateImage({ prompt: 'a cat', size: '1024x1024' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    // Ringkasan rantai menyebut provider yang gagal + sebab aslinya, sehingga
    // "fetch failed" tidak lagi menjadi pesan buntu.
    expect(caught.message).toMatch(/cloudflare: fetch failed/);
    expect(caught.message).toMatch(/UND_ERR_SOCKET/);
    expect(caught.message).toMatch(/other side closed/);
    expect(caught.code).toBe('PROVIDER_UNAVAILABLE');
  });

  test('kegagalan jaringan diberi kode sendiri di lapisan fetch', async () => {
    const { PROVIDERS } = require('../config/imageProviders');
    configureCloudflare();

    const networkError = new Error('fetch failed');
    networkError.cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    mockFetch.mockRejectedValue(networkError);

    await expect(
      PROVIDERS.cloudflare.generate({ prompt: 'a cat', size: '1024x1024' })
    ).rejects.toMatchObject({ code: 'PROVIDER_NETWORK' });
  });
});

describe('bynara (endpoint gambar terpisah dari gateway chat)', () => {
  test('mengirim prompt ke api-images.bynara.id dengan Bearer key', async () => {
    configureBynara();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [{ url: 'https://img.example.com/out.png' }] }))
      .mockResolvedValueOnce(binaryResponse(pngBytes(1024, 1024)));

    const result = await generateImage({ prompt: 'a blue cat', size: '1024x1024' });

    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toBe('https://api-images.bynara.id/v1/images/generations');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer sk-nry-uji');
    expect(JSON.parse(options.body)).toEqual({
      model: 'agnes-image-2.0-flash',
      prompt: 'a blue cat',
      size: '1024x1024'
    });

    // Gambar diambil dari URL yang dikirim gateway, jadi hasilnya Buffer seperti provider lain.
    expect(String(mockFetch.mock.calls[1][0])).toBe('https://img.example.com/out.png');
    expect(result.provider).toBe('bynara');
    expect(result.model).toBe('agnes-image-2.0-flash');
    expect(result.width).toBe(1024);
  });

  test('memakai base64 tanpa permintaan kedua', async () => {
    configureBynara();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ data: [{ b64_json: pngBytes(768, 768).toString('base64') }] })
    );

    const result = await generateImage({ prompt: 'a cat', size: '1024x1024' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('bynara');
    expect({ width: result.width, height: result.height }).toEqual({ width: 768, height: 768 });
  });

  test('menerima bungkusan images[].url dan URL relatif dari gateway', async () => {
    configureBynara();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ images: [{ url: 'https://img.example.com/b.png' }] }))
      .mockResolvedValueOnce(binaryResponse(JPEG_BYTES));

    const result = await generateImage({ prompt: 'a cat', size: '1024x1024' });

    expect(result.provider).toBe('bynara');
    expect(result.format).toBe('jpeg');
  });

  test('HTTP error dan balasan tanpa gambar menjadi pesan yang bisa ditindaklanjuti', async () => {
    configureBynara();
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';

    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { type: 'validation_error', message: 'model not found' } },
        { ok: false, status: 400 }
      )
    );

    await expect(generateImage({ prompt: 'a cat', size: '1024x1024' })).rejects.toThrow(
      /Bynara error \(HTTP 400\): model not found/
    );

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(jsonResponse({ created: 1, data: [] }));

    await expect(generateImage({ prompt: 'a cat', size: '1024x1024' })).rejects.toThrow(
      /tidak mengembalikan gambar \(kunci balasan: created, data\)/
    );
  });

  test('URL gambar yang tidak bisa diunduh tidak dianggap berhasil', async () => {
    configureBynara();
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [{ url: 'https://img.example.com/hilang.png' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'gone' }, { ok: false, status: 404 }));

    await expect(generateImage({ prompt: 'a cat', size: '1024x1024' })).rejects.toThrow(
      /URL gambar yang tidak bisa diunduh \(img\.example\.com HTTP 404\)/
    );
  });

  test('URL relatif dari gateway diunduh dari router.bynara.id dengan Authorization', async () => {
    configureBynara();
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ created: 1, data: [{ url: '/v1/images/abc/download' }] }))
      .mockResolvedValueOnce(binaryResponse(pngBytes(1024, 1024)));

    const result = await generateImage({ prompt: 'a cat', size: '1024x1024' });

    const [url, options] = mockFetch.mock.calls[1];
    expect(String(url)).toBe('https://router.bynara.id/v1/images/abc/download');
    expect(options.headers.Authorization).toBe('Bearer sk-nry-uji');
    expect(result.provider).toBe('bynara');
    expect(result.width).toBe(1024);
  });

  test('host unduhan bisa diganti dan host generate dipakai sebagai cadangan', async () => {
    configureBynara();
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';
    process.env.BYNARA_DOWNLOAD_BASE_URL = 'https://unduh.example.com';
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [{ url: '/v1/images/abc/download' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'not found' }, { ok: false, status: 404 }))
      .mockResolvedValueOnce(binaryResponse(pngBytes(768, 768)));

    const result = await generateImage({ prompt: 'a cat', size: '1024x1024' });

    expect(String(mockFetch.mock.calls[1][0])).toBe('https://unduh.example.com/v1/images/abc/download');
    expect(String(mockFetch.mock.calls[2][0])).toBe('https://api-images.bynara.id/v1/images/abc/download');
    expect(result.width).toBe(768);
  });

  test('jadi provider utama begitu kuncinya diisi', () => {
    configureBynara();

    expect(resolveDefaultPrimary()).toBe('bynara');
    expect(getProviderChain()).toEqual(['bynara', 'pollinations']);
  });

  test('bukan default utama bila kuncinya belum diisi', () => {
    configureCloudflare();

    expect(resolveDefaultPrimary()).toBe('cloudflare');
    expect(getProviderStatus().status.bynara).toBe('missing');
  });
});

describe('pollinations', () => {
  test('membangun URL prompt dengan ukuran yang diminta', async () => {
    mockFetch.mockResolvedValue(binaryResponse(JPEG_BYTES));

    const result = await generateImage({ prompt: 'a blue cat', size: '1792x1024' });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://image.pollinations.ai/prompt/a%20blue%20cat');
    expect(url.searchParams.get('width')).toBe('1792');
    expect(url.searchParams.get('height')).toBe('1024');
    expect(url.searchParams.get('model')).toBe('flux');
    expect(url.searchParams.get('nologo')).toBe('true');
    expect(Number(url.searchParams.get('seed'))).toBeGreaterThanOrEqual(0);

    expect(result.provider).toBe('pollinations');
    expect(result.format).toBe('jpeg');
  });

  test('meneruskan token opsional bila diisi', async () => {
    process.env.POLLINATIONS_TOKEN = 'poll-token';
    mockFetch.mockResolvedValue(binaryResponse(JPEG_BYTES));

    await generateImage({ prompt: 'a cat', size: '1024x1024' });

    expect(new URL(mockFetch.mock.calls[0][0]).searchParams.get('token')).toBe('poll-token');
  });

  test('HTTP error dari Pollinations menjadi kegagalan yang terbaca', async () => {
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: jest.fn().mockResolvedValue('slow down'),
      arrayBuffer: jest.fn()
    });

    await expect(generateImage({ prompt: 'a cat', size: '1024x1024' })).rejects.toThrow(
      /Pollinations error \(HTTP 429\): slow down/
    );
  });

  test('body kosong dianggap gagal', async () => {
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';
    mockFetch.mockResolvedValue(binaryResponse(Buffer.alloc(0)));

    await expect(generateImage({ prompt: 'a cat', size: '1024x1024' })).rejects.toThrow(
      /All image providers failed/
    );
  });

  test('model yang kena limit dicoba ulang dengan model lain', async () => {
    process.env.IMAGE_PROVIDER = 'pollinations';
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';

    // Bentuk kegagalan nyata di produksi 22 Sep 2026: HTTP 500 dari Pollinations
    // yang isinya kuota per-model habis. Model pertama dan kedua penuh, ketiga lolos.
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ message: 'Per-user limit of 300 RPM exceeded' }, { ok: false, status: 500 })
      )
      .mockResolvedValueOnce(jsonResponse({ message: 'slow down' }, { ok: false, status: 429 }))
      .mockResolvedValueOnce(binaryResponse(JPEG_BYTES));

    const result = await generateImage({ prompt: 'a cat', size: '1024x1024' });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.provider).toBe('pollinations');
    // Setiap percobaan memakai model yang berbeda, karena limitnya dihitung per model.
    expect(mockFetch.mock.calls.map((call) => new URL(call[0]).searchParams.get('model'))).toEqual([
      'flux',
      'turbo',
      'flux-realism'
    ]);
  });

  test('daftar model mengikuti env dan bisa dimatikan', async () => {
    process.env.IMAGE_PROVIDER = 'pollinations';
    process.env.IMAGE_FALLBACK_PROVIDER = 'none';
    process.env.POLLINATIONS_MODEL = 'flux';
    process.env.POLLINATIONS_FALLBACK_MODELS = 'none';
    mockFetch.mockResolvedValue(
      jsonResponse({ message: 'boom' }, { ok: false, status: 500 })
    );

    await expect(generateImage({ prompt: 'a cat', size: '1024x1024' })).rejects.toThrow(
      /pollinations: Pollinations gagal di 1 model \(flux: Pollinations error \(HTTP 500\): .*boom/
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('dimensi hasil generate', () => {
  test('memakai dimensi asli gambar, bukan ukuran yang diminta', async () => {
    // Perilaku nyata FLUX di Pollinations: permintaan 1024x1024 bisa kembali 768x768
    mockFetch.mockResolvedValue(binaryResponse(jpegBytes(768, 768)));

    const result = await generateImage({ prompt: 'a cat', size: '1024x1024' });

    expect(result.width).toBe(768);
    expect(result.height).toBe(768);
  });

  test('dimensi dibaca juga dari PNG', async () => {
    mockFetch.mockResolvedValue(binaryResponse(pngBytes(1792, 1024)));

    const result = await generateImage({ prompt: 'a cat', size: '1792x1024' });

    expect(result).toEqual(expect.objectContaining({ width: 1792, height: 1024, format: 'png' }));
  });
});

describe('rantai fallback', () => {
  test('kegagalan provider utama otomatis dicoba ke fallback', async () => {
    configureCloudflare();
    process.env.IMAGE_PROVIDER = 'cloudflare';

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ success: false, errors: [{ message: 'service unavailable' }] }, { ok: false, status: 503 })
      )
      .mockResolvedValueOnce(binaryResponse(JPEG_BYTES));

    const result = await generateImage({ prompt: 'a cat', size: '1024x1024' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe('pollinations');
    expect(result.attempts).toEqual([
      { provider: 'cloudflare', reason: expect.stringContaining('service unavailable') }
    ]);
  });

  test('semua provider gagal -> satu error berisi ringkasan percobaan', async () => {
    configureCloudflare();
    process.env.IMAGE_PROVIDER = 'cloudflare';
    mockFetch.mockResolvedValue(
      jsonResponse({ success: false, errors: [{ message: 'boom' }] }, { ok: false, status: 500 })
    );

    await expect(generateImage({ prompt: 'a cat', size: '1024x1024' })).rejects.toThrow(
      /cloudflare: .*boom.*pollinations: /
    );
  });
});

describe('looksLikeImage', () => {
  test.each([
    [PNG_BYTES, true],
    [JPEG_BYTES, true],
    [Buffer.from('RIFF____WEBPVP8 '), true],
    [Buffer.from('bukan-gambar-sama-sekali'), false],
    [Buffer.alloc(0), false]
  ])('memeriksa magic bytes pada kasus %#', (buffer, expected) => {
    expect(looksLikeImage(buffer)).toBe(expected);
  });
});

describe('editImage (image-to-image)', () => {
  const INPUT = jpegBytes(400, 300);

  // Deteksi base64 di jalur multipart sengaja mengabaikan blok pendek supaya
  // tidak salah menangkap teks biasa, jadi fixture-nya diberi isi yang panjang.
  const paddedPng = (width, height) =>
    Buffer.concat([pngBytes(width, height), Buffer.alloc(2048, 7)]);

  test('cloudflare mengirim multipart ke FLUX.2 [klein] dan mengembalikan hasil edit', async () => {
    configureCloudflare();
    mockFetch.mockResolvedValueOnce(cloudflareOk(pngBytes(512, 512)));

    const result = await editImage({
      prompt: 'make it a watercolor painting',
      imageBuffer: INPUT,
      mimeType: 'image/jpeg',
      size: '1024x1024',
      guidance: 7
    });

    const [url, options] = mockFetch.mock.calls[0];

    expect(String(url)).toContain('/ai/run/@cf/black-forest-labs/flux-2-klein-4b');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer cf-token');
    // Model ini hanya menerima multipart, dan gambar input dikirim sebagai biner.
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('prompt')).toBe('make it a watercolor painting');
    expect(options.body.get('width')).toBe('1024');
    expect(options.body.get('height')).toBe('1024');
    expect(options.body.get('guidance')).toBe('7');
    expect(options.body.get('input_image_0')).toBeInstanceOf(Blob);

    expect(result.provider).toBe('cloudflare');
    expect(result.model).toBe('@cf/black-forest-labs/flux-2-klein-4b');
    // Dimensi dibaca dari bytes hasil, bukan dari ukuran yang diminta.
    expect({ width: result.width, height: result.height }).toEqual({ width: 512, height: 512 });
  });

  test('memakai model edit yang bisa diatur lewat env', async () => {
    configureCloudflare();
    process.env.CLOUDFLARE_EDIT_MODEL = '@cf/black-forest-labs/flux-2-klein-9b';
    mockFetch.mockResolvedValueOnce(cloudflareOk(pngBytes(512, 512)));

    await editImage({ prompt: 'x', imageBuffer: INPUT, mimeType: 'image/jpeg', size: '1024x1024' });

    expect(String(mockFetch.mock.calls[0][0])).toContain('/ai/run/@cf/black-forest-labs/flux-2-klein-9b');
  });

  test('membaca balasan multipart, bukan hanya JSON', async () => {
    configureCloudflare();

    const base64 = paddedPng(512, 512).toString('base64');
    const body = `--boundary\r\nContent-Type: image/png\r\n\r\n${base64}\r\n--boundary--\r\n`;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'multipart/form-data; boundary=boundary' },
      text: jest.fn().mockResolvedValue(body)
    });

    const result = await editImage({
      prompt: 'x',
      imageBuffer: INPUT,
      mimeType: 'image/jpeg',
      size: '512x512'
    });

    expect(result.format).toBe('png');
    expect(result.width).toBe(512);
  });

  test('menolak balasan yang tidak memuat gambar', async () => {
    configureCloudflare();
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: {}, success: true }));

    await expect(
      editImage({ prompt: 'x', imageBuffer: INPUT, mimeType: 'image/jpeg', size: '512x512' })
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  test('jatuh ke Pollinations saat Cloudflare gagal (gambar input dari URL publik)', async () => {
    configureCloudflare();
    // Provider URL-based hanya masuk rantai kalau alamat publiknya dinyatakan
    // lewat PUBLIC_BASE_URL.
    process.env.PUBLIC_BASE_URL = 'https://app.example.com';
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ success: false, errors: [{ message: 'busy' }] }))
      .mockResolvedValueOnce(binaryResponse(pngBytes(512, 512)));

    const result = await editImage({
      prompt: 'make it blue',
      imageBuffer: INPUT,
      mimeType: 'image/jpeg',
      size: '1024x1024',
      inputPublicUrl: 'https://app.example.com/uploads/media_1_input.jpg'
    });

    expect(result.provider).toBe('pollinations');
    expect(result.attempts).toEqual([{ provider: 'cloudflare', reason: expect.stringContaining('busy') }]);

    const pollinationsUrl = String(mockFetch.mock.calls[1][0]);
    expect(pollinationsUrl).toContain('image=https%3A%2F%2Fapp.example.com%2Fuploads%2Fmedia_1_input.jpg');
  });

  test('gambar input di penyimpanan remote sudah publik tanpa PUBLIC_BASE_URL', async () => {
    // Kondisi produksi setelah penyimpanan pindah ke Cloudinary: URL inputnya
    // absolut dan bisa diambil siapa pun, jadi Pollinations layak dipakai walau
    // PUBLIC_BASE_URL tidak diisi. Sebelum ini rantai edit kosong dan
    // image-to-image selalu gagal dengan "no provider available".
    mockFetch.mockResolvedValueOnce(binaryResponse(pngBytes(768, 768)));

    const inputUrl =
      'https://res.cloudinary.com/contoh-cloud/image/upload/v1790055783/media_1_input.jpg';
    const result = await editImage({
      prompt: 'make it blue',
      imageBuffer: INPUT,
      mimeType: 'image/jpeg',
      size: '1024x1024',
      inputPublicUrl: inputUrl
    });

    expect(result.provider).toBe('pollinations');
    expect(String(mockFetch.mock.calls[0][0])).toContain(`image=${encodeURIComponent(inputUrl)}`);
  });

  test('URL input privat tetap tidak membuka provider berbasis URL', async () => {
    mockFetch.mockResolvedValue(binaryResponse(pngBytes(512, 512)));

    // localhost/alamat privat ditolak: provider hanya akan mengabaikannya dan
    // mengembalikan gambar dari prompt saja, yang bukan hasil edit.
    await expect(
      editImage({
        prompt: 'x',
        imageBuffer: INPUT,
        mimeType: 'image/jpeg',
        size: '512x512',
        inputPublicUrl: 'http://localhost:4000/uploads/media_1_input.jpg'
      })
    ).rejects.toMatchObject({ code: 'MISSING_CREDENTIALS' });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('tanpa provider edit yang layak: gagal jelas, tanpa menembak provider', async () => {
    // Tanpa kredensial Cloudflare dan tanpa PUBLIC_BASE_URL, tidak ada provider
    // yang bisa dipakai — dan itu harus terlihat sebagai error, bukan gambar hasil
    // generate-ulang yang dikira hasil edit.
    mockFetch.mockResolvedValue(binaryResponse(pngBytes(512, 512)));

    await expect(
      editImage({ prompt: 'x', imageBuffer: INPUT, mimeType: 'image/jpeg', size: '512x512' })
    ).rejects.toMatchObject({ code: 'MISSING_CREDENTIALS' });

    await expect(
      editImage({ prompt: 'x', imageBuffer: INPUT, mimeType: 'image/jpeg', size: '512x512' })
    ).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/);

    // Provider berbasis URL dijelaskan kenapa tidak dipakai.
    await expect(
      editImage({ prompt: 'x', imageBuffer: INPUT, mimeType: 'image/jpeg', size: '512x512' })
    ).rejects.toThrow(/PUBLIC_BASE_URL/);

    // Tidak boleh ada request yang menembak provider dengan input yang tidak bisa diambil.
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('getEditProviderChain', () => {
  test('default mengikuti provider text-to-image yang tersedia', () => {
    configureCloudflare();
    process.env.PUBLIC_BASE_URL = 'https://app.example.com';

    expect(getEditProviderChain()).toEqual(['cloudflare', 'pollinations']);
  });

  test('tanpa PUBLIC_BASE_URL, provider berbasis URL tidak masuk rantai', () => {
    // Inilah kasus yang dulu menghasilkan "hasil edit" palsu: Pollinations tetap
    // membalas 200 saat URL input tidak terjangkau. Sekarang ia tidak dicoba sama
    // sekali, dan yang tersisa hanya provider yang menerima bytes gambar.
    expect(getEditProviderChain()).toEqual(['cloudflare']);
  });

  test('PUBLIC_BASE_URL publik mengaktifkan jalur Pollinations tanpa kredensial', () => {
    process.env.PUBLIC_BASE_URL = 'https://aplikasi-anda.example.com/';

    expect(getEditProviderChain()).toEqual(['pollinations']);
  });

  test('PUBLIC_BASE_URL yang menunjuk localhost/alamat privat tidak dianggap publik', () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-123';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
    process.env.PUBLIC_BASE_URL = 'http://localhost:4000';

    expect(getEditProviderChain()).toEqual(['cloudflare']);

    process.env.PUBLIC_BASE_URL = 'http://192.168.1.20:4000';
    expect(getEditProviderChain()).toEqual(['cloudflare']);
  });

  test('IMAGE_EDIT_FALLBACK_PROVIDER=none menyisakan satu provider', () => {
    configureCloudflare();
    process.env.IMAGE_EDIT_FALLBACK_PROVIDER = 'none';

    expect(getEditProviderChain()).toEqual(['cloudflare']);
  });

  test('provider yang tidak bisa mengedit gambar ditolak dengan jelas', () => {
    process.env.IMAGE_EDIT_PROVIDER = 'openai';

    expect(() => getEditProviderChain()).toThrow(/Unknown IMAGE_EDIT_PROVIDER "openai"/);
  });
});

describe('getProviderStatus', () => {
  test('melaporkan chain & ketersediaan tiap provider', () => {
    configureCloudflare();
    process.env.PUBLIC_BASE_URL = 'https://app.example.com';

    expect(getProviderStatus()).toEqual({
      chain: ['cloudflare', 'pollinations'],
      status: {
        bynara: 'missing',
        cloudflare: 'configured',
        pollinations: 'configured',
        openai: 'missing'
      },
      defaultPrimary: 'cloudflare',
      // Rantai untuk image-to-image terpisah, karena tidak semua provider bisa
      // mengedit gambar (OpenAI Images dan Bynara di sini belum dipakai untuk edit).
      editChain: ['cloudflare', 'pollinations'],
      editCapabilities: { bynara: false, cloudflare: true, pollinations: true, openai: false },
      editReady: true
    });
  });

  test('tanpa kredensial, image-to-image dilaporkan belum siap', () => {
    const status = getProviderStatus();

    expect(status.editChain).toEqual(['cloudflare']);
    expect(status.editReady).toBe(false);
  });
});
