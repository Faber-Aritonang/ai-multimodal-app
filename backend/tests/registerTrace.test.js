/**
 * Test: jejak pendaftaran & deteksi device/IP ganda
 *
 * - register menyimpan IP, lokasi (ipwho.is), deviceId, dan user-agent
 * - device yang sudah dipakai akun lain ditandai (sameDeviceUid), bukan diblokir
 * - IP yang sama dengan akun lain ditandai (sameIpCount), bukan diblokir
 * - kegagalan lookup lokasi / deteksi TIDAK menggagalkan pendaftaran
 */

jest.mock('../models/User');
jest.mock('../models/Admin');
jest.mock('../config/firebase', () => ({
  getFirebaseAdmin: () => ({
    auth: () => ({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'uid-new',
        email: 'new@example.com',
        picture: 'https://example.com/pic.png'
      })
    })
  })
}));
jest.mock('../config/ipGeo', () => ({
  lookupIp: jest.fn()
}));

process.env.JWT_SECRET = 'test-secret';

const User = require('../models/User');
const { lookupIp } = require('../config/ipGeo');
const { register } = require('../controllers/authController');

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const makeReq = ({ body, ...rest } = {}) => ({
  body: {
    email: 'new@example.com',
    displayName: 'New User',
    firebaseToken: 'firebase-id-token',
    deviceId: 'device-abc-12345',
    ...body
  },
  ip: '103.45.67.89',
  headers: {},
  get: (header) => (header === 'user-agent' ? 'Mozilla/5.0 (Test)' : undefined),
  ...rest
});

const lastCreateDoc = () => User.create.mock.calls[User.create.mock.calls.length - 1][0];

beforeEach(() => {
  jest.clearAllMocks();

  // Default: device/IP baru, lookup lokasi berhasil.
  User.findOne.mockImplementation(async (query) => {
    if (query.uid) return null; // uid belum terdaftar
    if (query['registrationMeta.deviceId']) return null; // device baru
    return null;
  });
  User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
  User.create.mockImplementation(async (doc) => ({
    ...doc,
    referralCode: 'REFNEW01'
  }));
  lookupIp.mockResolvedValue({ city: 'Jakarta', country: 'Indonesia', isp: 'Telkomsel' });
});

describe('jejak pendaftaran', () => {
  test('menyimpan IP, lokasi, deviceId, dan user-agent', async () => {
    const res = createRes();
    await register(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(lookupIp).toHaveBeenCalledWith('103.45.67.89');
    expect(lastCreateDoc().registrationMeta).toEqual({
      ip: '103.45.67.89',
      location: 'Jakarta, Indonesia — Telkomsel',
      deviceId: 'device-abc-12345',
      userAgent: 'Mozilla/5.0 (Test)',
      sameDeviceUid: '',
      sameIpCount: 0
    });
  });

  test('deviceId dengan pola tidak wajar dibuang, pendaftaran tetap jalan', async () => {
    const res = createRes();
    await register(makeReq({ body: { deviceId: 'id dengan spasi!' } }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(lastCreateDoc().registrationMeta.deviceId).toBe('');
  });
});

describe('penanda duplikat (tandai, bukan blokir)', () => {
  test('device yang sudah dipakai akun lain ditandai lewat sameDeviceUid', async () => {
    User.findOne.mockImplementation(async (query) => {
      if (query['registrationMeta.deviceId']) return { uid: 'uid-pemilik-lama' };
      return null;
    });

    const res = createRes();
    await register(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(lastCreateDoc().registrationMeta.sameDeviceUid).toBe('uid-pemilik-lama');
  });

  test('IP yang dipakai akun lain ditandai lewat sameIpCount', async () => {
    User.find.mockReturnValue({
      select: jest.fn().mockResolvedValue([{ uid: 'a' }, { uid: 'b' }])
    });

    const res = createRes();
    await register(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(User.find).toHaveBeenCalledWith({ 'registrationMeta.ip': '103.45.67.89' });
    expect(lastCreateDoc().registrationMeta.sameIpCount).toBe(2);
  });
});

describe('kegagalan tidak boleh menggagalkan pendaftaran', () => {
  test('lookup lokasi gagal -> tanpa lokasi, register tetap 201', async () => {
    lookupIp.mockResolvedValue(null);

    const res = createRes();
    await register(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(lastCreateDoc().registrationMeta.location).toBe('');
  });

  test('query deteksi duplikat error -> penanda kosong, register tetap 201', async () => {
    User.find.mockImplementation(() => {
      throw new Error('database down');
    });

    const res = createRes();
    await register(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(lastCreateDoc().registrationMeta).toEqual(
      expect.objectContaining({ sameDeviceUid: '', sameIpCount: 0 })
    );
  });
});
