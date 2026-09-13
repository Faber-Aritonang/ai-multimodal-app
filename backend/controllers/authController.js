/**
 * Controller: Auth
 * Registrasi, login, verifikasi akun, dan token management
 */

const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const User = require('../models/User');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}'))
  });
}

/**
 * @POST /api/v1/auth/register
 * Registrasi user baru (guest -> pending approval)
 */
exports.register = async (req, res) => {
  try {
    const { email, displayName, photoURL, firebaseToken } = req.body;
    
    // Validasi input
    if (!email || !displayName) {
      return res.status(400).json({
        success: false,
        message: 'Email and displayName are required'
      });
    }
    
    // Verifikasi Firebase ID Token
    if (firebaseToken) {
      try {
        const decoded = await admin.auth().verifyIdToken(firebaseToken);
        
        // Cek apakah user sudah terdaftar
        let user = await User.findOne({ uid: decoded.uid });
        
        if (user) {
          return res.status(409).json({
            success: false,
            message: 'User already registered'
          });
        }
        
        // Buat user baru
        user = await User.create({
          uid: decoded.uid,
          email: decoded.email || email,
          displayName,
          photoURL: photoURL || decoded.picture || '',
          role: 'guest',
          isApproved: false // Perlu approval admin
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
      isApproved: false
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
    const decoded = await admin.auth().verifyIdToken(firebaseToken);
    
    // Cari user
    const user = await User.findOne({ uid: decoded.uid });
    
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