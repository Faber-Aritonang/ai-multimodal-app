/**
 * Controller: Chat
 * Mengelola sesi chat user
 */

const ChatSession = require('../models/ChatSession');
const { getOpenAIClient, getChatModel } = require('../config/openai');

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
    
    // Panggil OpenAI API
    try {
      const openaiResponse = await getOpenAIClient().chat.completions.create({
        model: getChatModel(),
        messages: session.messages.map(m => ({
          role: m.role,
          content: m.content
        })),
        max_tokens: 2000
      });

      const assistantMessage = openaiResponse.choices[0].message.content;
      
      // Tambahkan pesan assistant
      session.messages.push({
        role: 'assistant',
        content: assistantMessage
      });
      
      // Update title jika pertama kali chat
      if (session.messages.length === 3 && session.title === 'New Chat') {
        session.title = message.substring(0, 50) + (message.length > 50 ? '...' : '');
      }
      
      await session.save();
      
      // Kurangi quota
      req.member.quota.chat -= 1;
      await req.member.save();
      
      res.json({
        success: true,
        response: assistantMessage,
        session,
        quota: req.member.quota
      });
      
    } catch (apiError) {
      console.error('OpenAI API Error:', apiError.message);
      
      // Simpan pesan user saja jika API gagal
      await session.save();
      
      res.status(500).json({
        success: false,
        message: 'AI service temporarily unavailable',
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