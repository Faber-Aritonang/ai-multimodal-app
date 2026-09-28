/**
 * Konfigurasi paket keanggotaan (tier).
 *
 * Dua paket:
 *   - `free` : member biasa. Kuota default, tetap menunggu persetujuan admin.
 *   - `paid` : member berbayar. Kuota 5x lipat member biasa, aktif otomatis
 *              begitu pembayaran diterima gateway (Duitku/Tripay, tanpa
 *              approval admin).
 *
 * Modul ini SATU-SATUNYA sumber angka kuota & harga. Sebelumnya angka yang sama
 * disalin di tiga tempat (models/User.js, controllers/adminController.js, dan
 * payload tombol approve di frontend admin) yang harus diubah bersama-sama.
 * Sekarang cukup ubah di sini; model dan controller memanggil `quotaForPlan`.
 */

// Kelipatan kuota paket berbayar terhadap member biasa.
const PAID_MULTIPLIER = 5;

/** Kuota member biasa (free) per jenis pekerjaan, sisa pemakaian. */
const FREE_QUOTA = Object.freeze({
  chat: 60,
  imageGeneration: 30,
  audioGeneration: 25,
  videoGeneration: 25,
  total: 140
});

/** Kuota member paid = 5x lipat member biasa (lihat PAID_MULTIPLIER). */
const PAID_QUOTA = Object.freeze({
  chat: FREE_QUOTA.chat * PAID_MULTIPLIER, // 300
  imageGeneration: FREE_QUOTA.imageGeneration * PAID_MULTIPLIER, // 150
  audioGeneration: FREE_QUOTA.audioGeneration * PAID_MULTIPLIER, // 125
  videoGeneration: FREE_QUOTA.videoGeneration * PAID_MULTIPLIER, // 125
  total: FREE_QUOTA.total * PAID_MULTIPLIER // 700
});

const PLAN_QUOTAS = Object.freeze({
  free: FREE_QUOTA,
  paid: PAID_QUOTA
});

/**
 * Kuota awal untuk satu paket. Mengembalikan SALINAN supaya pemanggil yang
 * mengubah hasilnya (mis. mengurangi sisa) tidak ikut mengubah konstanta.
 * Paket tak dikenal jatuh ke `free` — jalur yang sama dengan akun lama.
 */
const quotaForPlan = (plan) => ({ ...(PLAN_QUOTAS[plan] || FREE_QUOTA) });

/**
 * Harga paket berbayar dalam Rupiah (integer, tanpa desimal — format yang
 * diminta gateway pembayaran). Bisa ditimpa lewat env tanpa mengubah kode.
 */
const paidPriceIdr = () => {
  const parsed = parseInt(process.env.PAID_PLAN_PRICE_IDR, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 49000;
};

/**
 * Deskripsi paket untuk halaman registrasi & upgrade (endpoint publik
 * GET /api/v1/payment/plans). Frontend tidak menyimpan angka kuota/harga
 * sendiri supaya tidak bisa menyimpang dari aturan server.
 */
const describePlans = () => [
  {
    id: 'free',
    name: 'Free — Member Biasa',
    priceIdr: 0,
    multiplier: 1,
    quota: quotaForPlan('free'),
    requiresApproval: true,
    features: [
      'Kuota standar member biasa',
      'Menunggu persetujuan admin sebelum alat terbuka',
      'Referral & riwayat media'
    ]
  },
  {
    id: 'paid',
    name: 'Member Paid',
    priceIdr: paidPriceIdr(),
    multiplier: PAID_MULTIPLIER,
    quota: quotaForPlan('paid'),
    requiresApproval: false,
    features: [
      `Kuota ${PAID_MULTIPLIER}x lipat member biasa`,
      'Langsung aktif setelah pembayaran diterima (tanpa antre approval)',
      'Referral & riwayat media'
    ]
  }
];

module.exports = {
  PAID_MULTIPLIER,
  FREE_QUOTA,
  PAID_QUOTA,
  quotaForPlan,
  paidPriceIdr,
  describePlans
};
