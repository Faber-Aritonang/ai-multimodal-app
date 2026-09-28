/**
 * Provider pembayaran: Duitku (duitku.com)
 *
 * Adapter untuk API Merchant v2 Duitku — dipakai lewat facade
 * config/paymentGateway.js dengan antarmuka yang sama seperti provider lain.
 *
 * Kredensial (lihat backend/.env.example):
 *   DUITKU_MERCHANT_CODE   — kode project dari portal merchant (D....)
 *   DUITKU_API_KEY         — API key project
 *   DUITKU_PAYMENT_METHOD  — kode metode pembayaran (wajib; ambil dari
 *                            dashboard/Duitku `getpaymentmethod`)
 *   DUITKU_IS_PROD=true    — pindah dari sandbox ke production
 *
 * Signature (dokumentasi Duitku, HMAC-SHA256 hex lowercase):
 *   inquiry          : merchantCode + merchantOrderId + paymentAmount
 *   callback         : merchantCode + amount + merchantOrderId   ← urutan beda!
 *   transactionStatus: merchantCode + merchantOrderId
 *
 * Callback Duitku berupa POST x-www-form-urlencoded dengan `merchantOrderId`,
 * `amount`, `resultCode` ('00' sukses, '01' gagal), dan `signature`.
 * (express.urlencoded sudah dipasang di server.js, jadi body-nya ter-parse.)
 */

const crypto = require('crypto');

const isProduction = () => process.env.DUITKU_IS_PROD === 'true';

const baseUrl = () =>
  isProduction()
    ? 'https://passport.duitku.com/webapi/api'
    : 'https://sandbox.duitku.com/webapi/api';

const merchantCode = () => (process.env.DUITKU_MERCHANT_CODE || '').trim();
const apiKey = () => (process.env.DUITKU_API_KEY || '').trim();
const paymentMethod = () => (process.env.DUITKU_PAYMENT_METHOD || '').trim();

const isConfigured = () => Boolean(merchantCode() && apiKey() && paymentMethod());

const getProviderStatus = () => ({
  configured: isConfigured(),
  mode: isProduction() ? 'production' : 'sandbox',
  paymentMethod: paymentMethod() || null
});

/** HMAC-SHA256 hex lowercase yang dikunci API key project. */
const hmac = (data) =>
  crypto.createHmac('sha256', apiKey()).update(String(data)).digest('hex');

const signatureCocok = (diharapkan, diterima) => {
  const a = Buffer.from(String(diharapkan), 'utf8');
  const b = Buffer.from(String(diterima || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const tidakDikonfigurasi = () => {
  const error = new Error(
    'Pembayaran Duitku belum dikonfigurasi: isi DUITKU_MERCHANT_CODE, DUITKU_API_KEY, dan DUITKU_PAYMENT_METHOD di backend/.env.'
  );
  error.code = 'PAYMENT_NOT_CONFIGURED';
  return error;
};

/**
 * Buat transaksi (inquiry) dan kembalikan URL halaman pembayaran Duitku.
 * `paymentUrl` menampilkan metode terpilih + instruksi bayarnya.
 */
const createPayment = async ({
  orderId,
  amount,
  customerName,
  customerEmail,
  description,
  returnUrl,
  callbackUrl
}) => {
  if (!isConfigured()) throw tidakDikonfigurasi();

  if (!callbackUrl) {
    // callbackUrl WAJIB untuk Duitku — tanpa itu kami tidak pernah tahu
    // pembayaran sudah masuk. Lebih baik gagal sekarang daripada senyap.
    const error = new Error(
      'PAYMENT_CALLBACK_URL (atau PUBLIC_BASE_URL) belum diisi — Duitku membutuhkan URL callback.'
    );
    error.code = 'PAYMENT_NOT_CONFIGURED';
    throw error;
  }

  const body = {
    merchantCode: merchantCode(),
    paymentAmount: amount,
    paymentMethod: paymentMethod(),
    merchantOrderId: orderId,
    productDetails: description || 'Member Paid',
    email: customerEmail || '',
    customerVaName: customerName || 'Member',
    callbackUrl,
    returnUrl: returnUrl || callbackUrl,
    signature: hmac(`${merchantCode()}${orderId}${amount}`),
    // 60 menit — sama dengan jendela pakai-ulang transaksi di paymentController.
    expiryPeriod: 60
  };

  const response = await fetch(`${baseUrl()}/merchant/v2/inquiry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  // '00' = sukses (dokumentasi Duitku "Response Parameters").
  if (!response.ok || String(data?.statusCode) !== '00' || !data?.paymentUrl) {
    const message = data?.statusMessage || data?.Message || `HTTP ${response.status}`;
    throw new Error(`Duitku menolak transaksi: ${message}`);
  }

  return {
    redirectUrl: data.paymentUrl,
    reference: data.reference || '',
    payCode: data.vaNumber ? String(data.vaNumber) : '',
    qrUrl: ''
  };
};

/**
 * Verifikasi keaslian callback Duitku.
 * signature = HMAC-SHA256(merchantCode + amount + merchantOrderId, apiKey)
 * (PERHATIAN: urutannya berbeda dari signature inquiry!)
 */
const verifyNotificationSignature = (notification) => {
  const merchantOrderId = String(notification?.merchantOrderId || '');
  const amount = String(notification?.amount ?? '');

  if (!isConfigured() || !merchantOrderId || !amount || !notification?.signature) {
    return false;
  }

  return signatureCocok(
    hmac(`${merchantCode()}${amount}${merchantOrderId}`),
    notification.signature
  );
};

/** Nomor order kita yang dikirim balik Duitku di callback. */
const getOrderRef = (notification) => String(notification?.merchantOrderId || '');

/**
 * Status callback Duitku: `resultCode` '00' = sukses, selain itu gagal.
 */
const mapNotificationStatus = (notification) => {
  const code = String(notification?.resultCode ?? '');

  if (code === '00') return 'paid';
  if (code) return 'failed';

  return 'pending';
};

/**
 * Cek status transaksi ke Duitku (POST /merchant/transactionStatus).
 * statusCode: '00' sukses, '01' proses, '02' gagal/kedaluwarsa.
 *
 * Sengaja HANYA dipanggil dari tombol "cek status" (bukan polling otomatis):
 * dokumentasi Duitku melarang pemanggilan berulang otomatis dan memblokir
 * hit berlebih selama ±1 jam.
 */
const checkTransaction = async ({ orderId }) => {
  if (!orderId || !isConfigured()) return 'pending';

  const response = await fetch(`${baseUrl()}/merchant/transactionStatus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      merchantCode: merchantCode(),
      merchantOrderId: orderId,
      signature: hmac(`${merchantCode()}${orderId}`)
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.statusCode === undefined) {
    throw new Error(`Gagal cek status transaksi Duitku: ${data?.statusMessage || response.status}`);
  }

  const code = String(data.statusCode);
  if (code === '00') return 'paid';
  if (code === '02') return 'failed';
  return 'pending';
};

module.exports = {
  name: 'duitku',
  isConfigured,
  getProviderStatus,
  createPayment,
  verifyNotificationSignature,
  mapNotificationStatus,
  getOrderRef,
  checkTransaction
};
