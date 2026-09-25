/**
 * Controller: Auth
 * Registrasi, login, verifikasi akun, dan token management
 */

const jwt = require('jsonwebtoken');
const { getFirebaseAdmin } = require('../config/firebase');
const { lookupIp } = require('../config/ipGeo');
const User = require('../models/User');
const Admin = require('../models/Admin');

/**
 * Apakah dev-login boleh dipakai?
 *
 * Dev-login melewati verifikasi Firebase: cukup cocokkan email ke database.
 * Karena itu fitur ini hanya hidup saat NODE_ENV bukan 'production', baik di
 * sisi route (tidak dipasang) maupun di sisi controller (menolak dengan 404).
 */
const isDevLoginEnabled = () => process.env.NODE_ENV !== 'production';

exports.isDevLoginEnabled = isDevLoginEnabled;

/**
 * Kumpulkan jejak pendaftaran: IP klien, lokasi (best-effort dari ipwho.is),
 * id device browser, dan user-agent. Hasilnya disimpan di User.registrationMeta
 * dan ditampilkan admin di Pending Members untuk mendeteksi 1 device yang
 * mendaftar dengan banyak akun Google.
 *
 * Tidak pernah melempar: jejak hanya penanda, kegagalannya jangan sampai
 * menggagalkan pendaftaran.
 */
const collectRegistrationTrace = async (req) => {
  const kosong = { ip: '', location: '', deviceId: '', userAgent: '' };

  try {
    const body = req.body || {};
    const headers = req.headers || {};

    // Hanya id dengan pola wajar yang diterima supaya field ini tidak bisa
    // dipakai menyuntikkan teks sembarangan ke database.
    const deviceId =
      typeof body.deviceId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.deviceId)
        ? body.deviceId
        : '';

    // req.ip sudah IP asli klien (trust proxy diset di server.js); fallback ke
    // header pertama bila req.ip kosong (mis. di belakang proxy lain).
    const forwarded = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = String(req.ip || forwarded || '').slice(0, 64);
    const userAgent = String((req.get && req.get('user-agent')) || '').slice(0, 250);

    const geo = await lookupIp(ip);
    let location = geo ? [geo.city, geo.country].filter(Boolean).join(', ') : '';
    if (geo?.isp) location = location ? `${location} — ${geo.isp}` : geo.isp;

    return { ip, location, deviceId, userAgent };
  } catch (error) {
    console.warn('[register] jejak pendaftaran dilewati:', error?.message);
    return kosong;
  }
};

/**
 * @POST /api/v1/auth/register
 * Registrasi user baru (guest -> pending approval)
 */
exports.register = async (req, res) => {
  try {
    const { email, displayName, photoURL, firebaseToken, referralCode } = req.body;
    
    // Validasi input
    if (!email || !displayName) {
      return res.status(400).json({
        success: false,
        message: 'Email and displayName are required'
      });
    }

    // Jejak pendaftaran dikumpulkan PARALEL dengan validasi referral supaya
    // lookup geolokasi tidak menambah jeda pada alur pendaftaran.
    const tracePromise = collectRegistrationTrace(req);

    // Validasi kode referral (opsional): harus milik member yang sudah disetujui
    let referredBy = null;
    if (referralCode && String(referralCode).trim()) {
      const normalizedCode = String(referralCode).trim().toUpperCase();
      const referrer = await User.findOne({
        referralCode: normalizedCode,
        isApproved: true
      });

      if (!referrer) {
        return res.status(400).json({
          success: false,
          message: 'Referral code not found. Please check the code or leave it empty.'
        });
      }

      referredBy = referrer.referralCode;
    }
    
    // Verifikasi Firebase ID Token
    if (firebaseToken) {
      try {
        const admin = getFirebaseAdmin();
        const decoded = await admin.auth().verifyIdToken(firebaseToken);
        
        // Cek apakah user sudah terdaftar
        let user = await User.findOne({ uid: decoded.uid });
        
        if (user) {
          return res.status(409).json({
            success: false,
            message: 'User already registered'
          });
        }
        
        // Jejak pendaftaran + deteksi device/IP yang sudah dipakai pendaftar
        // lain. Sifatnya PENANDA untuk review admin — pendaftaran tidak pernah
        // diblokir di sini, karena IP bersama (CGNAT/kantor) bisa dimiliki
        // banyak orang yang tidak saling kenal.
        const trace = await tracePromise;
        let sameDeviceUid = '';
        let sameIpCount = 0;

        try {
          const [deviceTwin, ipTwins] = await Promise.all([
            trace.deviceId
              ? User.findOne({ 'registrationMeta.deviceId': trace.deviceId })
              : Promise.resolve(null),
            trace.ip
              ? User.find({ 'registrationMeta.ip': trace.ip }).select('uid')
              : Promise.resolve([])
          ]);

          if (deviceTwin) sameDeviceUid = deviceTwin.uid || '';
          if (Array.isArray(ipTwins)) sameIpCount = ipTwins.length;
        } catch (traceError) {
          // Deteksi gagal bukan alasan menolak pendaftaran.
          console.warn('[register] deteksi duplikat device/ip dilewati:', traceError?.message);
        }

        // Buat user baru
        user = await User.create({
          uid: decoded.uid,
          email: decoded.email || email,
          displayName,
          photoURL: photoURL || decoded.picture || '',
          role: 'guest',
          isApproved: false, // Perlu approval admin
          referredBy,
          registrationMeta: {
            ip: trace.ip,
            location: trace.location,
            deviceId: trace.deviceId,
            userAgent: trace.userAgent,
            sameDeviceUid,
            sameIpCount
          }
        });
        
        // Generate JWT token
        const token = jwt.sign(
          { 
            uid: user.uid, 
            email: user.email, 
            role: user.role,
            isApproved: user.isApproved
          },
          process.env.JWT_SECRET,
          { expiresIn: '7d' }
        );
        
        return res.status(201).json({
          success: true,
          message: 'Registration successful. Your account is pending admin approval.',
          token,
          user: {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            role: user.role,
            isApproved: user.isApproved
          }
        });
        
      } catch (firebaseError) {
        return res.status(401).json({
          success: false,
          message: 'Invalid Firebase token'
        });
      }
    }
    
    // Jika tidak ada Firebase token, buat user manual (untuk testing)
    const uid = `manual_${Date.now()}`;
    const user = await User.create({
      uid,
      email,
      displayName,
      photoURL: photoURL || '',
      role: 'guest',
      isApproved: false,
      referredBy
    });
    
    const token = jwt.sign(
      { uid, email, role: 'guest', isApproved: false },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    return res.status(201).json({
      success: true,
      message: 'Registration successful (manual mode). Admin approval pending.',
      token,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        isApproved: user.isApproved
      }
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * @POST /api/v1/auth/login
 * Login user
 */
exports.login = async (req, res) => {
  try {
    const { firebaseToken } = req.body;
    
    if (!firebaseToken) {
      return res.status(400).json({
        success: false,
        message: 'Firebase token required'
      });
    }
    
    // Verifikasi token
    const admin = getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(firebaseToken);
    
    // Cari user
    const user = await User.findOne({ uid: decoded.uid });
    
    // Cek apakah uid ini terdaftar sebagai admin
    const adminRecord = await Admin.findOne({ uid: decoded.uid });
    
    if (adminRecord) {
      // Update last login admin
      adminRecord.lastLogin = new Date();
      await adminRecord.save();
      
      // Generate JWT dengan role admin
      const token = jwt.sign(
        { 
          uid: adminRecord.uid, 
          email: adminRecord.email, 
          role: 'admin',
          isApproved: true
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      return res.json({
        success: true,
        message: 'Admin login successful',
        token,
        user: {
          uid: adminRecord.uid,
          email: adminRecord.email,
          displayName: adminRecord.displayName,
          photoURL: '',
          role: 'admin',
          isApproved: true
        }
      });
    }
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not registered. Please register first.'
      });
    }
    
    // Update last login
    user.lastLogin = new Date();
    await user.save();
    
    // Generate JWT
    const token = jwt.sign(
      { 
        uid: user.uid, 
        email: user.email, 
        role: user.role,
        isApproved: user.isApproved
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        role: user.role,
        isApproved: user.isApproved,
        quota: user.quota
      }
    });
    
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
};

/**
 * @POST /api/v1/auth/dev-login
 * Login instan tanpa Firebase untuk pengembangan lokal.
 *
 * Body: { email, displayName?, role? ('member' | 'guest') }
 * - email yang sudah terdaftar sebagai admin -> token role 'admin'
 * - email lain -> user dibuat/di-set sesuai role yang diminta
 *
 * Selalu mengembalikan 404 saat NODE_ENV=production.
 */
exports.devLogin = async (req, res) => {
  if (!isDevLoginEnabled()) {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }

  try {
    const { email, displayName, role } = req.body || {};

    if (!email || !String(email).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'JWT_SECRET is not set. Isi backend/.env terlebih dahulu.'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Admin dicek lebih dulu supaya bisa uji halaman /admin di lokal.
    const adminRecord = await Admin.findOne({ email: normalizedEmail });

    if (adminRecord) {
      adminRecord.lastLogin = new Date();
      await adminRecord.save();

      const token = jwt.sign(
        { uid: adminRecord.uid, email: adminRecord.email, role: 'admin', isApproved: true },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.json({
        success: true,
        message: 'Dev login successful (development only)',
        token,
        user: {
          uid: adminRecord.uid,
          email: adminRecord.email,
          displayName: adminRecord.displayName,
          photoURL: '',
          role: 'admin',
          isApproved: true
        }
      });
    }

    const requestedRole = role === 'guest' ? 'guest' : 'member';
    const isApproved = requestedRole === 'member';

    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      user = await User.create({
        uid: `dev_${normalizedEmail}`,
        email: normalizedEmail,
        displayName: displayName || normalizedEmail.split('@')[0],
        role: requestedRole,
        isApproved
      });
    } else if (user.role !== requestedRole || user.isApproved !== isApproved) {
      // Dev-login sengaja menuruti role yang diminta, supaya alur
      // 'pending approval' bisa diuji bolak-balik tanpa edit database manual.
      user.role = requestedRole;
      user.isApproved = isApproved;
      user.lastLogin = new Date();
      await user.save();
    } else {
      user.lastLogin = new Date();
      await user.save();
    }

    const token = jwt.sign(
      {
        uid: user.uid,
        email: user.email,
        role: user.role,
        isApproved: user.isApproved
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Dev login successful (development only)',
      token,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL || '',
        role: user.role,
        isApproved: user.isApproved,
        quota: user.quota
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Dev login failed',
      error: error.message
    });
  }
};

/**
 * @GET /api/v1/auth/status
 * Cek status login user
 */
exports.getAuthStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.json({
        success: true,
        isAuthenticated: false,
        role: 'guest',
        isApproved: false
      });
    }
    
    // Cek apakah uid ini terdaftar sebagai admin
    const adminRecord = await Admin.findOne({ uid: req.user.uid });
    
    if (adminRecord) {
      return res.json({
        success: true,
        isAuthenticated: true,
        user: {
          uid: adminRecord.uid,
          email: adminRecord.email,
          displayName: adminRecord.displayName,
          photoURL: '',
          role: 'admin',
          isApproved: true
        },
        role: 'admin',
        isApproved: true
      });
    }
    
    // Cari user di database
    const user = await User.findOne({ uid: req.user.uid });
    
    if (!user) {
      return res.json({
        success: true,
        isAuthenticated: true,
        user: null,
        role: 'unknown',
        isApproved: false
      });
    }
    
    return res.json({
      success: true,
      isAuthenticated: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        role: user.role,
        isApproved: user.isApproved,
        quota: user.quota
      },
      role: user.role,
      isApproved: user.isApproved
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

/**
 * @POST /api/v1/auth/logout
 * Logout user
 */
exports.logout = (req, res) => {
  res.clearCookie('token');
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};