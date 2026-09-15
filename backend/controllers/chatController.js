/**
 * Controller: Chat
 * Mengelola sesi chat user.
 *
 * Provider LLM bisa ditukar lewat env (lihat config/chatProviders.js): Groq
 * sebagai default gratis, dengan Gemini/OpenAI sebagai fallback. Controller ini
 * tidak tahu provider mana yang menjawab — yang dipakai dikembalikan di
 * response (`provider` & `model`).
 */

const ChatSession = require('../models/ChatSession');
const { generateChatReply } = require('../config/chatProviders');
const { withSystemPrompt } = require('../config/chatPersona');

/**
 * @GET /api/v1/member/chat/sessions
 * Dapatkan semua chat sessions user
 */
exports.getChatSessions = async (req, res) => {
  try {
    const sessions = await ChatSession.find({ userId: req.member.uid })
      .sort({ updatedAt: -1 })
      .select('-messages');
    
    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chat sessions',
      error: error.message
    });
  }
};

/**
 * @POST /api/v1/member/chat/sessions
 * Buat chat session baru
 */
exports.createChatSession = async (req, res) => {
  try {
    const session = await ChatSession.create({
      userId: req.member.uid,
      title: 'New Chat',
      messages: []
    });
    
    res.status(201).json({
      success: true,
      session
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create chat session',
      error: error.message
    });
  }
};

/**
 * @POST /api/v1/member/chat/:sessionId/message
 * Kirim pesan ke chat session
 */
exports.sendMessage = async (req, res) => {
  try {
    // Cek quota
    if (req.member.quota?.chat <= 0) {
      return res.status(403).json({
        success: false,
        message: 'Chat quota exhausted'
      });
    }
    
    const sessionId = req.params.sessionId;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Cari chat session
    const session = await ChatSession.findOne({
      sessionId,
      userId: req.member.uid
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
    }
    
    // Tambahkan pesan pengguna
    session.messages.push({
      role: 'user',
      content: message
    });
    
    // Panggil provider LLM yang aktif
    try {
      // System prompt dikirim ke provider tapi tidak disimpan ke sesi, jadi
      // riwayat user tetap bersih dan persona/kuota selalu memakai nilai terbaru.
      const reply = await generateChatReply({
        messages: withSystemPrompt(
          session.messages.map((m) => ({
            role: m.role,
            content: m.content
          })),
          { member: req.member }
        )
      });

      // Tambahkan pesan assistant, lengkap dengan provider/model yang menjawab
      // pesan ini supaya UI bisa memberi label yang benar per balasan.
      session.messages.push({
        role: 'assistant',
        content: reply.content,
        provider: reply.provider,
        model: reply.model
      });

      // Update title saat pertukaran pertama (user + assistant = 2 pesan).
      // Sebelumnya syaratnya `length === 3`, dan itu tidak pernah terpenuhi
      // karena array selalu berisi pasangan, sehingga judul sesi tidak pernah
      // ikut berubah dari 'New Chat'.
      if (session.messages.length === 2 && session.title === 'New Chat') {
        session.title = message.substring(0, 50) + (message.length > 50 ? '...' : '');
      }

      // Catat provider/model yang benar-benar menjawab supaya riwayat tidak
      // melaporkan model yang keliru saat provider berganti (Groq/Gemini/OpenAI).
      session.provider = reply.provider;
      session.model = reply.model;

      await session.save();

      // Kurangi quota (hanya setelah balasan benar-benar diterima)
      req.member.quota.chat -= 1;
      await req.member.save();

      res.json({
        success: true,
        response: reply.content,
        provider: reply.provider,
        model: reply.model,
        session,
        quota: req.member.quota
      });

    } catch (apiError) {
      console.error('Chat provider error:', apiError.message);

      // Bedakan masalah konfigurasi server (503) dengan kegagalan provider (502)
      const isConfigError = ['MISSING_CREDENTIALS', 'INVALID_PROVIDER_CONFIG'].includes(
        apiError.code
      );

      // Pesan user tetap disimpan supaya tidak hilang saat provider bermasalah
      await session.save();

      res.status(isConfigError ? 503 : 502).json({
        success: false,
        message: isConfigError
          ? apiError.message
          : 'AI service temporarily unavailable',
        error: apiError.message,
        session,
        quota: req.member.quota
      });
    }
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
};

/**
 * @GET /api/v1/member/chat/:sessionId
 * Dapatkan detail chat session
 */
exports.getChatSession = async (req, res) => {
  try {
    const session = await ChatSession.findOne({
      sessionId: req.params.sessionId,
      userId: req.member.uid
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
    }
    
    res.json({
      success: true,
      session
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chat session',
      error: error.message
    });
  }
};

/**
 * @DELETE /api/v1/member/chat/:sessionId
 * Hapus chat session
 */
exports.deleteChatSession = async (req, res) => {
  try {
    const session = await ChatSession.findOneAndDelete({
      sessionId: req.params.sessionId,
      userId: req.member.uid
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Chat session deleted'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete chat session',
      error: error.message
    });
  }
};