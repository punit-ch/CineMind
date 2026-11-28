// routes/ai.js
const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const geminiService = require('../services/geminiService');

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Rate limiting middleware for AI endpoints
const aiRateLimit = (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  try {
    const release = geminiService.checkRateLimit(ip);
    req.aiRelease = release;
    res.on('finish', () => release());
    res.on('close', () => release());
    next();
  } catch (err) {
    res.status(err.status || 429).json({ error: err.message, retryAfterMs: err.retryAfterMs });
  }
};

// Apply rate limiting to all AI routes
router.use(aiRateLimit);

router.post('/recommend', asyncHandler(aiController.recommend));
router.post('/mood', asyncHandler(aiController.moodRecommend));
router.post('/tonight', asyncHandler(aiController.tonight));
router.post('/critic', asyncHandler(aiController.critic));
router.post('/plan', asyncHandler(aiController.planNight));
router.post('/chat', asyncHandler(aiController.chat));
router.post('/profile', asyncHandler(aiController.tasteProfile));
router.post('/compare', asyncHandler(aiController.compareMovies));

module.exports = router;
