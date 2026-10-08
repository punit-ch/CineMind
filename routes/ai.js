// routes/ai.js
const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.post('/recommend', asyncHandler(aiController.recommend));
router.post('/mood', asyncHandler(aiController.moodRecommend));
router.post('/critic', asyncHandler(aiController.critic));
router.post('/plan', asyncHandler(aiController.planNight));
router.post('/chat', asyncHandler(aiController.chat));
router.post('/profile', asyncHandler(aiController.tasteProfile));
router.post('/compare', asyncHandler(aiController.compareMovies));

module.exports = router;