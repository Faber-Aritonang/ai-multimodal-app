/**
 * Kuota: aturan bersama, reservasi atomik, dan pengembaliannya.
 *
 * Tiga hal tinggal di sini supaya pemeriksa, pengambil, dan pengembalinya tidak
 * berbeda pendapat:
 *
 *   1. `remainingQuota` — sisa jatah untuk satu jenis pekerjaan,
 *   2. `reserveQuota`   — ambil jatah SEBELUM pekerjaan mahal dimulai, dan
 *   3. `refundQuota`    — kembalikan jatah bila pekerjaannya gagal.
 *
 * Kenapa reservasi, bukan potong-setelah-sukses: pengurangan setelah pekerjaan
 * selesai membuat celah bagi beberapa permintaan paralel untuk sama-sama lolos
 * pemeriksaan sisa 1. Contohnya endpoint video yang membalas 202 segera — satu
 * akun bisa memulai 20 pekerjaan berbayar dengan sisa 1 kuota, dan semuanya
 * "sah" karena belum ada yang dipotong. Dengan reservasi, jatahnya diambil di
 * awal sehingga permintaan yang tidak kebagian ditolak sebelum menyentuh
 * provider.
 *
 * Potongannya sendiri tetap satu operasi atomik (`findOneAndUpdate` dengan
 * syarat `$gte` + `$inc`), jadi angkanya tidak pernah minus walau permintaan
 * datang bersamaan: yang kalah tidak menemukan dokumen yang cocok, bukan
 * menulis angka negatif.
 *
 * Kegagalan pekerjaan WAJIB memanggil `refundQuota` dengan kunci yang sama
 * seperti saat reservasi (`key`), karena akun lama bisa memakai
 * `videoGeneration` untuk permintaan audio.
 */

const User = require('../models/User');

// Kunci kuota untuk akun lama. Akun yang dibuat sebelum kuota audio dipisahkan
// hanya punya `videoGeneration` (audio dahulu memakai jatah itu). `undefined`
// (bukan 0) yang membedakan akun lama dari kuota yang benar-benar habis.
const AUDIO_QUOTA_FALLBACK = 'videoGeneration';

/**
 * Sisa kuota untuk satu jenis pekerjaan, termasuk cadangan untuk akun lama.
 *
 * @param {object|undefined} quota objek kuota user (boleh dari dokumen Mongoose)
 * @param {string} type kunci kuota (chat, imageGeneration, ...)
 */
const remainingQuota = (quota, type) => {
  const value = quota?.[type];

  if (value === undefined && type === 'audioGeneration') {
    return quota?.[AUDIO_QUOTA_FALLBACK];
  }

  return value;
};

/**
 * Ambil (reservasi) jatah satu jenis pekerjaan sebanyak `amount`, secara atomik.
 *
 * @param {string} uid
 * @param {'chat'|'imageGeneration'|'audioGeneration'|'videoGeneration'} type
 * @param {number} amount
 * @returns {Promise<{quota: object, key: string}|null>} objek `quota` terbaru
 *   beserta kunci yang benar-benar dipotong, atau `null` bila sisa kuotanya
 *   tidak lagi mencukupi.
 */
const reserveQuota = async (uid, type, amount = 1) => {
  const updated = await User.findOneAndUpdate(
    { uid, [`quota.${type}`]: { $gte: amount } },
    { $inc: { [`quota.${type}`]: -amount } },
    { new: true }
  );

  if (updated) return { quota: updated.quota, key: type };

  // Akun lama: field `audioGeneration` belum ada, jatah audionya menumpang
  // `videoGeneration`. Syarat `$exists: false` penting — akun yang field-nya ADA
  // dan bernilai 0 memang habis, bukan akun lama, dan tidak boleh memakai jatah
  // video.
  if (type === 'audioGeneration') {
    const legacy = await User.findOneAndUpdate(
      {
        uid,
        'quota.audioGeneration': { $exists: false },
        [`quota.${AUDIO_QUOTA_FALLBACK}`]: { $gte: amount }
      },
      { $inc: { [`quota.${AUDIO_QUOTA_FALLBACK}`]: -amount } },
      { new: true }
    );

    if (legacy) return { quota: legacy.quota, key: AUDIO_QUOTA_FALLBACK };
  }

  // Sampai di sini jatahnya memang habis — biasanya karena permintaan paralel
  // mengambil sisa terakhir lebih dulu.
  return null;
};

/**
 * Kembalikan jatah yang sudah direservasi karena pekerjaannya gagal.
 *
 * `key` harus kunci yang dipakai saat reservasi: permintaan audio dari akun
 * lama diambil dari `videoGeneration`, dan mengembalikannya ke
 * `audioGeneration` akan membuat jatahnya hilang.
 *
 * Tanpa syarat `$gte`: ini pengembalian, bukan pengurangan. Nilainya tidak bisa
 * melebihi jatah yang diambil karena setiap reservasi yang berhasil hanya
 * dikembalikan sekali.
 */
const refundQuota = async (uid, key, amount = 1) => {
  const updated = await User.findOneAndUpdate(
    { uid },
    { $inc: { [`quota.${key}`]: amount } },
    { new: true }
  );

  return updated ? updated.quota : null;
};

module.exports = {
  AUDIO_QUOTA_FALLBACK,
  remainingQuota,
  reserveQuota,
  refundQuota
};
