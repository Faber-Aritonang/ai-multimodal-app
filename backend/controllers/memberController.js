/**
 * Controller: Member
 * Daftar member yang sudah disetujui dan statistik referral
 */

const User = require('../models/User');

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
