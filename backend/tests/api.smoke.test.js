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
// Daftar voice diambil dari sumbernya, bukan disalin ke test: kalau daftarnya
// berubah, yang gagal adalah test ini — bukan user yang menemukan dropdown
// berisi voice milik provider lain.
const { VOICES_BY_PROVIDER } = require('../config/soundProviders');

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

  test('commit yang berjalan dilaporkan, termasuk di production', async () => {
    const asli = process.env.NODE_ENV;
    const sha = '56e1648641c4a7cd9a534f6339742021f319fc7c';
    process.env.RAILWAY_GIT_COMMIT_SHA = sha;

    try {
      // Di production blok `services` disembunyikan, jadi kalau penanda commit
      // ikut ditaruh di sana, langkah verifikasi deploy tidak akan pernah bisa
      // membandingkannya dengan commit yang di-push.
      process.env.NODE_ENV = 'production';
      const produksi = await request(app).get('/health');

      expect(produksi.body.commit).toBe(sha);
      expect(produksi.body.commitSource).toBe('railway-git');
      expect(produksi.body.services).toBeUndefined();
    } finally {
      delete process.env.RAILWAY_GIT_COMMIT_SHA;
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
      'SOUND_FALLBACK_PROVIDER',
      'GEMINI_API_KEY',
      'GEMINI_TTS_MODEL',
      'ELEVENLABS_API_KEY',
      'ELEVENLABS_MODEL',
      'ELEVENLABS_VOICE_ID',
      'OPENAI_TTS_MODEL',
      'STT_PROVIDER',
      'STT_FALLBACK_PROVIDER',
      'STT_DEFAULT_LANGUAGE',
      'GROQ_TRANSCRIBE_MODEL',
      'GEMINI_TRANSCRIBE_MODEL',
      'OPENAI_TRANSCRIBE_MODEL',
      // Provider video memakai BYNARA_API_KEY yang sama dengan text-to-image,
      // jadi kuncinya cukup dibersihkan di clearChatAndImageEnv; variabel khusus
      // fiturnya disimpan di sini supaya test bisa mengubahnya.
      'VIDEO_PROVIDER',
      'VIDEO_FALLBACK_PROVIDER',
      'VIDEO_MODEL',
      'BYNARA_VIDEO_MODEL',
      'BYNARA_VIDEO_BASE_URL',
      'VIDEO_RESOLUTION',
      'VIDEO_RATIO',
      'VIDEO_DURATION',
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

    /**
     * Bersihkan semua kredensial suara.
     *
     * Dipisah dari clearChatAndImageEnv karena test suara harus bisa berjalan di
     * mesin pengembang yang .env-nya sudah berisi GEMINI_API_KEY (dipakai fitur
     * chat juga) — tanpa ini provider utama yang terdeteksi berbeda-beda antar
     * mesin dan hasil testnya ikut berbeda.
     */
    const clearSoundEnv = () => {
      [
        'SOUND_PROVIDER',
        'SOUND_FALLBACK_PROVIDER',
        'GEMINI_API_KEY',
        'GEMINI_TTS_MODEL',
        'ELEVENLABS_API_KEY',
        'ELEVENLABS_MODEL',
        'ELEVENLABS_VOICE_ID',
        'OPENAI_TTS_MODEL',
        // Sound-to-text memakai ulang GROQ_API_KEY/GEMINI_API_KEY yang sudah
        // dibersihkan di atas; variabel khusus fiturnya ikut dibersihkan supaya
        // provider pertama yang dilaporkan tidak bergantung pada isi mesin.
        'STT_PROVIDER',
        'STT_FALLBACK_PROVIDER',
        'STT_DEFAULT_LANGUAGE',
        'GROQ_TRANSCRIBE_MODEL',
        'GEMINI_TRANSCRIBE_MODEL',
        'OPENAI_TRANSCRIBE_MODEL'
      ].forEach((key) => delete process.env[key]);
    };

    const clearChatAndImageEnv = () => {
      [
        'IMAGE_PROVIDER',
        'IMAGE_FALLBACK_PROVIDER',
        'CLOUDFLARE_ACCOUNT_ID',
        'CLOUDFLARE_API_TOKEN',
        'BYNARA_API_KEY',
        'BYNARA_BASE_URL',
        'BYNARA_IMAGE_MODEL',
        // Video memakai kunci yang sama, tetapi rantai & modelnya punya env
        // sendiri — ikut dibersihkan supaya blok `services` tidak berbeda
        // antara mesin pengembang dan CI.
        'BYNARA_VIDEO_MODEL',
        'BYNARA_VIDEO_BASE_URL',
        'VIDEO_PROVIDER',
        'VIDEO_FALLBACK_PROVIDER',
        'VIDEO_MODEL',
        'VIDEO_RESOLUTION',
        'VIDEO_RATIO',
        'VIDEO_DURATION',
        'CHAT_PROVIDER',
        'CHAT_FALLBACK_PROVIDER',
        'GROQ_API_KEY',
        'GEMINI_API_KEY',
        'OPENROUTER_API_KEY',
        'OPENROUTER_CHAT_MODEL',
        // OPENAI_API_KEY ikut dibersihkan: `backend/.env` di mesin pengembang
        // sering sudah berisi kunci ini (dipakai fitur chat, gambar, sekaligus
        // suara), dan begitu terisi ia menggeser provider chat utama serta
        // menandai provider openai sebagai `configured` — hasil test jadi
        // berbeda antara mesin lokal dan CI. Test yang memang ingin memeriksa
        // perilaku kunci ini mengisinya sendiri setelah pembersihan.
        'OPENAI_API_KEY',
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
        'PUBLIC_BASE_URL'
      ].forEach((key) => delete process.env[key]);

      // Kredensial suara juga dibersihkan: nilainya ikut menentukan isi blok
      // `services`, dan mesin pengembang bisa saja sudah mengisi GEMINI_API_KEY.
      clearSoundEnv();
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
      clearChatAndImageEnv();
      delete process.env.FIREBASE_SERVICE_ACCOUNT;

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
        // Text-to-sound: Gemini untuk suara Indonesia yang logatnya bisa
        // diarahkan lewat deskripsi gaya, dan Edge sebagai provider yang TIDAK
        // butuh kredensial sama sekali (suara neural Indonesia bawaan Microsoft)
        // — jadi tanpa kredensial apa pun fiturnya tetap siap, bukan mati.
        // ElevenLabs/OpenAI hanya dipakai bila kuncinya ada. Yang dilaporkan
        // sebagai provider utama adalah yang kredensialnya tersedia.
        soundProvider: 'edge',
        // 'none' di sini artinya rantainya hanya berisi satu provider: Edge
        // sudah menjadi cadangannya sendiri, jadi tidak ada provider kedua.
        soundFallback: 'none',
        soundProviders: {
          gemini: 'missing',
          elevenlabs: 'missing',
          openai: 'missing',
          edge: 'configured'
        },
        soundVoices: VOICES_BY_PROVIDER.edge.map((item) => item.value),
        soundReady: true,
        // Sound-to-text: TIDAK ADA provider transkripsi yang bisa dipakai tanpa
        // kredensial, jadi tanpa kunci apa pun provider utamanya tetap Groq
        // (yang paling mungkin diaktifkan) tetapi `ready` bernilai false —
        // berbeda dari soundReady yang selalu true berkat Edge.
        speechToTextProvider: 'groq',
        speechToTextFallback: 'gemini',
        speechToTextProviders: {
          groq: 'missing',
          gemini: 'missing',
          openai: 'missing'
        },
        speechToTextModels: {
          groq: 'whisper-large-v3',
          gemini: 'gemini-3.8-flash',
          openai: 'whisper-1'
        },
        speechToTextReady: false,
        // Video: sama seperti sound-to-text, TIDAK ada provider video yang bisa
        // dipakai tanpa kredensial. Provider utamanya tetap dilaporkan `bynara`
        // (satu-satunya yang ada) tetapi `ready` bernilai false.
        videoProvider: 'bynara',
        videoFallback: 'none',
        videoProviders: {
          bynara: 'missing'
        },
        videoModels: {
          bynara: 'agnes-video-v2.0'
        },
        videoReady: false,
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

    test('GROQ_API_KEY membuat sound-to-text siap dengan Whisper gratis', async () => {
      clearSoundEnv();
      process.env.GROQ_API_KEY = 'gsk-kunci-uji';

      const status = await services();

      expect(status.speechToTextProvider).toBe('groq');
      expect(status.speechToTextFallback).toBe('gemini');
      expect(status.speechToTextProviders.groq).toBe('configured');
      expect(status.speechToTextReady).toBe(true);
    });

    test('BYNARA_API_KEY membuat video siap dengan model Agnes Video', async () => {
      clearChatAndImageEnv();
      process.env.BYNARA_API_KEY = 'sk-nry-kunci-uji';

      const status = await services();

      expect(status.videoProvider).toBe('bynara');
      expect(status.videoProviders.bynara).toBe('configured');
      expect(status.videoModels.bynara).toBe('agnes-video-v2.0');
      expect(status.videoReady).toBe(true);
    });

    test('VIDEO_PROVIDER=none mematikan fitur video walau kuncinya ada', async () => {
      clearChatAndImageEnv();
      process.env.BYNARA_API_KEY = 'sk-nry-kunci-uji';
      process.env.VIDEO_PROVIDER = 'none';

      const status = await services();

      expect(status.videoProvider).toBe('none');
      expect(status.videoReady).toBe(false);
    });

    test('GEMINI_API_KEY saja membuat Gemini yang ditranskripsi, tanpa duplikat', async () => {
      clearSoundEnv();
      // GROQ_API_KEY ikut dibersihkan: test sebelumnya mengisinya, dan selama
      // masih ada, Groq-lah yang menjadi provider utama transkripsi.
      delete process.env.GROQ_API_KEY;
      process.env.GEMINI_API_KEY = 'gemini-kunci-uji';

      const status = await services();

      // Cadangan defaultnya Gemini juga, jadi rantainya hanya berisi satu nama.
      expect(status.speechToTextProvider).toBe('gemini');
      expect(status.speechToTextFallback).toBe('none');
      expect(status.speechToTextReady).toBe(true);
    });

    test('kunci MiMo yang tertinggal di .env tidak muncul di /health', async () => {
      clearSoundEnv();
      process.env.MIMO_API_KEY = 'mimo-kunci-uji';

      const status = await services();

      // Provider MiMo sudah dihapus dan kuncinya tidak dibaca lagi: yang
      // melayani halaman text-to-sound tetap Edge (suara Indonesia, tanpa kunci).
      expect(status.soundProvider).toBe('edge');
      expect(status.soundProviders.mimo).toBeUndefined();
      expect(status.soundReady).toBe(true);
      // 'none' di sini berarti rantainya hanya berisi satu provider: Edge sudah
      // menjadi cadangannya sendiri, jadi tidak ada provider kedua.
      expect(status.soundFallback).toBe('none');
    });

    test('GEMINI_API_KEY mendahulukan provider gratis bersuara Indonesia', async () => {
      clearSoundEnv();
      process.env.GEMINI_API_KEY = 'gemini-kunci-uji';

      const status = await services();

      expect(status.soundProvider).toBe('gemini');
      expect(status.soundProviders.gemini).toBe('configured');
      expect(status.soundReady).toBe(true);
      // Daftar voice ikut provider yang aktif — nama voice OpenAI tidak dikenal
      // Gemini, jadi daftar gabungan justru menawarkan nilai yang salah.
      expect(status.soundVoices).toContain('Kore');
      expect(status.soundVoices).not.toContain('Mia');
      expect(status.soundVoices).not.toContain('alloy');
    });

    test('kunci OpenAI tidak lagi mendahului provider gratis', async () => {
      clearSoundEnv();
      process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
      process.env.OPENAI_API_KEY = 'sk-kunci-uji';

      const status = await services();

      expect(status.soundProvider).toBe('gemini');
      expect(status.soundFallback).toBe('edge');
    });

    test('SOUND_FALLBACK_PROVIDER muncul di blok layanan', async () => {
      clearSoundEnv();
      process.env.GEMINI_API_KEY = 'gemini-kunci-uji';
      process.env.OPENAI_API_KEY = 'sk-kunci-uji';
      process.env.SOUND_FALLBACK_PROVIDER = 'openai';

      const status = await services();

      expect(status.soundProvider).toBe('gemini');
      expect(status.soundFallback).toBe('openai');
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
      // Konfigurasi chat di mesin pengembang bisa menggeser hasilnya: .env yang
      // berisi CHAT_PROVIDER, OPENAI_API_KEY, atau OPENROUTER_API_KEY membuat
      // provider utama/keadaan provider lain berbeda dari yang diharapkan test
      // ini. clearChatAndImageEnv membersihkan ketiganya; perilaku key-key itu
      // diuji di test tersendiri di bawah.
      clearChatAndImageEnv();

      process.env.GROQ_API_KEY = 'gsk-test';
      process.env.GEMINI_API_KEY = 'gemini-test';

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
      // Sama seperti di atas: provider utama di mesin pengembang tidak boleh
      // ikut menentukan hasil test ini.
      clearChatAndImageEnv();

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
  test('mendaftar endpoint media yang sudah tersedia', async () => {
    const response = await request(app).get('/api/v1/media/status');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.availableEndpoints).toEqual(
      expect.arrayContaining([
        'POST /api/v1/media/text-to-image',
        'POST /api/v1/media/text-to-sound',
        'POST /api/v1/media/sound-to-text',
        'POST /api/v1/media/text-to-video',
        'POST /api/v1/media/image-to-video',
        'GET /api/v1/media/video-options'
      ])
    );
    // Endpoint yang sudah ada tidak boleh ikut terdaftar sebagai "coming soon".
    ['text-to-sound', 'sound-to-text', 'text-to-video', 'image-to-video'].forEach((fitur) => {
      expect(response.body.comingSoonEndpoints).not.toEqual(
        expect.arrayContaining([`POST /api/v1/media/${fitur}`])
      );
    });
    // Seluruh kartu di Dashboard kini benar-benar aktif, jadi daftar rencananya
    // kosong — bukan berisi endpoint yang sebenarnya sudah jalan.
    expect(response.body.comingSoonEndpoints).toEqual([]);
  });
});

describe('route yang dilindungi auth', () => {
  test.each([
    ['get', '/api/v1/member/profile'],
    ['put', '/api/v1/member/profile'],
    ['get', '/api/v1/member/quota'],
    ['get', '/api/v1/member/referral-stats'],
    ['get', '/api/v1/admin/pending-members'],
    // Daftar galat menyebut uid user dan pesan internal server, jadi hanya admin
    // yang boleh membacanya — sama seperti endpoint admin yang lain.
    ['get', '/api/v1/admin/errors'],
    ['post', '/api/v1/media/text-to-image'],
    ['post', '/api/v1/media/text-to-sound'],
    ['post', '/api/v1/media/sound-to-text'],
    ['get', '/api/v1/media/transcribe-options'],
    ['post', '/api/v1/media/text-to-video'],
    ['post', '/api/v1/media/image-to-video'],
    ['get', '/api/v1/media/video-options'],
    ['get', '/api/v1/media/history'],
    ['get', '/api/v1/media/media_abc'],
    ['delete', '/api/v1/media/media_abc'],
    // Tautan baca-saja dibuat & dicabut oleh PEMILIKNYA, jadi keduanya ber-auth.
    // Yang publik hanyalah membuka tautannya (lihat test di bawah).
    ['post', '/api/v1/media/media_abc/share'],
    ['delete', '/api/v1/media/media_abc/share']
  ])('%s %s tanpa token ditolak 401', async (method, url) => {
    const response = await request(app)[method](url);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});

describe('tautan baca-saja', () => {
  test('token yang bentuknya jelas bukan token dijawab 404 sebagai JSON', async () => {
    // Dijawab tanpa menyentuh database, karena bentuknya sudah ditolak lebih
    // dulu — itu juga yang membuat test ini berjalan tanpa MongoDB.
    const response = await request(app).get('/api/v1/share/bukan-token');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(typeof response.body.message).toBe('string');
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
