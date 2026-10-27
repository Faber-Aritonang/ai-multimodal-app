/**
 * Test: config/quota.js
 *
 * Tiga hal yang dikunci di sini menentukan tiga bug yang berbeda:
 *
 *   1. `remainingQuota` — titik yang dipakai middleware untuk memutuskan
 *      boleh/tidak. Cadangan untuk akun lama harus sama dengan yang dipakai
 *      reservasi, kalau tidak fitur suara bisa 403 padahal jatahnya ada.
 *   2. `reserveQuota` — pengambilan jatah harus SATU operasi atomik bersyarat
 *      (`$gte` + `$inc`), bukan baca-ubah-tulis yang bisa membuat kuota minus
 *      saat dua permintaan berjalan paralel.
 *   3. `refundQuota` — pengembalian harus memakai kunci yang benar-benar
 *      dipotong; untuk akun lama itu `videoGeneration`, bukan
 *      `audioGeneration`.
 *
 * Model User di-mock, jadi test berjalan tanpa MongoDB.
 */

jest.mock('../models/User');

const User = require('../models/User');
const {
  remainingQuota,
  reserveQuota,
  refundQuota,
  AUDIO_QUOTA_FALLBACK
} = require('../config/quota');

beforeEach(() => {
  User.findOneAndUpdate.mockReset();
});

describe('remainingQuota', () => {
  test('memakai nilai kuota jenis yang diminta', () => {
    expect(remainingQuota({ chat: 7, imageGeneration: 2 }, 'chat')).toBe(7);
    expect(remainingQuota({ chat: 7, imageGeneration: 2 }, 'imageGeneration')).toBe(2);
  });

  test('akun lama tanpa audioGeneration memakai jatah videoGeneration', () => {
    // Akun sebelum kuota audio dipisahkan: field-nya tidak ada sama sekali.
    expect(remainingQuota({ videoGeneration: 4 }, 'audioGeneration')).toBe(4);
  });

  test('akun yang audioGeneration-nya 0 dianggap habis, bukan akun lama', () => {
    // `undefined` (tidak ada field) dan `0` (benar-benar habis) harus dibedakan:
    // kalau tidak, kuota audio yang habis bisa diam-diam memakai jatah video.
    expect(remainingQuota({ audioGeneration: 0, videoGeneration: 9 }, 'audioGeneration')).toBe(0);
  });

  test('jenis yang tidak ada di dokumen laporkan undefined', () => {
    expect(remainingQuota({ chat: 1 }, 'videoGeneration')).toBeUndefined();
    expect(remainingQuota(undefined, 'chat')).toBeUndefined();
  });
});

describe('reserveQuota', () => {
  test('pemeriksaan dan pengurangan ada di satu operasi atomik', async () => {
    User.findOneAndUpdate.mockResolvedValue({ quota: { chat: 4, imageGeneration: 3 } });

    const reservasi = await reserveQuota('uid-1', 'chat');

    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { uid: 'uid-1', 'quota.chat': { $gte: 1 } },
      { $inc: { 'quota.chat': -1 } },
      { new: true }
    );
    expect(reservasi).toEqual({ quota: { chat: 4, imageGeneration: 3 }, key: 'chat' });
  });

  test('mengembalikan null bila sisa kuota sudah diambil permintaan lain', async () => {
    User.findOneAndUpdate.mockResolvedValue(null);

    await expect(reserveQuota('uid-1', 'imageGeneration')).resolves.toBeNull();
  });

  test('cadangan video hanya dicoba untuk audioGeneration', async () => {
    User.findOneAndUpdate.mockResolvedValue(null);

    await reserveQuota('uid-1', 'imageGeneration');

    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test('akun lama: audio memakai jatah video, dengan syarat field audio belum ada', async () => {
    User.findOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ quota: { videoGeneration: 3 } });

    const reservasi = await reserveQuota('uid-1', 'audioGeneration');

    const [percobaanPertama, percobaanKedua] = User.findOneAndUpdate.mock.calls;

    expect(percobaanPertama[0]).toEqual({ uid: 'uid-1', 'quota.audioGeneration': { $gte: 1 } });
    expect(percobaanKedua[0]).toEqual({
      uid: 'uid-1',
      'quota.audioGeneration': { $exists: false },
      [`quota.${AUDIO_QUOTA_FALLBACK}`]: { $gte: 1 }
    });
    expect(percobaanKedua[1]).toEqual({ $inc: { [`quota.${AUDIO_QUOTA_FALLBACK}`]: -1 } });

    // Kunci inilah yang harus dipakai refund: mengembalikannya ke
    // audioGeneration akan membuat jatah user hilang.
    expect(reservasi).toEqual({ quota: { videoGeneration: 3 }, key: AUDIO_QUOTA_FALLBACK });
  });

  test('akun lama yang jatah videonya habis tidak dibuat minus', async () => {
    User.findOneAndUpdate.mockResolvedValue(null);

    await expect(reserveQuota('uid-1', 'audioGeneration')).resolves.toBeNull();
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });
});

describe('refundQuota', () => {
  test('mengembalikan ke kunci yang dipakai saat reservasi, tanpa syarat batas', async () => {
    User.findOneAndUpdate.mockResolvedValue({ quota: { chat: 5 } });

    const quota = await refundQuota('uid-1', 'chat');

    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { uid: 'uid-1' },
      { $inc: { 'quota.chat': 1 } },
      { new: true }
    );
    expect(quota).toEqual({ chat: 5 });
  });

  test('akun lama: pengembalian masuk ke videoGeneration', async () => {
    User.findOneAndUpdate.mockResolvedValue({ quota: { videoGeneration: 4 } });

    await refundQuota('uid-1', AUDIO_QUOTA_FALLBACK);

    expect(User.findOneAndUpdate.mock.calls[0][1]).toEqual({
      $inc: { 'quota.videoGeneration': 1 }
    });
  });

  test('user yang sudah tidak ada tidak membuat proses gagal', async () => {
    User.findOneAndUpdate.mockResolvedValue(null);

    await expect(refundQuota('uid-hilang', 'chat')).resolves.toBeNull();
  });
});
