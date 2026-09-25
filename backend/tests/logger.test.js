/**
 * Test: logger terstruktur (config/logger.js).
 *
 * Yang dijaga di sini bukan soal "apakah bisa menulis", melainkan janji-janji
 * yang membuatnya berguna saat produksi bermasalah:
 *   - bentuk JSON-nya bisa diparsing (kalau tidak, panel log tidak punya kolom);
 *   - level benar-benar menyaring, dan galat masuk ke stderr;
 *   - `Error` tidak berubah jadi `{}` (stack trace-nya adalah informasi utama);
 *   - logger TIDAK PERNAH melempar, walau nilainya melingkar atau tidak bisa
 *     diserialisasi — logger yang melempar akan mengubah bug kecil jadi 500.
 */

const { logger, LEVELS, ambilBatas, ambilFormat } = require('../config/logger');

/** Jalankan `fn` sambil merekam apa yang ditulis ke stdout & stderr. */
const rekam = (fn) => {
  const keluar = [];
  const galat = [];
  const stdoutAsli = process.stdout.write;
  const stderrAsli = process.stderr.write;

  process.stdout.write = (chunk) => {
    keluar.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    galat.push(String(chunk));
    return true;
  };

  try {
    fn();
  } finally {
    process.stdout.write = stdoutAsli;
    process.stderr.write = stderrAsli;
  }

  return { keluar, galat };
};

const env = {
  LOG_FORMAT: process.env.LOG_FORMAT,
  LOG_LEVEL: process.env.LOG_LEVEL,
  NODE_ENV: process.env.NODE_ENV,
  SERVICE_NAME: process.env.SERVICE_NAME
};

afterEach(() => {
  for (const [kunci, nilai] of Object.entries(env)) {
    if (nilai === undefined) delete process.env[kunci];
    else process.env[kunci] = nilai;
  }
});

describe('format keluaran', () => {
  test('bawaan di luar production adalah teks yang enak dibaca', () => {
    delete process.env.LOG_FORMAT;
    process.env.NODE_ENV = 'test';

    expect(ambilFormat()).toBe('text');

    const { keluar } = rekam(() => logger.info('halo', { a: 1 }));

    expect(keluar.join('')).toContain('halo');
    expect(keluar.join('')).toContain('a=1');
  });

  test('bawaan di production adalah JSON satu baris', () => {
    delete process.env.LOG_FORMAT;
    process.env.NODE_ENV = 'production';

    expect(ambilFormat()).toBe('json');

    const { keluar } = rekam(() => logger.info('halo', { a: 1 }));
    const baris = JSON.parse(keluar.join('').trim());

    expect(baris).toMatchObject({ level: 'info', message: 'halo', a: 1 });
    expect(typeof baris.time).toBe('string');
    expect(typeof baris.service).toBe('string');
  });

  test('LOG_FORMAT menimpa perilaku bawaan', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_FORMAT = 'text';

    expect(ambilFormat()).toBe('text');
  });

  test('LOG_FORMAT yang tidak dikenal diabaikan, bukan membuat semua log hilang', () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_FORMAT = 'yaml';

    expect(ambilFormat()).toBe('text');
  });
});

describe('level', () => {
  test('bawaan di luar production adalah debug (semua terlihat)', () => {
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'test';

    expect(ambilBatas()).toBe(LEVELS.debug);
  });

  test('LOG_LEVEL=warn membuang debug & info', () => {
    process.env.LOG_LEVEL = 'warn';

    const { keluar } = rekam(() => {
      logger.debug('debug-tidak-tampak');
      logger.info('info-tidak-tampak');
      logger.warn('warn-tampak');
    });
    const teks = keluar.join('');

    expect(teks).not.toContain('debug-tidak-tampak');
    expect(teks).not.toContain('info-tidak-tampak');
    expect(teks).toContain('warn-tampak');
  });

  test('galat ditulis ke stderr supaya bisa disaring dari arus request biasa', () => {
    process.env.LOG_LEVEL = 'debug';

    const { keluar, galat } = rekam(() => {
      logger.info('biasa');
      logger.error('parah');
    });

    expect(keluar.join('')).toContain('biasa');
    expect(keluar.join('')).not.toContain('parah');
    expect(galat.join('')).toContain('parah');
  });

  test('LOG_LEVEL yang tidak dikenal diabaikan', () => {
    process.env.LOG_LEVEL = 'loud';
    process.env.NODE_ENV = 'test';

    expect(ambilBatas()).toBe(LEVELS.debug);
  });
});

describe('nilai yang dicatat', () => {
  test('Error diserialisasi utuh, bukan menjadi {}', () => {
    process.env.LOG_FORMAT = 'json';

    const galat = new Error('provider menolak');
    const { galat: stderr } = rekam(() => logger.error('gagal', { error: galat }));
    const baris = JSON.parse(stderr.join('').trim());

    expect(baris.error.message).toBe('provider menolak');
    expect(baris.error.stack).toContain('provider menolak');
  });

  test('stack trace juga muncul di format teks', () => {
    process.env.LOG_FORMAT = 'text';

    const { galat } = rekam(() => logger.error('gagal', { error: new Error('jejak') }));

    expect(galat.join('')).toContain('jejak');
  });

  test('nilai undefined dibuang, supaya kolom yang tidak berlaku tidak jadi null', () => {
    process.env.LOG_FORMAT = 'json';

    const { keluar } = rekam(() => logger.info('halo', { ada: 1, kosong: undefined }));
    const baris = JSON.parse(keluar.join('').trim());

    expect(baris.ada).toBe(1);
    expect('kosong' in baris).toBe(false);
  });

  test('nilai melingkar tidak membuat logger melempar', () => {
    process.env.LOG_FORMAT = 'json';

    const melingkar = {};
    melingkar.diri = melingkar;

    const { keluar } = rekam(() => {
      expect(() => logger.info('halo', { melingkar })).not.toThrow();
    });

    expect(keluar.join('')).toContain('halo');
  });

  test('pesan dan nilai panjang dipotong', () => {
    process.env.LOG_FORMAT = 'json';

    const { keluar } = rekam(() => logger.info('x'.repeat(2000), { data: 'y'.repeat(5000) }));
    const baris = JSON.parse(keluar.join('').trim());

    expect(baris.message.length).toBeLessThan(600);
    expect(baris.data.length).toBeLessThan(5000);
  });

  test('BigInt tidak membuat serialisasi gagal', () => {
    process.env.LOG_FORMAT = 'json';

    const { keluar } = rekam(() => logger.info('halo', { durasi: 10n }));

    expect(keluar.join('')).toContain('"durasi":"10"');
  });
});

describe('child logger', () => {
  test('kolom dasar menempel di setiap baris', () => {
    process.env.LOG_FORMAT = 'json';

    const log = logger.child({ requestId: 'abc-123' });
    const { keluar } = rekam(() => {
      log.info('satu');
      log.warn('dua');
    });

    for (const baris of keluar.join('').trim().split('\n')) {
      expect(JSON.parse(baris).requestId).toBe('abc-123');
    }
  });

  test('child bertingkat menggabungkan kolom, tanpa saling menimpa', () => {
    process.env.LOG_FORMAT = 'json';

    const { keluar } = rekam(() =>
      logger.child({ requestId: 'r1' }).child({ uid: 'u1' }).info('halo')
    );
    const baris = JSON.parse(keluar.join('').trim());

    expect(baris).toMatchObject({ requestId: 'r1', uid: 'u1' });
  });

  test('kolom dari pemanggil menang atas kolom dasar', () => {
    process.env.LOG_FORMAT = 'json';

    const { keluar } = rekam(() => logger.child({ status: 200 }).info('halo', { status: 500 }));

    expect(JSON.parse(keluar.join('').trim()).status).toBe(500);
  });
});
