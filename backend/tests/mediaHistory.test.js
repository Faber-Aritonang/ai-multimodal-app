/**
 * Test: mediaController.getMediaHistory
 *
 * Yang diuji adalah hal-hal yang mudah salah dan berdampak langsung ke UI:
 * kata kunci yang mengandung karakter regex, filter jenis/status yang tidak
 * dikenal, dan perhitungan halaman. Model MediaContent di-mock, jadi test ini
 * tidak butuh MongoDB.
 */

jest.mock('../models/MediaContent');

const MediaContent = require('../models/MediaContent');
const { getMediaHistory } = require('../controllers/mediaController');

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
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const member = { uid: 'uid-member', quota: {} };

beforeEach(() => {
  MediaContent.find.mockReset();
  MediaContent.countDocuments.mockReset();
  MediaContent.find.mockReturnValue(chainable([]));
  MediaContent.countDocuments.mockResolvedValue(0);
});

describe('getMediaHistory', () => {
  test('membatasi query pada media milik user dan menghitung paginasi', async () => {
    MediaContent.find.mockReturnValue(chainable([{ contentId: 'media_1' }]));
    MediaContent.countDocuments.mockResolvedValue(30);

    const req = { member, query: { limit: '12', page: '2' } };
    const res = createRes();

    await getMediaHistory(req, res);

    // Filter yang sama dipakai untuk menghitung total, bukan hanya untuk
    // mengambil itemnya — kalau tidak, jumlah halaman tidak cocok dengan isinya.
    expect(MediaContent.find).toHaveBeenCalledWith({ userId: 'uid-member' });
    expect(MediaContent.countDocuments).toHaveBeenCalledWith({ userId: 'uid-member' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1, total: 30, page: 2, limit: 12, pages: 3, hasMore: true })
    );
  });

  test('kata kunci pencarian di-escape, bukan dipakai mentah sebagai regex', async () => {
    const req = { member, query: { q: 'kucing (oranye) c++' } };
    const res = createRes();

    await getMediaHistory(req, res);

    expect(MediaContent.find).toHaveBeenCalledWith({
      userId: 'uid-member',
      prompt: { $regex: 'kucing \\(oranye\\) c\\+\\+', $options: 'i' }
    });
  });

  test('filter jenis & status diteruskan ke query', async () => {
    const req = { member, query: { type: 'text-to-video', status: 'failed' } };
    const res = createRes();

    await getMediaHistory(req, res);

    expect(MediaContent.find).toHaveBeenCalledWith({
      userId: 'uid-member',
      type: 'text-to-video',
      status: 'failed'
    });
  });

  test('jenis yang tidak dikenal ditolak 400, bukan berakhir 500', async () => {
    const req = { member, query: { type: 'text-to-3d' } };
    const res = createRes();

    await getMediaHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(MediaContent.find).not.toHaveBeenCalled();
  });

  test('status yang tidak dikenal ditolak 400', async () => {
    const req = { member, query: { status: 'selesai' } };
    const res = createRes();

    await getMediaHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(MediaContent.find).not.toHaveBeenCalled();
  });

  test('limit ekstrem dibatasi 1..100 dan halaman minimal 1', async () => {
    const req = { member, query: { limit: '5000', page: '-3' } };
    const res = createRes();

    await getMediaHistory(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 100 }));
  });

  test('kegagalan database dijawab 500', async () => {
    MediaContent.find.mockImplementation(() => {
      throw new Error('db down');
    });

    const req = { member, query: {} };
    const res = createRes();

    await getMediaHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Failed to fetch media history' })
    );
  });
});
