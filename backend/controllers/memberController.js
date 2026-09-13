/**
 * Controller: Member
 * Menampilkan daftar member yang sudah disetujui (untuk referral)
 */

const User = require('../models/User');
const MediaContent = require('../models/MediaContent');

/**
 * @GET /api/v1/member/members
 * Dapatkan daftar member yang sudah disetujui (untuk referral program)
 */
exports.getApprovedMembers = async (req, res) => {
  try {
    // Hanya tampilkan member yang sudah disetujui
    const members = await User.find({ 
      isApproved: true,
      role: 'member'
    })
    .select('uid email displayName photoURL referralCode createdAt quota')
    .sort({ createdAt: -1 })
    .limit(100) // Batasi query
    
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
 * Dapatkan profil member berdasarkan referral code
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
      referralCode,
      isApproved: true,
      role: 'member'
    }).select('uid displayName email photoURL referralCode createdAt');
    
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
 * Dapatkan statistik referral user
 */
exports.getReferralStats = async (req, res) => {
  try {
    // Hitung berapa user yang mendaftar lewat referral ini
    const referralCount = await User.countDocuments({
      referralCode: req.member.referralCode
    });
    
    res.json({
      success: true,
      referralCode: req.member.referralCode,
      totalReferrals: referralCount,
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