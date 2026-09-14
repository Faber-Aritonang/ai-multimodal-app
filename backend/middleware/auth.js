/**
 * Authentication Middleware
 * Memverifikasi token JWT dan/atau Firebase ID Token
 */

const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const User = require('../models/User');
const Admin = require('../models/Admin');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}'))
  });
}

/**
 * Middleware untuk verifikasi JWT atau Firebase Token
 */
exports.authenticate = async (req, res, next) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }
    
    // Verifikasi JWT
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (jwtError) {
      // Jika JWT invalid, coba verifikasi Firebase token
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = { uid: decodedToken.uid, email: decodedToken.email };
        return next();
      } catch (firebaseError) {
        throw new Error('Invalid token');
      }
    }
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Authentication failed',
      error: error.message
    });
  }
};

/**
 * Middleware untuk verifikasi token secara opsional
 * Tidak menolak request jika token tidak ada
 */
exports.optionalAuth = async (req, res, next) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (jwtError) {
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = { uid: decodedToken.uid, email: decodedToken.email };
        return next();
      } catch (firebaseError) {
        req.user = null;
        return next();
      }
    }
  } catch (error) {
    req.user = null;
    return next();
  }
};

/**
 * Middleware untuk member (user yang sudah disetujui)
 */
exports.requireMember = async (req, res, next) => {
  try {
    // Pastikan user terautentikasi
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    // Cari user di database
    const user = await User.findOne({ uid: req.user.uid });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Cek apakah user sudah disetujui
    if (!user.isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending approval. Please wait for admin approval.',
        role: 'pending'
      });
    }
    
    if (user.role !== 'member') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Member role required.',
        role: user.role
      });
    }
    
    req.member = user;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

/**
 * Middleware untuk admin
 */
exports.requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const adminUser = await Admin.findOne({ uid: req.user.uid });
    
    if (!adminUser) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    req.admin = adminUser;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

/**
 * Middleware untuk guest (user yang belum daftar)
 */
exports.requireGuest = async (req, res, next) => {
  if (req.user && req.user.uid) {
    return res.status(400).json({
      success: false,
      message: 'Already authenticated'
    });
  }
  next();
};

/**
 * Optional: Check quota
 */
exports.checkQuota = (type) => {
  return async (req, res, next) => {
    try {
      if (!req.member) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }
      
      const remaining = req.member.quota?.[type];
      
      if (remaining === undefined || remaining <= 0) {
        return res.status(403).json({
          success: false,
          message: `Quota for ${type} exhausted. Please upgrade your plan.`
        });
      }
      
      req.quota = { type, remaining };
      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Server error',
        error: error.message
      });
    }
  };
};