/**
 * Test: config/envFile
 * Memastikan kredensial dari .env tidak bisa ditimpa nilai shell yang rusak,
 * tanpa mengubah perilaku key konfigurasi lain.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { preferEnvFile, AI_CREDENTIAL_KEYS } = require('../config/envFile');

let dir;
let envPath;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envfile-'));
  envPath = path.join(dir, '.env');
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const writeEnvFile = (content) => fs.writeFileSync(envPath, content);

describe('preferEnvFile', () => {
  test('nilai .env mengalahkan nilai shell yang berbeda', () => {
    writeEnvFile('GROQ_API_KEY=gsk-baru\n');
    const env = { GROQ_API_KEY: 'gsk-lama\nexport GROQ_API_KEY=gsk-lama' };

    const changed = preferEnvFile({ envPath, env });

    expect(changed).toEqual(['GROQ_API_KEY']);
    expect(env.GROQ_API_KEY).toBe('gsk-baru');
  });

  test('key yang tidak ada di .env dibiarkan apa adanya', () => {
    writeEnvFile('GROQ_API_KEY=gsk-baru\n');
    const env = { GROQ_API_KEY: 'gsk-baru', GEMINI_API_KEY: 'dari-shell' };

    const changed = preferEnvFile({ envPath, env });

    expect(changed).toEqual([]);
    expect(env.GEMINI_API_KEY).toBe('dari-shell');
  });

  test('key di luar daftar kredensial tidak pernah disentuh', () => {
    writeEnvFile('PORT=9999\nUPLOAD_DIR=dari-file\nGROQ_API_KEY=gsk-baru\n');
    const env = { PORT: '4000', UPLOAD_DIR: 'temp-test', GROQ_API_KEY: 'gsk-lama' };

    preferEnvFile({ envPath, env });

    expect(env.PORT).toBe('4000');
    expect(env.UPLOAD_DIR).toBe('temp-test');
    expect(env.GROQ_API_KEY).toBe('gsk-baru');
  });

  test('tanpa file .env tidak terjadi apa-apa', () => {
    const env = { GROQ_API_KEY: 'gsk-shell' };

    const changed = preferEnvFile({ envPath: path.join(dir, 'tidak-ada.env'), env });

    expect(changed).toEqual([]);
    expect(env.GROQ_API_KEY).toBe('gsk-shell');
  });

  test('nilai kosong di .env tidak menimpa', () => {
    writeEnvFile('GROQ_API_KEY=\n');
    const env = { GROQ_API_KEY: 'gsk-shell' };

    expect(preferEnvFile({ envPath, env })).toEqual([]);
    expect(env.GROQ_API_KEY).toBe('gsk-shell');
  });

  test('daftar key mencakup semua kredensial AI yang dipakai aplikasi', () => {
    expect(AI_CREDENTIAL_KEYS).toEqual(
      expect.arrayContaining([
        'GROQ_API_KEY',
        'GEMINI_API_KEY',
        'OPENAI_API_KEY',
        'CLOUDFLARE_ACCOUNT_ID',
        'CLOUDFLARE_API_TOKEN',
        'POLLINATIONS_TOKEN'
      ])
    );
  });
});
