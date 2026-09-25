/**
 * Controller: Member
 * Daftar member yang sudah disetujui dan statistik referral
 */

const User = require('../models/User');

// Batas nilai profil yang boleh diedit sendiri oleh user (lihat updateProfile).
// Angka-angka ini juga dipakai frontend lewat atribut maxLength, jadi jangan
// diubah di satu sisi saja.
const MIN_DISPLAY_NAME = 2;
const MAX_DISPLAY_NAME = 60;
const MAX_BIO = 200;
const MAX_PHOTO_URL = 500;

/**
 * @PUT /api/v1/member/profile
 * Perbarui profil member yang sedang login.
 *
 * Yang boleh diubah hanya data tampilan: `displayName`, `bio`, dan `photoURL`.
 * Field lain sengaja diabaikan (bukan ditolak) supaya permintaan dari frontend
 * versi lama yang mengirim seluruh objek user tidak gagal — tetapi `email`,
 * `role`, `isApproved`, dan `quota` TIDAK pernah bisa diubah lewat endpoint ini:
 * itu wewenang admin (lihat routes/admin.js), dan mengizinkannya berarti siapa
 * pun bisa menyetujui akunnya sendiri.
 */
exports.updateProfile = async (req, res) => {
  try {
    const body = req.body || {};
    const perubahan = {};

    if (body.displayName !== undefined) {
      if (typeof body.displayName !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'displayName must be a string'
        });
      }

      const nama = body.displayName.trim();

      if (nama.length < MIN_DISPLAY_NAME || nama.length > MAX_DISPLAY_NAME) {
        return res.status(400).json({
          success: false,
          message: `displayName must be between ${MIN_DISPLAY_NAME} and ${MAX_DISPLAY_NAME} characters`
        });
      }

      perubahan.displayName = nama;
    }

    if (body.bio !== undefined) {
      if (typeof body.bio !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'bio must be a string'
        });
      }

      const bio = body.bio.trim();

      if (bio.length > MAX_BIO) {
        return res.status(400).json({
          success: false,
          message: `bio must be at most ${MAX_BIO} characters`
        });
      }

      perubahan.bio = bio;
    }

    if (body.photoURL !== undefined) {
      if (typeof body.photoURL !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'photoURL must be a string'
        });
      }

      const photoURL = body.photoURL.trim();

      // String kosong tetap diterima: itulah cara mengosongkan foto agar inisial
      // nama kembali dipakai. Selain itu hanya http(s) dan data URL gambar yang
      // boleh, sebab nilai ini langsung dipasang ke atribut `src` di frontend —
      // skema lain (mis. `javascript:`) tidak ada gunanya di sana.
      const alamatSah =
        photoURL === '' ||
        /^https?:\/\//i.test(photoURL) ||
        /^data:image\//i.test(photoURL);

      if (photoURL.length > MAX_PHOTO_URL) {
        return res.status(400).json({
          success: false,
          message: `photoURL must be at most ${MAX_PHOTO_URL} characters`
        });
      }

      if (!alamatSah) {
        return res.status(400).json({
          success: false,
          message: 'photoURL must be an http(s) URL, an image data URL, or empty'
        });
      }

      perubahan.photoURL = photoURL;
    }

    if (Object.keys(perubahan).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nothing to update. Send at least one of: displayName, bio, photoURL'
      });
    }

    // `req.member` diisi middleware requireMember dari database, jadi tidak perlu
    // query ulang — dan menyimpannya lewat dokumen yang sama membuat hook
    // `pre('save')` (updatedAt) tetap berjalan.
    Object.assign(req.member, perubahan);
    await req.member.save();

    res.json({
      success: true,
      message: 'Profile updated',
      user: req.member
    });
  } catch (error) {
    console.error('Failed to update profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
};

/**
 * @GET /api/v1/member/members
 * Dapatkan daftar member yang sudah disetujui (untuk referral program)
 */
exports.getApprovedMembers = async (req, res) => {
  try {
    const members = await User.find({
      isApproved: true,
      role: 'member'
    })
      .select('uid email displayName photoURL referralCode createdAt quota')
      .sort({ createdAt: -1 })
      .limit(100); // Batasi query

    res.json({
      success: true,
      count: members.length,
      members
    });
  } catch (error) {
    console.error('Failed to fetch members:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch members',
      error: error.message
    });
  }
};

/**
 * @GET /api/v1/member/members/:referralCode
 * Dapatkan profil member berdasarkan referral code (untuk halaman undangan)
 */
exports.getMemberByReferralCode = async (req, res) => {
  try {
    const { referralCode } = req.params;

    if (!referralCode) {
      return res.status(400).json({
        success: false,
        message: 'Referral code is required'
      });
    }

    const member = await User.findOne({
      referralCode: String(referralCode).trim().toUpperCase(),
      isApproved: true,
      role: 'member'
    }).select('displayName photoURL referralCode createdAt');

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    res.json({
      success: true,
      member
    });
  } catch (error) {
    console.error('Failed to fetch member:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch member',
      error: error.message
    });
  }
};

/**
 * @GET /api/v1/member/referral-stats
 * Statistik referral milik user yang sedang login:
 * berapa orang yang mendaftar memakai kode referral-nya.
 */
exports.getReferralStats = async (req, res) => {
  try {
    const referralCode = req.member.referralCode;

    const [totalReferrals, referrals] = await Promise.all([
      User.countDocuments({ referredBy: referralCode }),
      User.find({ referredBy: referralCode })
        .select('displayName photoURL isApproved createdAt')
        .sort({ createdAt: -1 })
        .limit(20)
    ]);

    res.json({
      success: true,
      referralCode,
      totalReferrals,
      referrals,
      currentQuota: req.member.quota
    });
  } catch (error) {
    console.error('Failed to fetch referral stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral stats',
      error: error.message
    });
  }
};
