const rateLimit = require('express-rate-limit');

const connectorActionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.member?.uid || req.ip,
  handler: (_req, res) => res.status(429).json({
    success: false,
    message: 'Too many connector requests. Please wait before trying again.'
  })
});

module.exports = { connectorActionRateLimit };
