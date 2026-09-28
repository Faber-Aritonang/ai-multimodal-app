/**
 * Authenticated Composio connector endpoints for chat.
 */

const ChatSession = require('../models/ChatSession');
const PendingConnectorAction = require('../models/PendingConnectorAction');
const composio = require('../config/composio');

const PENDING_TTL_MS = 10 * 60 * 1000;

const publicPendingAction = (action) => ({
  actionId: action.actionId,
  toolkit: action.toolkit,
  toolSlug: action.toolSlug,
  arguments: action.arguments,
  expiresAt: action.expiresAt
});

exports.getStatus = async (req, res) => {
  try {
    const connectors = await composio.getConnectorStatus(req.member.uid);
    res.json({ success: true, configured: composio.isConfigured(), connectors });
  } catch (error) {
    res.status(error.status || 502).json({ success: false, message: error.message });
  }
};

exports.connect = async (req, res) => {
  try {
    const { toolkit } = req.params;
    if (!composio.TOOLKITS[toolkit]) {
      return res.status(400).json({ success: false, message: 'Google connector not supported.' });
    }
    const { redirectUrl } = await composio.startConnection(req.member.uid, toolkit);
    res.json({ success: true, redirectUrl });
  } catch (error) {
    res.status(error.status || 502).json({ success: false, message: error.message });
  }
};

exports.createPendingAction = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { toolSlug, arguments: toolArguments } = req.body || {};
    if (typeof toolSlug !== 'string' || !toolArguments || typeof toolArguments !== 'object' || Array.isArray(toolArguments)) {
      return res.status(400).json({ success: false, message: 'Invalid connector action.' });
    }

    const session = await ChatSession.findOne({ sessionId, userId: req.member.uid }).select('sessionId');
    if (!session) return res.status(404).json({ success: false, message: 'Chat session not found.' });

    const validated = await composio.validateToolArguments(toolSlug, toolArguments);
    if (!composio.WRITE_TOOLS.has(toolSlug)) {
      return res.status(400).json({ success: false, message: 'Only write actions need confirmation.' });
    }

    const action = await PendingConnectorAction.create({
      userId: req.member.uid,
      sessionId,
      toolkit: validated.toolkit,
      toolSlug,
      arguments: validated.args,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS)
    });

    res.status(201).json({ success: true, action: publicPendingAction(action) });
  } catch (error) {
    res.status(error.status || 502).json({ success: false, message: error.message });
  }
};

exports.confirmPendingAction = async (req, res) => {
  let action;
  try {
    // Atomic claim prevents double-clicks and concurrent duplicate execution.
    action = await PendingConnectorAction.findOneAndUpdate(
      {
        actionId: req.params.actionId,
        userId: req.member.uid,
        status: 'pending',
        expiresAt: { $gt: new Date() }
      },
      { $set: { status: 'executing' } },
      { new: true }
    );
    if (!action) {
      return res.status(404).json({
        success: false,
        message: 'This action is no longer available. It may have expired or already been used.'
      });
    }

    const result = await composio.executeTool(
      req.member.uid,
      action.toolSlug,
      action.arguments,
      [action.toolkit]
    );
    action.status = 'executed';
    action.executedAt = new Date();
    await action.save();
    res.json({ success: true, toolkit: result.toolkit, toolSlug: action.toolSlug, result: result.data });
  } catch (error) {
    if (action) {
      action.status = 'failed';
      action.executedAt = new Date();
      await action.save().catch(() => {});
    }
    res.status(error.status || 502).json({ success: false, message: error.message });
  }
};

exports.cancelPendingAction = async (req, res) => {
  try {
    const action = await PendingConnectorAction.findOneAndUpdate(
      { actionId: req.params.actionId, userId: req.member.uid, status: 'pending' },
      { $set: { status: 'cancelled' } },
      { new: true }
    );
    if (!action) return res.status(404).json({ success: false, message: 'Pending action not found.' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to cancel connector action.' });
  }
};

exports.getPendingActions = async (req, res) => {
  try {
    const actions = await PendingConnectorAction.find({
      userId: req.member.uid,
      sessionId: req.params.sessionId,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: 1 }).limit(10);
    res.json({ success: true, actions: actions.map(publicPendingAction) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch pending connector actions.' });
  }
};
