/**
 * Test: konfigurasi Duitku (config/duitku.js)
 *
 * - verifikasi signature callback Duitku (HMAC-SHA256 dari merchantCode +
 *   amount + merchantOrderId dengan API key project) — inilah satu-satunya
 *   penghalang notifikasi palsu yang akan mengaktifkan member paid
 * - pemetaan status callback Duitku ke status Payment internal
 * - isConfigured: kredensial setengah terisi tidak boleh dianggap siap
 */

process.env.DUITKU_MERCHANT_CODE = 'D12345';
process.env.DUITKU_API_KEY = 'api-key-test';
process.env.DUITKU_PAYMENT_METHOD = 'VC';

const crypto = require('crypto');
const duitku = require('../config/duitku');

// Urutan signature callback Duitku: merchantCode + amount + merchantOrderId.
const signatureUntuk = (
  merchantCode,
  amount,
  merchantOrderId,
  key = process.env.DUITKU_API_KEY
) =>
  crypto.createHmac('sha256', key).update(`${merchantCode}${amount}${merchantOrderId}`).digest('hex');

const notifikasi = (overrides = {}) => ({
  merchantOrderId: 'PAID-123-ABC',
  amount: 49000,
  resultCode: '00',
  merchantCode: 'D12345',
  signature: signatureUntuk('D12345', 49000, 'PAID-123-ABC'),
  ...overrides
});

describe('verifyNotificationSignature', () => {
  test('menerima callback dengan signature yang benar', () => {
    expect(duitku.verifyNotificationSignature(notifikasi())).toBe(true);
  });

  test('menolak signature yang diganti (callback palsu)', () => {
    const palsu = notifikasi({
      signature: signatureUntuk('D12345', 49000, 'PAID-123-ABC', 'kunci-lain')
    });
    expect(duitku.verifyNotificationSignature(palsu)).toBe(false);
  });

  test('menolak bila nilai yang ditandatangani diubah (jumlah uang)', () => {
    const dimanipulasi = notifikasi({ amount: 1 });
    expect(duitku.verifyNotificationSignature(dimanipulasi)).toBe(false);
  });

  test('menolak bila order id diganti', () => {
    const dimanipulasi = notifikasi({ merchantOrderId: 'ORDER-LAIN' });
    expect(duitku.verifyNotificationSignature(dimanipulasi)).toBe(false);
  });

  test('menolak bila ada field yang kurang', () => {
    const tanpaOrderId = notifikasi();
    delete tanpaOrderId.merchantOrderId;
    expect(duitku.verifyNotificationSignature(tanpaOrderId)).toBe(false);

    expect(duitku.verifyNotificationSignature({})).toBe(false);
    expect(duitku.verifyNotificationSignature(undefined)).toBe(false);
  });
});

describe('mapNotificationStatus', () => {
  test("resultCode '00' -> paid", () => {
    expect(duitku.mapNotificationStatus({ resultCode: '00' })).toBe('paid');
  });

  test("resultCode selain '00' -> failed", () => {
    expect(duitku.mapNotificationStatus({ resultCode: '01' })).toBe('failed');
  });

  test('tanpa resultCode -> pending (tidak pernah mengaktifkan member)', () => {
    expect(duitku.mapNotificationStatus({})).toBe('pending');
    expect(duitku.mapNotificationStatus(undefined)).toBe('pending');
  });
});

describe('getOrderRef', () => {
  test('mengambil merchantOrderId dari callback', () => {
    expect(duitku.getOrderRef(notifikasi())).toBe('PAID-123-ABC');
    expect(duitku.getOrderRef({})).toBe('');
  });
});

describe('isConfigured', () => {
  const asli = {
    merchantCode: process.env.DUITKU_MERCHANT_CODE,
    apiKey: process.env.DUITKU_API_KEY,
    paymentMethod: process.env.DUITKU_PAYMENT_METHOD
  };

  afterEach(() => {
    process.env.DUITKU_MERCHANT_CODE = asli.merchantCode;
    process.env.DUITKU_API_KEY = asli.apiKey;
    process.env.DUITKU_PAYMENT_METHOD = asli.paymentMethod;
  });

  test('false bila salah satu kredensial kosong', () => {
    process.env.DUITKU_MERCHANT_CODE = '';
    expect(duitku.isConfigured()).toBe(false);

    process.env.DUITKU_MERCHANT_CODE = 'D12345';
    process.env.DUITKU_API_KEY = '';
    expect(duitku.isConfigured()).toBe(false);

    process.env.DUITKU_API_KEY = 'api-key-test';
    process.env.DUITKU_PAYMENT_METHOD = '';
    expect(duitku.isConfigured()).toBe(false);
  });

  test('true dengan ketiga kredensial terisi', () => {
    process.env.DUITKU_MERCHANT_CODE = 'D12345';
    process.env.DUITKU_API_KEY = 'api-key-test';
    process.env.DUITKU_PAYMENT_METHOD = 'VC';
    expect(duitku.isConfigured()).toBe(true);
  });
});
