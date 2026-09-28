/**
 * Provider pembayaran: TriPay (tripay.co.id)
 *
 * Adapter untuk Closed Payment TriPay — dipakai lewat facade
 * config/paymentGateway.js. Antarmuka tiap provider sengaja dibuat sama
 * (isConfigured / createPayment / verifyNotificationSignature /
 * mapNotificationStatus / getOrderRef / checkTransaction) supaya
 * paymentController tidak perlu tahu detail masing-masing gateway.
 *
 * Kredensial (lihat backend/.env.example):
 *   TRIPAY_MERCHANT_CODE — kode merchant (T....)
 *   TRIPAY_API_KEY       — API key (dipakai header Authorization Bearer)
 *   TRIPAY_PRIVATE_KEY   — private key (kunci HMAC signature)
 *   TRIPAY_PAYMENT_METHOD — kode channel, default `QRIS`
 *   TRIPAY_IS_PROD=true  — pindah dari sandbox ke production
 *
 * Signature transaksi & callback (dokumentasi TriPay "Pembuatan Signature"):
 *   HMAC-SHA256(merchantCode + merchantRef + amount, privateKey)
 *
 * Callback TriPay berupa POST (form/JSON — keduanya sudah di-parse Express)
 * dengan field `merchant_ref`, `amount`, `status`, dan `signature`.
 */

const crypto = require('crypto');

const isProduction = () => process.env.TRIPAY_IS_PROD === 'true';

const baseUrl = () =>
  isProduction() ? 'https://tripay.co.id/api' : 'https://tripay.co.id/api-sandbox';

const merchantCode = () => (process.env.TRIPAY_MERCHANT_CODE || '').trim();
const apiKey = () => (process.env.TRIPAY_API_KEY || '').trim();
const privateKey = () => (process.env.TRIPAY_PRIVATE_KEY || '').trim();
const paymentMethod = () => (process.env.TRIPAY_PAYMENT_METHOD || 'QRIS').trim();

const isConfigured = () => Boolean(merchantCode() && apiKey() && privateKey());

const getProviderStatus = () => ({
  configured: isConfigured(),
  mode: isProduction() ? 'production' : 'sandbox',
  paymentMethod: paymentMethod()
});

/** HMAC-SHA256 hex yang dikunci Private Key merchant. */
const hmac = (data) =>
  crypto.createHmac('sha256', privateKey()).update(String(data)).digest('hex');

/** Perbandingan waktu-konstan supaya isi signature tidak bisa ditebak per karakter. */
const signatureCocok = (diharapkan, diterima) => {
  const a = Buffer.from(String(diharapkan), 'utf8');
  const b = Buffer.from(String(diterima || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const tidakDikonfigurasi = () => {
  const error = new Error(
    'Pembayaran TriPay belum dikonfigurasi: isi TRIPAY_MERCHANT_CODE, TRIPAY_API_KEY, dan TRIPAY_PRIVATE_KEY di backend/.env.'
  );
  error.code = 'PAYMENT_NOT_CONFIGURED';
  return error;
};

/**
 * Buat transaksi Closed Payment dan kembalikan URL pembayaran.
 *
 * `checkout_url` selalu disediakan TriPay (termasuk channel DIRECT seperti
 * QRIS/VA) — halaman itulah yang menampilkan kode bayar/instruksi, jadi
 * frontend cukup mengarahkan browser ke sana.
 */
const createPayment = async ({
  orderId,
  amount,
  customerName,
  customerEmail,
  customerPhone,
  description,
  returnUrl,
  callbackUrl
}) => {
  if (!isConfigured()) throw tidakDikonfigurasi();

  const payload = new URLSearchParams();
  payload.append('method', paymentMethod());
  payload.append('merchant_ref', orderId);
  payload.append('amount', String(amount));
  payload.append('customer_name', customerName || 'Member');
  payload.append('customer_email', customerEmail || '');
  if (customerPhone) payload.append('customer_phone', customerPhone);
  // Satu item dengan harga = total. TriPay mensyaratkan name, price, quantity.
  payload.append('order_items[0][name]', description || 'Member Paid');
  payload.append('order_items[0][price]', String(amount));
  payload.append('order_items[0][quantity]', '1');
  if (callbackUrl) payload.append('callback_url', callbackUrl);
  if (returnUrl) payload.append('return_url', returnUrl);
  // 60 menit — sama dengan jendela pakai-ulang transaksi di paymentController.
  payload.append('expired_time', String(Math.floor(Date.now() / 1000) + 60 * 60));
  payload.append('signature', hmac(`${merchantCode()}${orderId}${amount}`));

  const response = await fetch(`${baseUrl()}/transaction/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: payload.toString()
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.success || !data.data) {
    const message = data?.message || `HTTP ${response.status}`;
    throw new Error(`TriPay menolak transaksi: ${message}`);
  }

  return {
    redirectUrl: data.data.checkout_url || '',
    reference: data.data.reference || '',
    payCode: data.data.pay_code ? String(data.data.pay_code) : '',
    qrUrl: data.data.qr_url || ''
  };
};

/**
 * Verifikasi keaslian callback TriPay.
 * signature = HMAC-SHA256(merchantCode + merchantRef + amount, privateKey)
 */
const verifyNotificationSignature = (notification) => {
  const merchantRef = String(notification?.merchant_ref || '');
  const amount = String(notification?.amount ?? '');

  if (!isConfigured() || !merchantRef || !amount || !notification?.signature) {
    return false;
  }

  return signatureCocok(hmac(`${merchantCode()}${merchantRef}${amount}`), notification.signature);
};

/** Nomor order kita yang dikirim balik TriPay di callback. */
const getOrderRef = (notification) => String(notification?.merchant_ref || '');

/**
 * Status callback TriPay: `status` bernilai SUCCESS / FAILED / EXPIRED.
 * (Status di API detail memakai kosakata lain — lihat checkTransaction.)
 */
const mapNotificationStatus = (notification) => {
  const status = String(notification?.status || '').toUpperCase();

  if (status === 'SUCCESS' || status === 'PAID') return 'paid';
  if (status === 'EXPIRED') return 'expired';
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'CANCELED') return 'failed';

  return 'pending';
};

/**
 * Cek status transaksi langsung ke TriPay (untuk tombol "cek status" saat
 * webhook belum sampai, mis. saat pengembangan lokal).
 *
 * check-status memicu TriPay menyegarkan statusnya; detail membaca hasilnya.
 */
const checkTransaction = async ({ reference }) => {
  if (!reference || !isConfigured()) return 'pending';

  const headers = { Authorization: `Bearer ${apiKey()}`, Accept: 'application/json' };

  try {
    await fetch(`${baseUrl()}/transaction/check-status?reference=${encodeURIComponent(reference)}`, {
      headers
    });
  } catch {
    // Best-effort: detail di bawah tetap dibaca walau penyegaran gagal.
  }

  const response = await fetch(
    `${baseUrl()}/transaction/detail?reference=${encodeURIComponent(reference)}`,
    { headers }
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.success || !data.data) {
    throw new Error(`Gagal cek status transaksi TriPay: ${data?.message || response.status}`);
  }

  return mapNotificationStatus({ status: data.data.status });
};

module.exports = {
  name: 'tripay',
  isConfigured,
  getProviderStatus,
  createPayment,
  verifyNotificationSignature,
  mapNotificationStatus,
  getOrderRef,
  checkTransaction
};
