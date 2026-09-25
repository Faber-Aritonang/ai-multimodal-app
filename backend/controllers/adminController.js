/**
 * Controller: Admin
 * Panel admin untuk mengelola member dan approval
 */

const User = require('../models/User');
const MediaContent = require('../models/MediaContent');
const {
  getRecentErrors: daftarGalatTerakhir,
  getErrorStats
} = require('../config/errorLog');

/**
 * @GET /api/v1/admin/pending-members
 * Dapatkan daftar member yang belum disetujui
 */
exports.getPendingMembers = async (req, res) => {
  try {
    const pendingMembers = await User.find({ 
      isApproved: false,
      role: 'guest'
    }).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: pendingMembers.length,
      members: pendingMembers
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending members',
      error: error.message
    });
  }
};

/**
 * @GET /api/v1/admin/members
 * Dapatkan semua member yang sudah disetujui
 */
exports.getApprovedMembers = async (req, res) => {
  try {
    const members = await User.find({ 
      isApproved: true,
      role: 'member'
    }).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: members.length,
      members
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch members',
      error: error.message
    });
  }
};

/**
 * @PUT /api/v1/admin/approve-member/:uid
 * Setujui member baru
 */
exports.approveMember = async (req, res) => {
  try {
    const { uid } = req.params;
    const { quota } = req.body;
    
    const user = await User.findOneAndUpdate(
      { uid, isApproved: false },
      { 
        isApproved: true,
        role: 'member',
        updatedAt: new Date(),
        // Kuota default untuk member baru. Angka yang sama juga ada di
        // models/User.js (saat registrasi) dan payload tombol approve di
        // frontend admin — ketiganya harus diubah bersama-sama.
        quota: quota || {
          chat: 60,
          imageGeneration: 30,
          audioGeneration: 25,
          videoGeneration: 25,
          total: 140
        }
      },
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Pending member not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Member approved successfully',
      member: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to approve member',
      error: error.message
    });
  }
};

/**
 * @PUT /api/v1/admin/reject-member/:uid
 * Tolak member (hapus)
 */
exports.rejectMember = async (req, res) => {
  try {
    const { uid } = req.params;
    
    const user = await User.findOneAndDelete({ 
      uid, 
      isApproved: false 
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Pending member not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Member rejected and removed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to reject member',
      error: error.message
    });
  }
};

/**
 * @GET /api/v1/admin/errors
 * Galat terakhir yang tercatat proses ini (baca catatan di config/errorLog.js).
 *
 * Ada sebagai endpoint, bukan hanya sebagai baris log, karena pertanyaan yang
 * paling sering muncul setelah deploy — "ada yang rusak tidak sejak deploy
 * terakhir?" — tidak bisa dijawab dengan menelusuri log satu per satu. Isinya
 * hanya pesan galat, stack, dan metadata request; tidak ada kredensial.
 *
 * Hanya admin (lihat routes/admin.js): daftar ini menyebut uid user dan pesan
 * internal server, jadi tidak boleh bisa dibaca anggota biasa.
 */
exports.getErrors = (req, res) => {
  res.json({
    success: true,
    ...getErrorStats(),
    errors: daftarGalatTerakhir()
  });
};

/**
 * @GET /api/v1/admin/analytics
 * Dapatkan statistik aplikasi
 */
exports.getAnalytics = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({});
    const approvedMembers = await User.countDocuments({ isApproved: true });
    const pendingMembers = await User.countDocuments({ 
      isApproved: false, 
      role: 'guest' 
    });
    const totalMedia = await MediaContent.countDocuments({});
    
    // Media per type
    const mediaByType = await MediaContent.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);
    
    res.json({
      success: true,
      analytics: {
        totalUsers,
        approvedMembers,
        pendingMembers,
        totalMedia,
        mediaByType
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: error.message
    });
  }
};