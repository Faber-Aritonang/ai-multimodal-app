/**
 * Test: pemulihan pekerjaan video yang tertinggal `processing`.
 *
 * Pekerjaan video berjalan di dalam proses Node (bukan di antrean terpisah),
 * sementara record-nya sudah tersimpan sebagai `processing` lebih dulu. Saat
 * container diganti — deploy, restart, atau instance gratis Render yang tidur —
 * proses itu berhenti tanpa sempat menutup recordnya. Dua jalur yang dijaga di
 * sini membuat user tidak menunggu selamanya:
 *
 *   1. sapu bersih saat boot (record lama ditutup), dan
 *   2. rekonsiliasi saat record dibaca (halaman riwayat & pemantau pekerjaan),
 *      dengan batas waktu pekerjaan supaya video yang MASIH berjalan tidak ikut
 *      digagalkan.
 *
 * Sejak kuota direservasi di awal request, penutupan juga harus mengembalikan
 * jatahnya — dan HANYA sekali walau dua proses menjalankan pemulihan bersamaan.
 * Karena itu transisinya memakai `findOneAndUpdate` bersyarat `status:
 * 'processing'`, bukan `updateMany`. Refund-nya sendiri dikunci di test ini.
 *
 * Model MediaContent & User di-mock, jadi test berjalan tanpa MongoDB.
 */

jest.mock('../models/MediaContent');
jest.mock('../models/User');

const MediaContent = require('../models/MediaContent');
const User = require('../models/User');
const {
  getMediaHistory,
  getMediaById,
  recoverInterruptedVideoJobs,
  markInterruptedVideoJobs,
  PESAN_JOB_TERPUTUS,
  INTERRUPTED_JOB_GRACE_MS
} = require('../controllers/mediaController');

/** Rantai query Mongoose yang bisa di-await (find().sort().skip().limit()). */
const chainable = (result) => {
  const promise = Promise.resolve(result);
  const chain = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    then: (...args) => promise.then(...args)
  };
  return chain;
};

const createRes = () => {
  const res = { statusCode: 200 };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const member = { uid: 'uid-member' };

/** Record pekerjaan video dengan umur tertentu. */
const videoRecord = (overrides = {}) => ({
  contentId: 'media_video',
  userId: 'uid-member',
  type: 'text-to-video',
  status: 'processing',
  // Jatahnya sudah direservasi saat permintaan diterima (penanda ini yang
  // membuat penutupan record mengembalikan kuota).
  quotaReserved: true,
  createdAt: new Date(Date.now() - 20 * 60 * 1000),
  ...overrides
});

/** Bentuk record yang berhasil ditutup oleh `closeInterruptedJob`. */
const closedRecord = (overrides = {}) => ({
  ...videoRecord(overrides),
  status: 'failed',
  error: { message: PESAN_JOB_TERPUTUS, code: 'JOB_INTERRUPTED' }
});

beforeEach(() => {
  MediaContent.find.mockReset();
  MediaContent.countDocuments.mockReset();
  MediaContent.findOne.mockReset();
  MediaContent.findOneAndUpdate.mockReset();
  User.findOneAndUpdate.mockReset();

  MediaContent.find.mockReturnValue(chainable([]));
  MediaContent.countDocuments.mockResolvedValue(0);
  // Default: transisi kalah balapan, yaitu record sudah tidak `processing`.
  MediaContent.findOneAndUpdate.mockResolvedValue(null);
  User.findOneAndUpdate.mockResolvedValue({ quota: { videoGeneration: 3 } });
});

describe('markInterruptedVideoJobs', () => {
  test('hanya mencari pekerjaan video yang masih processing dan sudah lewat batas', async () => {
    await markInterruptedVideoJobs({ olderThanMs: 60 * 1000 });

    const [filter] = MediaContent.find.mock.calls[0];

    // Skopnya sengaja sempit: gambar & audio tidak pernah berjalan di latar
    // belakang, dan record yang sudah selesai/gagal tidak boleh ditimpa.
    expect(filter.type).toEqual({ $in: ['text-to-video', 'image-to-video'] });
    expect(filter.status).toBe('processing');
    expect(filter.createdAt.$lt).toBeInstanceOf(Date);
  });

  test('menutup satu per satu secara atomik, lalu mengembalikan jatahnya', async () => {
    MediaContent.find.mockResolvedValue([videoRecord()]);
    MediaContent.findOneAndUpdate.mockResolvedValue(closedRecord());

    const jumlah = await markInterruptedVideoJobs({ olderThanMs: 60 * 1000 });

    expect(jumlah).toBe(1);

    // `status: 'processing'` ikut jadi syarat: hanya satu pemanggil yang bisa
    // menutupnya, sehingga refund tidak mungkin terjadi dua kali.
    expect(MediaContent.findOneAndUpdate).toHaveBeenCalledWith(
      { contentId: 'media_video', status: 'processing' },
      {
        $set: {
          status: 'failed',
          error: { message: PESAN_JOB_TERPUTUS, code: 'JOB_INTERRUPTED' }
        }
      },
      { new: true }
    );

    // Jatah sudah direservasi saat permintaan diterima; videonya tidak akan
    // pernah datang, jadi jatahnya kembali.
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { uid: 'uid-member' },
      { $inc: { 'quota.videoGeneration': 1 } },
      { new: true }
    );
  });

  test('record dari deploy lama (tanpa penanda reservasi) tidak diberi kuota gratis', async () => {
    // Record yang dibuat sebelum reservasi ada tidak pernah mengambil jatah,
    // jadi menutupnya tidak boleh menambah kuota user.
    MediaContent.find.mockResolvedValue([videoRecord({ quotaReserved: false })]);
    MediaContent.findOneAndUpdate.mockResolvedValue(
      closedRecord({ quotaReserved: false })
    );

    await markInterruptedVideoJobs({ olderThanMs: 60 * 1000 });

    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('tidak mengembalikan jatah bila transisi kalah balapan', async () => {
    MediaContent.find.mockResolvedValue([videoRecord()]);
    MediaContent.findOneAndUpdate.mockResolvedValue(null);

    const jumlah = await markInterruptedVideoJobs({ olderThanMs: 60 * 1000 });

    expect(jumlah).toBe(0);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('kegagalan database tidak melempar dan dilaporkan sebagai 0', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    MediaContent.find.mockRejectedValue(new Error('db down'));

    await expect(markInterruptedVideoJobs({ olderThanMs: 0 })).resolves.toBe(0);
    expect(log).toHaveBeenCalled();

    log.mockRestore();
  });
});

describe('recoverInterruptedVideoJobs', () => {
  test('memakai tenggang boot, bukan batas waktu pekerjaan penuh', async () => {
    MediaContent.find.mockResolvedValue([]);

    await recoverInterruptedVideoJobs();

    const [filter] = MediaContent.find.mock.calls[0];
    const umurBatas = Date.now() - filter.createdAt.$lt.getTime();

    // Container lama yang masih menyelesaikan pekerjaan (overlap deploy) tidak
    // boleh digagalkan dari luar, jadi record yang sangat baru dibiarkan.
    expect(umurBatas).toBeGreaterThanOrEqual(INTERRUPTED_JOB_GRACE_MS - 2000);
    expect(umurBatas).toBeLessThanOrEqual(INTERRUPTED_JOB_GRACE_MS + 2000);
  });

  test('mengembalikan jumlah record yang ditutup untuk dicatat di log', async () => {
    MediaContent.find.mockResolvedValue([
      videoRecord({ contentId: 'media_a', userId: 'uid-a' }),
      videoRecord({ contentId: 'media_b', userId: 'uid-b' })
    ]);
    MediaContent.findOneAndUpdate.mockImplementation(async (filter) => closedRecord(filter));

    await expect(recoverInterruptedVideoJobs()).resolves.toBe(2);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });
});

describe('getMediaById', () => {
  test('menutup pekerjaan yang sudah lewat batas waktu dan mengembalikan jatahnya', async () => {
    MediaContent.findOne.mockResolvedValue(videoRecord());
    MediaContent.findOneAndUpdate.mockResolvedValue(closedRecord());

    const res = createRes();
    await getMediaById({ params: { contentId: 'media_video' }, member }, res);

    expect(MediaContent.findOneAndUpdate).toHaveBeenCalledWith(
      { contentId: 'media_video', status: 'processing' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
      { new: true }
    );
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { uid: 'uid-member' },
      { $inc: { 'quota.videoGeneration': 1 } },
      { new: true }
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        media: expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({ code: 'JOB_INTERRUPTED' })
        })
      })
    );
  });

  test('membiarkan pekerjaan yang masih dalam batas waktu', async () => {
    MediaContent.findOne.mockResolvedValue(videoRecord({ createdAt: new Date() }));

    const res = createRes();
    await getMediaById({ params: { contentId: 'media_video' }, member }, res);

    expect(MediaContent.findOneAndUpdate).not.toHaveBeenCalled();
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ media: expect.objectContaining({ status: 'processing' }) })
    );
  });

  test('tidak menyentuh fitur yang bukan pekerjaan latar belakang', async () => {
    // Gambar/audio selesai di dalam siklus request; record `processing` yang
    // lama di sana bukan pekerjaan yang ditinggalkan, jadi bukan urusan di sini.
    MediaContent.findOne.mockResolvedValue(videoRecord({ type: 'text-to-image' }));

    const res = createRes();
    await getMediaById({ params: { contentId: 'media_video' }, member }, res);

    expect(MediaContent.findOneAndUpdate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ media: expect.objectContaining({ status: 'processing' }) })
    );
  });

  test('pekerjaan yang ternyata selesai lebih dulu tidak ditimpa', async () => {
    MediaContent.findOne.mockResolvedValue(videoRecord());
    MediaContent.findOneAndUpdate.mockResolvedValue(null);

    const res = createRes();
    await getMediaById({ params: { contentId: 'media_video' }, member }, res);

    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('kegagalan mengembalikan jatah tidak membuat request gagal', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    MediaContent.findOne.mockResolvedValue(videoRecord());
    MediaContent.findOneAndUpdate.mockResolvedValue(closedRecord());
    User.findOneAndUpdate.mockRejectedValue(new Error('db down'));

    const res = createRes();
    await getMediaById({ params: { contentId: 'media_video' }, member }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ media: expect.objectContaining({ status: 'failed' }) })
    );

    log.mockRestore();
  });
});

describe('getMediaHistory', () => {
  test('menutup hanya pekerjaan video yang basi, dan mengembalikan jatahnya', async () => {
    const basi = videoRecord({ contentId: 'media_basi', type: 'image-to-video' });
    const segar = videoRecord({ contentId: 'media_segar', createdAt: new Date() });
    const gambar = videoRecord({ contentId: 'media_gambar', type: 'text-to-image' });

    MediaContent.find.mockReturnValue(chainable([basi, segar, gambar]));
    MediaContent.countDocuments.mockResolvedValue(3);
    MediaContent.findOneAndUpdate.mockImplementation(async (filter) =>
      closedRecord({ contentId: filter.contentId, userId: 'uid-member' })
    );

    const res = createRes();
    await getMediaHistory({ member, query: {}, quota: undefined }, res);

    const body = res.json.mock.calls[0][0];

    expect(body.media[0]).toEqual(
      expect.objectContaining({
        contentId: 'media_basi',
        status: 'failed',
        error: expect.objectContaining({ code: 'JOB_INTERRUPTED' })
      })
    );
    expect(body.media[1].status).toBe('processing');
    expect(body.media[2].status).toBe('processing');

    // Hanya record yang basi yang ditutup, dan pengembaliannya sekali.
    expect(MediaContent.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test('tidak menulis ke database kalau tidak ada yang basi', async () => {
    MediaContent.find.mockReturnValue(chainable([videoRecord({ createdAt: new Date() })]));
    MediaContent.countDocuments.mockResolvedValue(1);

    const res = createRes();
    await getMediaHistory({ member, query: {}, quota: undefined }, res);

    expect(MediaContent.findOneAndUpdate).not.toHaveBeenCalled();
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('kegagalan menutup record tidak menggagalkan riwayat', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    MediaContent.find.mockReturnValue(chainable([videoRecord()]));
    MediaContent.countDocuments.mockResolvedValue(1);
    MediaContent.findOneAndUpdate.mockRejectedValue(new Error('db down'));

    const res = createRes();
    await getMediaHistory({ member, query: {}, quota: undefined }, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.media[0].status).toBe('processing');

    log.mockRestore();
  });
});
