/**
 * Controller: Admin
 * Panel admin untuk mengelola member dan approval
 */

const User = require('../models/User');
const MediaContent = require('../models/MediaContent');
const ChatSession = require('../models/ChatSession');
const Payment = require('../models/Payment');
const { quotaForPlan } = require('../config/membershipPlans');
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
        // Kuota default member baru = paket free (config/membershipPlans.js).
        // Pendaftar paket paid TIDAK lewat jalur ini: mereka aktif otomatis
        // dengan kuota 5x setelah pembayaran diterima gateway
        // (paymentController.activatePaidMember). Admin tetap boleh mengirim
        // `quota` kustom lewat payload bila ingin menyetujui dengan jatah lain.
        quota: quota || quotaForPlan('free')
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
    });
  }
};

// Batas jumlah baris aktivitas yang dikirim untuk satu user. Riwayat chat dan
// media bisa panjang; halaman admin hanya perlu gambaran pemakaian terbaru,
// sedangkan jumlah totalnya tetap dilaporkan di `summary`. Tanpa batas ini satu
// member lama bisa mengirim respons berukuran beberapa megabyte.
const CHAT_SESSION_LIMIT = 20;
const MEDIA_LIMIT = 50;

/**
 * @GET /api/v1/admin/members/:uid
 * Rincian satu user: profil, ringkasan pemakaian, sesi chat, media, dan
 * pembayaran. Dipakai halaman `/admin/members/:uid`.
 *
 * Hanya admin (lihat routes/admin.js): isinya percakapan pribadi user, jadi
 * endpoint ini tidak boleh bisa dibaca anggota biasa. `shareToken` sengaja tidak
 * ikut dikirim — token itu memberi akses baca tanpa login, dan admin tidak
 * membutuhkannya untuk meninjau aktivitas.
 */
exports.getMemberDetail = async (req, res) => {
  try {
    const { uid } = req.params;

    const user = await User.findOne({ uid });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const [chatSessions, media, payments, chatSessionCount, mediaCount] = await Promise.all([
      ChatSession.find({ userId: uid })
        .sort({ updatedAt: -1 })
        .limit(CHAT_SESSION_LIMIT),
      MediaContent.find({ userId: uid })
        .sort({ createdAt: -1 })
        .limit(MEDIA_LIMIT)
        .select('-shareToken'),
      // Tanpa batas: satu user hanya punya segelintir transaksi, dan total
      // pembayaran di bawah harus dihitung dari seluruh riwayat — bukan dari
      // potongan yang kebetulan muat di satu halaman.
      Payment.find({ uid }).sort({ createdAt: -1 }),
      ChatSession.countDocuments({ userId: uid }),
      MediaContent.countDocuments({ userId: uid })
    ]);

    const totalPaid = payments
      .filter((payment) => payment.status === 'paid')
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);

    res.json({
      success: true,
      user,
      summary: {
        chatSessions: chatSessionCount,
        media: mediaCount,
        payments: payments.length,
        totalPaid,
        chatSessionLimit: CHAT_SESSION_LIMIT,
        mediaLimit: MEDIA_LIMIT
      },
      chatSessions,
      media,
      payments
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch member detail',
    });
  }
};

// Batas jumlah transaksi per permintaan. Daftar ini bisa dilihat admin tanpa
// filter, jadi tanpa batas ia tumbuh seiring jumlah pembeli. Angka totalnya
// tetap dilaporkan terpisah (`count`), sehingga "berapa banyak" tidak bergantung
// pada berapa baris yang kebetulan dikirim.
const PAYMENT_LIMIT_DEFAULT = 100;
const PAYMENT_LIMIT_MAX = 200;
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'expired'];

// Karakter regex di kata kunci diperlakukan sebagai teks biasa: admin yang
// mencari "a+b" atau "(tes)" harus mendapat hasil yang ia maksud, bukan pola
// regex yang bisa (pada kasus terburuk) membuat query sangat mahal.
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @GET /api/v1/admin/payments
 * Daftar transaksi semua user (terbaru lebih dulu), lengkap dengan pemiliknya.
 *
 * `?status=paid|pending|failed|expired` memfilter daftar. Nilai lain diabaikan
 * (bukan error) supaya tautan lama tetap menampilkan sesuatu yang masuk akal.
 * `?q=` mencari pemilik transaksi berdasarkan nama atau email; Payment tidak
 * menyimpan nama, jadi uid yang cocok dicari dulu di koleksi User.
 * `totalPaid` sengaja selalu menghitung SELURUH transaksi berstatus `paid`,
 * bukan hanya yang lolos filter — angka itu menjawab "berapa uang yang sudah
 * masuk", sedangkan filter menjawab "transaksi mana yang ingin dilihat".
 */
exports.getPayments = async (req, res) => {
  try {
    const diminta = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(diminta) && diminta > 0
      ? Math.min(diminta, PAYMENT_LIMIT_MAX)
      : PAYMENT_LIMIT_DEFAULT;

    const filter = PAYMENT_STATUSES.includes(req.query.status)
      ? { status: req.query.status }
      : {};

    const kata = String(req.query.q || '').trim();

    if (kata) {
      const pola = new RegExp(escapeRegExp(kata), 'i');
      const pemilik = await User.find({
        $or: [{ displayName: pola }, { email: pola }]
      }).select('uid');

      // Tidak ada user yang cocok bukan kesalahan: hasilnya kosong. `$in: []`
      // membuat query transaksi tetap satu bentuk saja, tanpa cabang khusus.
      filter.uid = { $in: pemilik.map((user) => user.uid) };
    }

    const [payments, count, paidTotals] = await Promise.all([
      Payment.find(filter).sort({ createdAt: -1 }).limit(limit),
      Payment.countDocuments(filter),
      Payment.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    // Pemilik transaksi diambil sekaligus, bukan satu query per baris. Hanya
    // bidang tampilan yang dikirim; admin tidak perlu seluruh dokumen user di
    // sini karena detail lengkapnya ada di /admin/members/:uid.
    const uids = [...new Set(payments.map((payment) => payment.uid))];
    const users = uids.length
      ? await User.find({ uid: { $in: uids } }).select(
          'uid displayName email plan isApproved'
        )
      : [];
    const userByUid = new Map(users.map((user) => [user.uid, user]));

    res.json({
      success: true,
      count,
      returned: payments.length,
      limit,
      totalPaid: paidTotals[0]?.total || 0,
      payments: payments.map((payment) => {
        const dokumen =
          typeof payment.toObject === 'function' ? payment.toObject() : payment;
        const user = userByUid.get(dokumen.uid);

        return {
          ...dokumen,
          user: user
            ? {
                uid: user.uid,
                displayName: user.displayName,
                email: user.email,
                plan: user.plan,
                isApproved: user.isApproved
              }
            : null
        };
      })
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payments',
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

    // Transaksi per status: jumlah DAN nominalnya. Dashboard menampilkan
    // keduanya, dan menghitungnya di sisi klien tidak mungkin benar karena
    // daftar transaksi dibatasi 100 baris per permintaan.
    const paymentsByStatus = await Payment.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }
    ]);
    
    res.json({
      success: true,
      analytics: {
        totalUsers,
        approvedMembers,
        pendingMembers,
        totalMedia,
        mediaByType,
        paymentsByStatus
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
    });
  }
};