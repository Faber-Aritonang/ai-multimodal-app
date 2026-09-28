/**
 * A connector write operation must be reviewed in the UI before execution.
 */

const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const pendingConnectorActionSchema = new mongoose.Schema({
  actionId: { type: String, unique: true, index: true, default: randomUUID },
  userId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true, index: true },
  toolkit: { type: String, required: true },
  toolSlug: { type: String, required: true },
  connectedAccountId: { type: String, required: true },
  arguments: { type: mongoose.Schema.Types.Mixed, required: true },
  status: {
    type: String,
    enum: ['pending', 'executing', 'executed', 'failed', 'cancelled', 'expired'],
    default: 'pending',
    index: true
  },
  expiresAt: { type: Date, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  executedAt: { type: Date, default: null }
});

pendingConnectorActionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
pendingConnectorActionSchema.index({ userId: 1, sessionId: 1, status: 1 });

module.exports = mongoose.model('PendingConnectorAction', pendingConnectorActionSchema);
