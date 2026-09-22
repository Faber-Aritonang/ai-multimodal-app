/**
 * Test: smoke test HTTP endpoint.
 * App di-require tanpa menyalakan server/koneksi DB (lihat server.js),
 * sehingga test bisa jalan di CI tanpa kredensial apa pun.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Folder upload khusus test, harus di-set sebelum server.js di-require
// karena express.static membaca env ini saat mounting.
const tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-uploads-'));
process.env.UPLOAD_DIR = tempUploadDir;

const request = require('supertest');
const { app } = require('../server');

afterAll(() => {
  fs.rmSync(tempUploadDir, { recursive: true, force: true });
});

describe('GET /health', () => {
  test('mengembalikan status OK dan kondisi database', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('OK');
    expect(response.body.database).toBe('disconnected');
    expect(typeof response.body.timestamp).toBe('string');
  });

  test('mode penyimpanan selalu dilaporkan, termasuk di production', async () => {
    const asli = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = 'production';
      const produksi = await request(app).get('/health');

      // Tanpa ini, "gambar hilang tiap deploy" hanya bisa diketahui dari keluhan
      // user — persis yang terjadi sebelum mode cloudinary dipasang.
      expect(produksi.body.storageMode).toBe('local');
      expect(produksi.body.services).toBeUndefined();

      process.env.NODE_ENV = 'test';
      const dev = await request(app).get('/health');

      expect(dev.body.storageMode).toBe('local');
    } finally {
      if (asli === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = asli;
    }
  });

  test('kredensial Cloudinary yang lengkap terlihat sebagai mode cloudinary', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'uji-cloud';
    process.env.CLOUDINARY_API_KEY = 'kunci-uji';
    process.env.CLOUDINARY_API_SECRET = 'rahasia-uji';

    const response = await request(app).get('/health');

    expect(response.body.storageMode).toBe('cloudinary');
    // Tiga variabel terpisah dilaporkan sebagai sumbernya, supaya kegagalan yang
    // penyebabnya "nilainya dibaca dari tempat yang berbeda" bisa dibedakan dari
    // luar tanpa membuka dashboard.
    expect(response.body.storageCredentialSource).toBe('vars');

    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  test('CLOUDINARY_URL saja dilaporkan sebagai sumber kredensialnya', async () => {
    process.env.CLOUDINARY_URL = 'cloudinary://kunci-uji:rahasia-uji@uji-cloud';

    const response = await request(app).get('/health');

    expect(response.body.storageMode).toBe('cloudinary');
    expect(response.body.storageCredentialSource).toBe('url');
    // Nilainya sendiri tidak pernah ikut dilaporkan.
    expect(JSON.stringify(response.body)).not.toContain('rahasia-uji');

    delete process.env.CLOUDINARY_URL;
  });

  test('CLOUDINARY_URL yang salah bentuk terlihat sebagai url-invalid, bukan local', async () => {
    // Tanpa pembedaan ini, satu titik dua berlebih di nilai variabel membuat
    // produksi menulis gambar ke filesystem container — dan `/health` cuma
    // melaporkan `local` tanpa cara mengetahui sebabnya dari luar.
    process.env.CLOUDINARY_URL = 'cloudinary://kunci-uji:rahasia-uji@';

    const response = await request(app).get('/health');

    expect(response.body.storageMode).toBe('cloudinary');
    expect(response.body.storageCredentialSource).toBe('url-invalid');

    delete process.env.CLOUDINARY_URL;
  });

  describe('status konfigurasi layanan', () => {
    const TOUCHED_VARS = [
      'FIREBASE_SERVICE_ACCOUNT',
      'OPENAI_API_KEY',
      'NODE_ENV',
      'IMAGE_PROVIDER',
      'IMAGE_FALLBACK_PROVIDER',
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN',
      'BYNARA_API_KEY',
      'BYNARA_BASE_URL',
      'BYNARA_IMAGE_MODEL',
      'CHAT_PROVIDER',
      'CHAT_FALLBACK_PROVIDER',
      'GROQ_API_KEY',
      'GEMINI_API_KEY',
      'OPENROUTER_API_KEY',
      'OPENROUTER_CHAT_MODEL',
      'IMAGE_EDIT_PROVIDER',
      'IMAGE_EDIT_FALLBACK_PROVIDER',
      'PUBLIC_BASE_URL',
      'SOUND_PROVIDER',
      'MIMO_API_KEY',
      'MIMO_BASE_URL',
      'MIMO_TTS_MODEL',
      'MIMO_TTS_VOICEDESIGN_MODEL',
      'MIMO_TTS_OPTIMIZE_TEXT',
      'STORAGE_PROVIDER',
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_PUBLIC_BASE_URL',
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET'
    ];

    const clearChatAndImageEnv = () => {
      [
        'IMAGE_PROVIDER',
        'IMAGE_FALLBACK_PROVIDER',
        'CLOUDFLARE_ACCOUNT_ID',
        'CLOUDFLARE_API_TOKEN',
        'BYNARA_API_KEY',
        'BYNARA_BASE_URL',
        'BYNARA_IMAGE_MODEL',
        'CHAT_PROVIDER',
        'CHAT_FALLBACK_PROVIDER',
        'GROQ_API_KEY',
        'GEMINI_API_KEY',
        'OPENROUTER_API_KEY',
        'OPENROUTER_CHAT_MODEL',
        // Penyimpanan juga dibersihkan: nilainya ikut muncul di /health, dan
        // test bisa berjalan di mesin yang env-nya sudah berisi kredensial S3.
        'STORAGE_PROVIDER',
        'S3_ENDPOINT',
        'S3_BUCKET',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'S3_PUBLIC_BASE_URL',
        'IMAGE_EDIT_PROVIDER',
        'IMAGE_EDIT_FALLBACK_PROVIDER',
        'PUBLIC_BASE_URL',
        // Kredensial suara juga dibersihkan: nilainya ikut menentukan isi blok
        // `services`, dan mesin pengembang bisa saja sudah mengisi MIMO_API_KEY.
        'SOUND_PROVIDER',
        'MIMO_API_KEY',
        'MIMO_BASE_URL',
        'MIMO_TTS_MODEL',
        'MIMO_TTS_VOICEDESIGN_MODEL',
        'MIMO_TTS_OPTIMIZE_TEXT'
      ].forEach((key) => delete process.env[key]);
    };

    let saved;

    beforeEach(() => {
      saved = Object.fromEntries(TOUCHED_VARS.map((key) => [key, process.env[key]]));
    });

    afterEach(() => {
      TOUCHED_VARS.forEach((key) => {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      });
    });

    const services = async () => (await request(app).get('/health')).body.services;

    test('tanpa kredensial keduanya dilaporkan missing', async () => {
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
      delete process.env.OPENAI_API_KEY;
      clearChatAndImageEnv();

      // Tanpa kredensial apa pun provider gambar tetap tersedia lewat
      // Pollinations, jadi fitur text-to-image tidak pernah mati total.
      // Chat sebaliknya: butuh minimal satu API key.
      expect(await services()).toEqual({
        firebase: 'missing',
        openai: 'missing',
        chatProvider: 'groq',
        chatProviders: {
          groq: 'missing',
          gemini: 'missing',
          openai: 'missing',
          openrouter: 'missing'
        },
        imageProvider: 'pollinations',
        imageFallback: 'none',
        imageProviders: {
          bynara: 'missing',
          cloudflare: 'missing',
          pollinations: 'configured',
          openai: 'missing'
        },
        // Tanpa kredensial apa pun tidak ada provider edit yang siap: hanya
        // Bynara dan Cloudflare yang bisa mengedit, dan keduanya butuh kunci.
        // Pollinations sengaja tidak dipakai untuk image-to-image.
        imageEditProvider: 'bynara',
        imageEditFallback: 'cloudflare',
        imageEditReady: false,
        imageEditCapabilities: {
          bynara: true,
          cloudflare: true,
          pollinations: false,
          openai: false
        },
        // Text-to-sound hanya punya satu provider (MiMo TTS), dan tanpa
        // MIMO_API_KEY halaman /tools/text-to-sound harus melaporkan belum siap
        // alih-alih menawarkan tombol yang pasti gagal.
        soundProvider: 'mimo',
        soundProviders: { mimo: 'missing' },
        soundReady: false,
        // Tanpa kredensial penyimpanan apa pun, berkas disimpan lokal. Di produksi
        // nilainya harus `cloudinary` atau `s3`, karena filesystem container
        // Railway hilang tiap deploy.
        storage: {
          mode: 'local',
          bucket: null,
          cloudName: null,
          publicBaseUrl: null,
          // Dari mana kredensial Cloudinary dibaca. `null` di mode lokal karena
          // tidak ada kredensial yang dibaca. Nilainya adalah NAMA variabel
          // ('url' | 'vars'), bukan nilainya — dan itulah yang membedakan dua
          // konfigurasi yang berperilaku sama saat benar tetapi berbeda saat salah.
          credentialSource: null
        },
        devLogin: 'enabled'
      });
    });

    test('MIMO_API_KEY membuat text-to-sound siap dipakai', async () => {
      process.env.MIMO_API_KEY = 'mimo-kunci-uji';

      const status = await services();

      expect(status.soundProvider).toBe('mimo');
      expect(status.soundProviders.mimo).toBe('configured');
      expect(status.soundReady).toBe(true);
    });

    test('kredensial Cloudflare mengaktifkan image-to-image lewat FLUX.2 [klein]', async () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-123';
      process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
      delete process.env.BYNARA_API_KEY;
      delete process.env.IMAGE_PROVIDER;
      delete process.env.IMAGE_EDIT_PROVIDER;
      delete process.env.IMAGE_EDIT_FALLBACK_PROVIDER;

      const status = await services();

      expect(status.imageEditProvider).toBe('cloudflare');
      expect(status.imageEditReady).toBe(true);
      expect(status.imageEditCapabilities.cloudflare).toBe(true);
    });

    test('BYNARA_API_KEY menjadikan Bynara provider edit utama', async () => {
      process.env.BYNARA_API_KEY = 'sk-nry-uji';
      delete process.env.IMAGE_EDIT_PROVIDER;
      delete process.env.IMAGE_EDIT_FALLBACK_PROVIDER;

      const status = await services();

      expect(status.imageEditProvider).toBe('bynara');
      expect(status.imageEditFallback).toBe('cloudflare');
      expect(status.imageEditReady).toBe(true);
    });

    test('PUBLIC_BASE_URL tidak lagi menambahkan Pollinations ke rantai edit', async () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-123';
      process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
      process.env.PUBLIC_BASE_URL = 'https://aplikasi.example.com';
      delete process.env.BYNARA_API_KEY;
      delete process.env.IMAGE_EDIT_PROVIDER;

      const status = await services();

      expect(status.imageEditProvider).toBe('cloudflare');
      expect(status.imageEditFallback).toBe('none');
      expect(status.imageEditCapabilities.pollinations).toBe(false);
    });

    test('kredensial Cloudflare membuatnya menjadi provider gambar utama', async () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-123';
      process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
      delete process.env.IMAGE_PROVIDER;
      delete process.env.IMAGE_FALLBACK_PROVIDER;
      // Kunci bynara milik mesin pengembang (dari .env) tidak boleh membuat test
      // ini gagal — bynara memang didahulukan saat kuncinya ada.
      delete process.env.BYNARA_API_KEY;

      const status = await services();

      expect(status.imageProvider).toBe('cloudflare');
      expect(status.imageFallback).toBe('pollinations');
      expect(status.imageProviders.cloudflare).toBe('configured');
    });

    test('GROQ_API_KEY membuat Groq menjadi provider chat utama', async () => {
      process.env.GROQ_API_KEY = 'gsk-test';
      process.env.GEMINI_API_KEY = 'gemini-test';
      // Kredensial OpenRouter milik mesin pengembang (dari .env) tidak boleh
      // membuat test ini gagal — perilakunya diuji di test tersendiri di bawah.
      delete process.env.OPENROUTER_API_KEY;

      const status = await services();

      expect(status.chatProvider).toBe('groq');
      expect(status.chatProviders).toEqual({
        groq: 'configured',
        gemini: 'configured',
        openai: 'missing',
        openrouter: 'missing'
      });
    });

    test('OPENROUTER_API_KEY menambah cadangan tanpa menggeser provider utama', async () => {
      process.env.GROQ_API_KEY = 'gsk-test';
      process.env.OPENROUTER_API_KEY = 'sk-or-test';

      const status = await services();

      expect(status.chatProvider).toBe('groq');
      expect(status.chatProviders.openrouter).toBe('configured');
    });

    test('path service account yang filenya tidak ada -> missing', async () => {
      process.env.FIREBASE_SERVICE_ACCOUNT = './config/berkas-tidak-ada.json';

      expect((await services()).firebase).toBe('missing');
    });

    test('JSON service account dianggap configured', async () => {
      process.env.FIREBASE_SERVICE_ACCOUNT = '{"type":"service_account"}';

      expect((await services()).firebase).toBe('configured');
    });

    test('nilai placeholder tidak dianggap sebagai konfigurasi valid', async () => {
      process.env.OPENAI_API_KEY = 'sk-your-openai-key-here';

      expect((await services()).openai).toBe('missing');
    });

    test('status layanan tidak dibocorkan di production', async () => {
      process.env.NODE_ENV = 'production';

      expect(await services()).toBeUndefined();
    });
  });
});

describe('GET /api/v1/media/status', () => {
  test('mendaftar endpoint media yang sudah dan belum tersedia', async () => {
    const response = await request(app).get('/api/v1/media/status');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.availableEndpoints).toEqual(
      expect.arrayContaining([
        'POST /api/v1/media/text-to-image',
        'POST /api/v1/media/text-to-sound'
      ])
    );
    // Endpoint yang sudah ada tidak boleh ikut terdaftar sebagai "coming soon".
    expect(response.body.comingSoonEndpoints).not.toEqual(
      expect.arrayContaining(['POST /api/v1/media/text-to-sound'])
    );
    expect(response.body.comingSoonEndpoints).toEqual(
      expect.arrayContaining(['POST /api/v1/media/text-to-video'])
    );
  });
});

describe('route yang dilindungi auth', () => {
  test.each([
    ['get', '/api/v1/member/profile'],
    ['get', '/api/v1/member/quota'],
    ['get', '/api/v1/member/referral-stats'],
    ['get', '/api/v1/admin/pending-members'],
    ['post', '/api/v1/media/text-to-image'],
    ['post', '/api/v1/media/text-to-sound'],
    ['get', '/api/v1/media/history'],
    ['delete', '/api/v1/media/media_abc']
  ])('%s %s tanpa token ditolak 401', async (method, url) => {
    const response = await request(app)[method](url);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});

describe('penyajian file media', () => {
  test('GET /uploads/:file menyajikan file hasil generate', async () => {
    const fileName = 'media_smoke_test.png';
    fs.writeFileSync(path.join(tempUploadDir, fileName), 'fake-image');

    const response = await request(app).get(`/uploads/${fileName}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/image\/png/);
  });

  test('file yang tidak ada mengembalikan 404', async () => {
    const response = await request(app).get('/uploads/tidak-ada.png');

    expect(response.status).toBe(404);
  });
});
