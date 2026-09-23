/**
 * Test: provider video (config/videoProviders.js).
 *
 * Yang diuji di sini adalah hal-hal yang tidak bisa dilihat dari UI dan paling
 * sering salah: urutan rantai provider, pemilihan default, penerjemahan status
 * pekerjaan asinkron (nama status berbeda antar versi API), dan susunan kandidat
 * URL unduhan. Semua permintaan HTTP ke NaraRouter di-mock, jadi suite ini jalan
 * tanpa kredensial dan tanpa jaringan.
 */

const {
  generateVideo,
  getVideoChain,
  getVideoProviderStatus,
  getVideoOptions,
  getDuration,
  getResolution,
  getRatio,
  classifyJobStatus,
  bynaraDownloadCandidates,
  PROVIDERS,
  ALLOWED_RESOLUTIONS,
  ALLOWED_RATIOS,
  MAX_PROMPT_LENGTH,
  DEFAULT_BYNARA_VIDEO_MODEL
} = require('../config/videoProviders');

const TOUCHED_VARS = [
  'BYNARA_API_KEY',
  'BYNARA_VIDEO_MODEL',
  'BYNARA_VIDEO_BASE_URL',
  'BYNARA_VIDEO_DOWNLOAD_BASE_URL',
  'VIDEO_PROVIDER',
  'VIDEO_FALLBACK_PROVIDER',
  'VIDEO_MODEL',
  'VIDEO_RESOLUTION',
  'VIDEO_RATIO',
  'VIDEO_DURATION',
  'VIDEO_POLL_INTERVAL_MS',
  'VIDEO_JOB_TIMEOUT_MS',
  'VIDEO_REQUEST_TIMEOUT_MS'
];

const saveEnv = () => Object.fromEntries(TOUCHED_VARS.map((key) => [key, process.env[key]]));

const restoreEnv = (saved) => {
  TOUCHED_VARS.forEach((key) => {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  });
};

let saved;

beforeEach(() => {
  saved = saveEnv();
  TOUCHED_VARS.forEach((key) => delete process.env[key]);
  // Interval polling dipendekkan supaya test tidak benar-benar menunggu 5 detik
  // per putaran — perilaku produksinya tetap sama.
  process.env.VIDEO_POLL_INTERVAL_MS = '1';
});

afterEach(() => {
  restoreEnv(saved);
  jest.restoreAllMocks();
});

/** Balasan HTTP tiruan yang cukup lengkap untuk kode di videoProviders. */
const jsonResponse = (body, { status = 200, ok = true } = {}) => ({
  ok,
  status,
  statusText: ok ? 'OK' : 'ERR',
  text: async () => JSON.stringify(body),
  arrayBuffer: async () => Buffer.from(JSON.stringify(body))
});

const bufferResponse = (buffer, { status = 200, ok = true } = {}) => ({
  ok,
  status,
  statusText: ok ? 'OK' : 'ERR',
  text: async () => '',
  arrayBuffer: async () => buffer
});

const MP4 = Buffer.from('00000018667479706d703432', 'hex');

describe('getVideoChain', () => {
  test('tanpa env: provider utama adalah bynara dan tanpa cadangan', () => {
    expect(getVideoChain()).toEqual(['bynara']);
  });

  test('VIDEO_PROVIDER=none mematikan fiturnya', () => {
    process.env.VIDEO_PROVIDER = 'none';
    expect(getVideoChain()).toEqual([]);
  });

  test('nama provider yang tidak dikenal ditolak dengan kode konfigurasi', () => {
    process.env.VIDEO_PROVIDER = 'runway';

    expect(() => getVideoChain()).toThrow(/Unknown VIDEO_PROVIDER/);
    try {
      getVideoChain();
    } catch (error) {
      expect(error.code).toBe('INVALID_PROVIDER_CONFIG');
    }
  });

  test('cadangan ditolak kalau namanya tidak dikenal, dan `none` mematikannya', () => {
    process.env.VIDEO_FALLBACK_PROVIDER = 'seedance';
    expect(() => getVideoChain()).toThrow(/Unknown VIDEO_FALLBACK_PROVIDER/);

    process.env.VIDEO_FALLBACK_PROVIDER = 'none';
    expect(getVideoChain()).toEqual(['bynara']);
  });

  test('cadangan yang sama dengan provider utama tidak diduplikasi', () => {
    process.env.VIDEO_FALLBACK_PROVIDER = 'bynara';
    expect(getVideoChain()).toEqual(['bynara']);
  });
});

describe('getVideoProviderStatus', () => {
  test('tanpa kunci: bynara missing dan ready false', () => {
    expect(getVideoProviderStatus()).toEqual({
      chain: ['bynara'],
      status: { bynara: 'missing' },
      models: { bynara: DEFAULT_BYNARA_VIDEO_MODEL },
      ready: false,
      modes: ['t2v', 'i2v']
    });
  });

  test('BYNARA_API_KEY membuat fiturnya siap', () => {
    process.env.BYNARA_API_KEY = 'sk-nry-uji';
    expect(getVideoProviderStatus().ready).toBe(true);
  });

  test('nilai placeholder tidak dianggap konfigurasi valid', () => {
    process.env.BYNARA_API_KEY = 'sk-nry-...';
    expect(getVideoProviderStatus().status.bynara).toBe('missing');
  });
});

describe('opsi & default', () => {
  test('getVideoOptions melaporkan mode, resolusi, dan batas prompt', () => {
    const opsi = getVideoOptions();

    expect(opsi.provider).toBe('bynara');
    expect(opsi.model).toBe(DEFAULT_BYNARA_VIDEO_MODEL);
    expect(opsi.modes).toEqual(['t2v', 'i2v']);
    expect(opsi.resolutions).toEqual(ALLOWED_RESOLUTIONS);
    expect(opsi.ratios).toEqual(ALLOWED_RATIOS);
    expect(opsi.maxPromptLength).toBe(MAX_PROMPT_LENGTH);
    expect(opsi.mimeType).toBe('video/mp4');
  });

  test('480p tidak pernah ditawarkan — providernya hanya mendukung 720p/1080p', () => {
    process.env.VIDEO_RESOLUTION = '480p';
    // Nilai yang tidak didukung diabaikan, bukan diteruskan lalu gagal di provider.
    expect(getResolution()).toBe('720p');
    expect(getVideoOptions().resolutions).not.toContain('480p');
  });

  test('seluruh rentang 3-15 detik ditawarkan sebagai pilihan', () => {
    expect(getVideoOptions().durations).toEqual(
      [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );
    expect(getVideoOptions().minDuration).toBe(3);
    expect(getVideoOptions().maxDuration).toBe(15);
  });

  test('default durasi lima detik dan bisa diubah lewat env', () => {
    expect(getDuration()).toBe(5);

    process.env.VIDEO_DURATION = '10';
    expect(getDuration()).toBe(10);
    // Mengubah env hanya menggeser nilai awal, bukan memangkas pilihannya.
    expect(getVideoOptions().durations).toHaveLength(13);

    // Di luar jangkauan provider: dijepit ke batas yang sah.
    process.env.VIDEO_DURATION = '120';
    expect(getDuration()).toBe(15);
    process.env.VIDEO_DURATION = '1';
    expect(getDuration()).toBe(3);
  });

  test('bentuk gambar yang tidak dikenal jatuh kembali ke 16:9', () => {
    process.env.VIDEO_RATIO = '7:3';
    expect(getRatio()).toBe('16:9');
  });
});

describe('classifyJobStatus', () => {
  test('menerima semua nama status yang dipakai versi API berbeda', () => {
    ['pending', 'queued', 'in_progress', 'running'].forEach((status) => {
      expect(classifyJobStatus(status)).toBe('pending');
    });

    ['succeeded', 'completed', 'done'].forEach((status) => {
      expect(classifyJobStatus(status)).toBe('completed');
    });

    ['failed', 'cancelled', 'expired'].forEach((status) => {
      expect(classifyJobStatus(status)).toBe('failed');
    });
  });

  test('status yang tidak dikenal dianggap masih berjalan, bukan gagal', () => {
    // Job yang benar-benar gagal berhenti sendiri lewat batas waktu; menebak
    // "gagal" di sini justru membuang job yang sedang berjalan.
    expect(classifyJobStatus('')).toBe('pending');
    expect(classifyJobStatus('warming-up')).toBe('pending');
  });
});

describe('bynaraDownloadCandidates', () => {
  test('path relatif dicoba di host video lalu host router', () => {
    expect(bynaraDownloadCandidates('/v1/videos/abc/download')).toEqual([
      'https://api-images.bynara.id/v1/videos/abc/download',
      'https://router.bynara.id/v1/videos/abc/download'
    ]);
  });

  test('URL absolut dipakai apa adanya', () => {
    expect(bynaraDownloadCandidates('https://cdn.example.com/a.mp4')).toEqual([
      'https://cdn.example.com/a.mp4'
    ]);
  });

  test('host unduhan bisa diarahkan lewat env dan didahulukan', () => {
    process.env.BYNARA_VIDEO_DOWNLOAD_BASE_URL = 'https://unduh.example.com';

    expect(bynaraDownloadCandidates('/v1/videos/abc/download')[0]).toBe(
      'https://unduh.example.com/v1/videos/abc/download'
    );
  });
});

describe('generateVideo', () => {
  const okFetch = () => {
    let polling = 0;

    return jest.fn(async (url, options) => {
      const target = String(url);

      if (target.endsWith('/videos') && options?.method === 'POST') {
        return jsonResponse({ id: 'job-1', status: 'pending', created: 1 }, { status: 202 });
      }

      if (target.includes('/videos/job-1') && !target.includes('/download')) {
        polling += 1;
        // Dua putaran `pending` lebih dulu: memastikan polling-nya benar-benar
        // diulang, bukan hanya membaca satu balasan lalu selesai.
        return jsonResponse(
          polling < 2
            ? { id: 'job-1', status: 'pending' }
            : {
                id: 'job-1',
                status: 'succeeded',
                url: '/v1/videos/job-1/download',
                duration: 5
              }
        );
      }

      if (target.includes('/download')) return bufferResponse(MP4);

      throw new Error(`permintaan tak terduga: ${target}`);
    });
  };

  test('text-to-video: buat, poll sampai selesai, lalu unduh MP4-nya', async () => {
    process.env.BYNARA_API_KEY = 'sk-nry-uji';
    global.fetch = okFetch();

    const hasil = await generateVideo({ prompt: 'kucing berlari', mode: 't2v' });

    expect(hasil.provider).toBe('bynara');
    expect(hasil.model).toBe(DEFAULT_BYNARA_VIDEO_MODEL);
    expect(hasil.format).toBe('mp4');
    expect(hasil.mimeType).toBe('video/mp4');
    expect(hasil.jobId).toBe('job-1');
    expect(hasil.duration).toBe(5);
    expect(hasil.buffer.equals(MP4)).toBe(true);
    expect(hasil.attempts).toEqual([]);

    // Permintaan pembuatannya JSON (mode t2v), bukan multipart.
    const [, opsi] = global.fetch.mock.calls[0];
    expect(JSON.parse(opsi.body)).toEqual({
      model: DEFAULT_BYNARA_VIDEO_MODEL,
      prompt: 'kucing berlari',
      mode: 't2v',
      resolution: '720p',
      ratio: '16:9',
      duration: 5
    });
  });

  test('image-to-video: gambar pertama dikirim sebagai multipart', async () => {
    process.env.BYNARA_API_KEY = 'sk-nry-uji';
    global.fetch = okFetch();

    const hasil = await generateVideo({
      prompt: 'gambar ini bergerak',
      mode: 'i2v',
      imageBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mimeType: 'image/png'
    });

    expect(hasil.buffer.equals(MP4)).toBe(true);

    const [, opsi] = global.fetch.mock.calls[0];
    // FormData: body-nya bukan string JSON, dan Content-Type diserahkan ke fetch
    // supaya boundary multipart-nya benar.
    expect(typeof opsi.body).not.toBe('string');
    expect(opsi.headers['Content-Type']).toBeUndefined();
    expect(opsi.body.get('mode')).toBe('i2v');
    expect(opsi.body.get('image')).toBeInstanceOf(Blob);
  });

  test('tanpa kredensial: gagal dengan kode MISSING_CREDENTIALS tanpa memanggil jaringan', async () => {
    global.fetch = jest.fn();

    await expect(generateVideo({ prompt: 'apa saja', mode: 't2v' })).rejects.toMatchObject({
      code: 'MISSING_CREDENTIALS'
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('kredensial ditolak diteruskan apa adanya sebagai galat konfigurasi', async () => {
    process.env.BYNARA_API_KEY = 'sk-nry-salah';
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: { type: 'unauthorized' } }, { status: 401, ok: false }));

    let error;
    try {
      await generateVideo({ prompt: 'apa saja', mode: 't2v' });
    } catch (e) {
      error = e;
    }

    // Sengaja BUKAN pesan ramah: kunci yang salah harus terlihat apa adanya,
    // bukan disamarkan menjadi "coba lagi".
    expect(error.code).toBe('INVALID_PROVIDER_CONFIG');
    expect(error.message).toMatch(/HTTP 401/);
  });

  test('pekerjaan yang gagal ditutup dengan pesan dari provider', async () => {
    process.env.BYNARA_API_KEY = 'sk-nry-uji';
    global.fetch = jest.fn(async (url, options) => {
      if (options?.method === 'POST') {
        return jsonResponse({ id: 'job-9', status: 'pending' }, { status: 202 });
      }

      return jsonResponse({ id: 'job-9', status: 'failed', error: { message: 'content policy' } });
    });

    await expect(generateVideo({ prompt: 'apa saja', mode: 't2v' })).rejects.toThrow(
      /content policy/
    );
  });

  test('pekerjaan yang menggantung berakhir sebagai timeout, bukan menunggu selamanya', async () => {
    process.env.BYNARA_API_KEY = 'sk-nry-uji';
    process.env.VIDEO_JOB_TIMEOUT_MS = '30';

    global.fetch = jest.fn(async (url, options) => {
      if (options?.method === 'POST') {
        return jsonResponse({ id: 'job-2', status: 'pending' }, { status: 202 });
      }
      return jsonResponse({ id: 'job-2', status: 'pending' });
    });

    await expect(generateVideo({ prompt: 'apa saja', mode: 't2v' })).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT'
    });
  });

  test('mode yang tidak didukung provider tidak dicoba sama sekali', async () => {
    process.env.BYNARA_API_KEY = 'sk-nry-uji';
    const asli = PROVIDERS.bynara.supportedModes;
    PROVIDERS.bynara.supportedModes = ['t2v'];
    global.fetch = okFetch();

    try {
      await expect(generateVideo({ prompt: 'x', mode: 'i2v' })).rejects.toThrow(
        /mode i2v is not supported/
      );
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      PROVIDERS.bynara.supportedModes = asli;
    }
  });

  test('VIDEO_PROVIDER=none dijawab sebagai galat konfigurasi', async () => {
    process.env.VIDEO_PROVIDER = 'none';
    global.fetch = jest.fn();

    await expect(generateVideo({ prompt: 'x', mode: 't2v' })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_CONFIG'
    });
  });
});
