/**
 * Test: config/firebase.js
 * Memverifikasi resolusi kredensial Firebase Admin dari env, baik berupa
 * JSON string (produksi) maupun path file (lokal), tanpa memanggil network.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { getServiceAccountCredentials } = require('../config/firebase');

const ORIGINAL_VALUE = process.env.FIREBASE_SERVICE_ACCOUNT;
const VALID_ACCOUNT = {
  type: 'service_account',
  project_id: 'demo-project',
  client_email: 'admin@demo-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n'
};

afterEach(() => {
  if (ORIGINAL_VALUE === undefined) {
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
  } else {
    process.env.FIREBASE_SERVICE_ACCOUNT = ORIGINAL_VALUE;
  }
});

describe('getServiceAccountCredentials', () => {
  test('error deskriptif saat env belum diisi', () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    expect(() => getServiceAccountCredentials()).toThrow(
      /FIREBASE_SERVICE_ACCOUNT is not set/
    );
  });

  test('error saat env hanya berisi spasi', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = '   ';

    expect(() => getServiceAccountCredentials()).toThrow(
      /FIREBASE_SERVICE_ACCOUNT is not set/
    );
  });

  test('membaca JSON string dan mengubah \\\\n pada private_key jadi newline asli', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(VALID_ACCOUNT);

    const credentials = getServiceAccountCredentials();

    expect(credentials.project_id).toBe('demo-project');
    expect(credentials.private_key).toContain('\n');
    expect(credentials.private_key).not.toContain('\\n');
  });

  test('error saat JSON string tidak valid', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = '{not-valid-json';

    expect(() => getServiceAccountCredentials()).toThrow(/invalid JSON/);
  });

  test('membaca file service account dari path relatif', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-key-'));
    const filePath = path.join(dir, 'service-account.json');
    fs.writeFileSync(filePath, JSON.stringify(VALID_ACCOUNT));

    const originalCwd = process.cwd();
    process.chdir(dir);

    try {
      process.env.FIREBASE_SERVICE_ACCOUNT = './service-account.json';

      const credentials = getServiceAccountCredentials();

      expect(credentials.client_email).toBe(VALID_ACCOUNT.client_email);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('error deskriptif saat file tidak ditemukan', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = './config/does-not-exist.json';

    expect(() => getServiceAccountCredentials()).toThrow(/no file exists at/);
  });
});
