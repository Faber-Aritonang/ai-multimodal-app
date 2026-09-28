/**
 * Test: konfigurasi paket keanggotaan (config/membershipPlans.js)
 *
 * - paket paid harus tepat 5x lipat paket free untuk SEMUA kunci kuota
 * - quotaForPlan mengembalikan salinan (aman diubah pemanggil) dan jatuh ke
 *   free untuk paket tak dikenal
 * - harga paid bisa ditimpa lewat env, default 49000
 */

const {
  PAID_MULTIPLIER,
  FREE_QUOTA,
  PAID_QUOTA,
  quotaForPlan,
  paidPriceIdr,
  describePlans
} = require('../config/membershipPlans');

describe('kuota paket paid = 5x lipat paket free', () => {
  test('setiap kunci kuota paid tepat 5x lipat free', () => {
    expect(PAID_MULTIPLIER).toBe(5);

    Object.keys(FREE_QUOTA).forEach((key) => {
      expect(PAID_QUOTA[key]).toBe(FREE_QUOTA[key] * PAID_MULTIPLIER);
    });
  });

  test('total selalu sama dengan jumlah empat kunci pekerjaan', () => {
    const jumlah = (quota) =>
      quota.chat + quota.imageGeneration + quota.audioGeneration + quota.videoGeneration;

    expect(jumlah(FREE_QUOTA)).toBe(FREE_QUOTA.total);
    expect(jumlah(PAID_QUOTA)).toBe(PAID_QUOTA.total);
  });
});

describe('quotaForPlan', () => {
  test('mengembalikan salinan yang aman diubah', () => {
    const quota = quotaForPlan('paid');
    quota.chat = 0;

    expect(quotaForPlan('paid').chat).toBe(PAID_QUOTA.chat);
  });

  test('paket tak dikenal jatuh ke kuota free', () => {
    expect(quotaForPlan('bukan-paket')).toEqual({ ...FREE_QUOTA });
  });
});

describe('harga paket paid', () => {
  const asli = process.env.PAID_PLAN_PRICE_IDR;

  afterEach(() => {
    if (asli === undefined) delete process.env.PAID_PLAN_PRICE_IDR;
    else process.env.PAID_PLAN_PRICE_IDR = asli;
  });

  test('default 49000 rupiah', () => {
    delete process.env.PAID_PLAN_PRICE_IDR;
    expect(paidPriceIdr()).toBe(49000);
  });

  test('bisa ditimpa lewat env', () => {
    process.env.PAID_PLAN_PRICE_IDR = '75000';
    expect(paidPriceIdr()).toBe(75000);
  });

  test('nilai env yang tidak sah diabaikan (kembali ke default)', () => {
    process.env.PAID_PLAN_PRICE_IDR = 'seribu';
    expect(paidPriceIdr()).toBe(49000);
  });
});

describe('describePlans', () => {
  test('memuat free (gratis) dan paid (5x kuota) lengkap dengan fiturnya', () => {
    const plans = describePlans();
    const free = plans.find((p) => p.id === 'free');
    const paid = plans.find((p) => p.id === 'paid');

    expect(free).toBeDefined();
    expect(paid).toBeDefined();
    expect(free.priceIdr).toBe(0);
    expect(paid.priceIdr).toBe(paidPriceIdr());
    expect(paid.multiplier).toBe(5);
    expect(paid.quota).toEqual({ ...PAID_QUOTA });
    // Member paid langsung aktif setelah bayar; free menunggu approval admin.
    expect(free.requiresApproval).toBe(true);
    expect(paid.requiresApproval).toBe(false);
  });
});
