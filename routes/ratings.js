// routes/ratings.js — Ratings history routes
const express = require('express');
const router = express.Router();
const ratingsController = require('../controllers/ratingsController');

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// All ratings routes require auth
router.use(asyncHandler(ratingsController.requireAuth));

router.get('/', asyncHandler(ratingsController.getRatingsHistory));
router.post('/', asyncHandler(ratingsController.addRating));

module.exports = router;