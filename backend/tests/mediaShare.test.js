/**
 * Test: tautan baca-saja (shareMedia / unshareMedia / getSharedMedia).
 *
 * Endpoint ini adalah satu-satunya tempat di aplikasi yang mengeluarkan data
 * user TANPA login. Karena itu yang diuji di sini bukan sekadar "berhasil
 * dibuat", melainkan tiga batas yang menentukan apakah fitur ini aman:
 *
 *   1. hanya pemilik yang bisa membuat dan mencabut tautannya;
 *   2. yang keluar hanya bidang tampilan — `userId`, referensi penyimpanan
 *      (`outputFile`), dan pesan galat internal tidak pernah ikut;
 *   3. token yang tidak sah/asing dijawab 404 tanpa menyentuh database.
 *
 * Model dimock, jadi test ini tidak butuh MongoDB.
 */

jest.mock('../models/MediaContent');
jest.mock('../models/User');

const MediaContent = require('../models/MediaContent');
const User = require('../models/User');
const {
  shareMedia,
  unshareMedia,
  getSharedMedia,
  publicMediaView,
  POLA_TOKEN_BAGIKAN
} = require('../controllers/mediaController');

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const member = { uid: 'uid-member' };

// Token berbentuk sama dengan yang dibuat server (32 karakter base64url); token
// yang terlalu pendek ditolak sebelum menyentuh database, jadi nilai asal-asalan
// di test justru menguji hal yang lain.
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

const buatMedia = (tambahan = {}) => {
  const media = {
    contentId: 'media_1',
    userId: 'uid-member',
    type: 'text-to-image',
    prompt: 'kucing di atap',
    status: 'completed',
    outputUrl: '/uploads/media_1.png',
    inputFile: null,
    outputFile: 's3://bucket-rahasia/kunci/internal.png',
    shareToken: undefined,
    sharedAt: null,
    metadata: { width: 1024, height: 1024, provider: 'cloudflare', jobId: 'job-9' },
    error: { message: 'pesan internal provider' },
    createdAt: new Date('2026-09-24T10:00:00.000Z'),
    completedAt: new Date('2026-09-24T10:00:05.000Z'),
    save: jest.fn().mockResolvedValue(true),
    set: jest.fn(function set(kunci, nilai) {
      this[kunci] = nilai;
      return this;
    })
  };

  return Object.assign(media, tambahan);
};

/** Rantai `.select()` milik User.findOne. */
const pemilikMengembalikan = (nilai) => {
  User.findOne.mockReturnValue({ select: () => Promise.resolve(nilai) });
};

beforeEach(() => {
  MediaContent.findOne.mockReset();
  MediaContent.findOne.mockResolvedValue(null);
  User.findOne.mockReset();
  pemilikMengembalikan({ displayName: 'Budi' });
});

describe('shareMedia', () => {
  test('membuat token saat hasil dibagikan pertama kali', async () => {
    const media = buatMedia();
    MediaContent.findOne.mockResolvedValue(media);
    const res = createRes();

    await shareMedia({ member, params: { contentId: 'media_1' } }, res);

    expect(MediaContent.findOne).toHaveBeenCalledWith({
      contentId: 'media_1',
      userId: 'uid-member'
    });
    expect(media.save).toHaveBeenCalled();
    expect(media.shareToken).toMatch(POLA_TOKEN_BAGIKAN);
    expect(media.sharedAt).toBeInstanceOf(Date);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        shareToken: media.shareToken,
        sharePath: `/share/${media.shareToken}`
      })
    );
  });

  test('tokennya acak dan panjang, bukan contentId yang bisa ditebak', async () => {
    const media = buatMedia();
    MediaContent.findOne.mockResolvedValue(media);

    await shareMedia({ member, params: { contentId: 'media_1' } }, createRes());

    expect(media.shareToken).not.toContain('media_1');
    // 24 byte -> 32 karakter base64url.
    expect(media.shareToken).toHaveLength(32);
  });

  test('idempoten: tautan yang sudah ada tidak diganti', async () => {
    // Tautan lama yang sudah disebar tidak boleh diam-diam mati hanya karena
    // pemiliknya menekan tombol Bagikan sekali lagi.
    const media = buatMedia({ shareToken: TOKEN, sharedAt: new Date() });
    MediaContent.findOne.mockResolvedValue(media);
    const res = createRes();

    await shareMedia({ member, params: { contentId: 'media_1' } }, res);

    expect(media.save).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ shareToken: TOKEN }));
  });

  test('media milik user lain terlihat sama dengan media yang tidak ada', async () => {
    MediaContent.findOne.mockResolvedValue(null);
    const res = createRes();

    await shareMedia({ member, params: { contentId: 'media_orang_lain' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Media not found' });
  });

  test.each([
    ['masih diproses', { status: 'processing' }],
    ['gagal', { status: 'failed' }],
    ['selesai tetapi tanpa berkas', { status: 'completed', outputUrl: null }]
  ])('hasil yang %s tidak bisa dibagikan (409)', async (_nama, kondisi) => {
    MediaContent.findOne.mockResolvedValue(buatMedia(kondisi));
    const res = createRes();

    await shareMedia({ member, params: { contentId: 'media_1' } }, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('tabrakan token diulang, bukan langsung gagal', async () => {
    const media = buatMedia();
    media.save
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 11000 }))
      .mockResolvedValueOnce(true);
    MediaContent.findOne.mockResolvedValue(media);
    const res = createRes();

    await shareMedia({ member, params: { contentId: 'media_1' } }, res);

    expect(media.save).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('kegagalan simpan di luar tabrakan token dijawab 500', async () => {
    const media = buatMedia();
    media.save.mockRejectedValue(Object.assign(new Error('db down'), { code: 2 }));
    MediaContent.findOne.mockResolvedValue(media);
    const res = createRes();

    await shareMedia({ member, params: { contentId: 'media_1' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('unshareMedia', () => {
  test('mencabut tautan dengan menghapus tokennya', async () => {
    const media = buatMedia({ shareToken: TOKEN, sharedAt: new Date() });
    MediaContent.findOne.mockResolvedValue(media);
    const res = createRes();

    await unshareMedia({ member, params: { contentId: 'media_1' } }, res);

    // Dihapus (undefined -> $unset), bukan diisi null: index unik `sparse`
    // mengabaikan field yang tidak ada, sedangkan null dianggap nilai.
    expect(media.set).toHaveBeenCalledWith('shareToken', undefined);
    expect(media.sharedAt).toBeNull();
    expect(media.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('mencabut yang belum pernah dibagikan bukan kesalahan', async () => {
    const media = buatMedia();
    MediaContent.findOne.mockResolvedValue(media);
    const res = createRes();

    await unshareMedia({ member, params: { contentId: 'media_1' } }, res);

    expect(media.save).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('media milik user lain tidak bisa dicabut', async () => {
    MediaContent.findOne.mockResolvedValue(null);
    const res = createRes();

    await unshareMedia({ member, params: { contentId: 'media_orang_lain' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('getSharedMedia', () => {
  test('mengembalikan hasil yang dibagikan, lengkap dengan nama pemiliknya', async () => {
    MediaContent.findOne.mockResolvedValue(buatMedia({ shareToken: TOKEN }));
    const res = createRes();

    await getSharedMedia({ params: { token: TOKEN } }, res);

    expect(MediaContent.findOne).toHaveBeenCalledWith({ shareToken: TOKEN });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        media: expect.objectContaining({
          type: 'text-to-image',
          prompt: 'kucing di atap',
          outputUrl: '/uploads/media_1.png',
          sharedBy: 'Budi'
        })
      })
    );
  });

  test.each([
    ['terlalu pendek', 'abc'],
    ['kosong', ''],
    ['berisi karakter aneh', 'token/../../etc/passwd'],
    ['terlalu panjang', 'a'.repeat(100)]
  ])('token %s dijawab 404 tanpa menyentuh database', async (_nama, token) => {
    const res = createRes();

    await getSharedMedia({ params: { token } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(MediaContent.findOne).not.toHaveBeenCalled();
  });

  test('token yang tidak dikenal dijawab 404', async () => {
    MediaContent.findOne.mockResolvedValue(null);
    const res = createRes();

    await getSharedMedia({ params: { token: 'TokenYangTidakAdaTapiPanjang32Karakter' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('kegagalan membaca nama pemilik tidak mematikan tautan yang sah', async () => {
    MediaContent.findOne.mockResolvedValue(buatMedia({ shareToken: TOKEN }));
    User.findOne.mockImplementation(() => {
      throw new Error('db down');
    });
    const res = createRes();

    await getSharedMedia({ params: { token: TOKEN } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, media: expect.objectContaining({ sharedBy: null }) })
    );
  });

  test('token yang dikembalikan tautannya bisa dibaca kembali tanpa login', async () => {
    // Rangkaian penuh: buat tautan, lalu baca lewat endpoint publik.
    const media = buatMedia();
    MediaContent.findOne.mockResolvedValueOnce(media);
    await shareMedia({ member, params: { contentId: 'media_1' } }, createRes());

    MediaContent.findOne.mockResolvedValueOnce(media);
    const res = createRes();
    await getSharedMedia({ params: { token: media.shareToken } }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('publicMediaView', () => {
  test('hanya memuat bidang tampilan; identitas & referensi penyimpanan tidak ikut', () => {
    const tampilan = publicMediaView(buatMedia(), 'Budi');
    const teks = JSON.stringify(tampilan);

    expect(tampilan.outputUrl).toBe('/uploads/media_1.png');
    expect(tampilan.sharedBy).toBe('Budi');

    // Yang tidak boleh keluar, dalam bentuk apa pun.
    expect(teks).not.toContain('uid-member');
    expect(teks).not.toContain('bucket-rahasia');
    expect(teks).not.toContain('pesan internal provider');
    expect('userId' in tampilan).toBe(false);
    expect('outputFile' in tampilan).toBe(false);
    expect('error' in tampilan).toBe(false);
    expect('shareToken' in tampilan).toBe(false);
  });

  test('bidang metadata baru yang tidak didaftarkan otomatis tidak terkirim', () => {
    // Daftar putih, bukan daftar hitam: bidang baru di skema tidak ikut keluar
    // tanpa ada yang memutuskan.
    const tampilan = publicMediaView(
      buatMedia({ metadata: { width: 1, jobId: 'job-9', catatanInternal: 'jangan keluar' } }),
      null
    );

    expect(tampilan.metadata.width).toBe(1);
    expect('jobId' in tampilan.metadata).toBe(false);
    expect('catatanInternal' in tampilan.metadata).toBe(false);
  });

  test('gambar sumber (inputUrl) ikut supaya hasil bisa dinilai', () => {
    const tampilan = publicMediaView(buatMedia({ inputFile: '/uploads/media_1_input.png' }), null);

    expect(tampilan.inputUrl).toBe('/uploads/media_1_input.png');
  });
});
