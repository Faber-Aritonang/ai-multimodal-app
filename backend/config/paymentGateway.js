/**
 * Facade: gateway pembayaran member paid.
 *
 * Tersedia dua provider dengan antarmuka SERAGAM (lihat masing-masing file):
 *   duitku — duitku.com    (config/duitku.js)
 *   tripay — tripay.co.id  (config/tripay.js)
 *
 * Provider aktif dipilih lewat env `PAYMENT_PROVIDER` (default: duitku).
 * Nilai tak dikenal jatuh ke default, dan bila provider terpilih belum
 * dikonfigurasi paymentController menjawab 503 dengan pesan yang menyebut
 * variabelnya — bukan gagal senyap.
 *
 * PaymentController hanya berbicara ke modul ini, jadi menambah/mengganti
 * gateway cukup dengan satu modul adapter baru + satu baris daftar di bawah.
 */

const tripay = require('./tripay');
const duitku = require('./duitku');

const PROVIDERS = {
  duitku,
  tripay
};

const DEFAULT_PROVIDER = 'duitku';

const providerName = () => {
  const dipilih = (process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  return PROVIDERS[dipilih] ? dipilih : DEFAULT_PROVIDER;
};

const provider = () => PROVIDERS[providerName()];

/** Status gateway aktif untuk GET /payment/plans & /health (nama variabel saja). */
const getGatewayStatus = () => ({
  provider: providerName(),
  ...provider().getProviderStatus()
});

module.exports = {
  providerName,
  getGatewayStatus,
  isConfigured: () => provider().isConfigured(),
  createPayment: (params) => provider().createPayment(params),
  verifyNotificationSignature: (notification) =>
    provider().verifyNotificationSignature(notification),
  mapNotificationStatus: (notification) => provider().mapNotificationStatus(notification),
  getOrderRef: (notification) => provider().getOrderRef(notification),
  checkTransaction: (params) => provider().checkTransaction(params)
};
