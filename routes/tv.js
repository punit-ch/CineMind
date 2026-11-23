// routes/tv.js
const express = require('express');
const router = express.Router();
const tvController = require('../controllers/tvController');

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.get('/search', asyncHandler(tvController.search));
router.get('/trending', asyncHandler(tvController.getTrending));
router.get('/top-rated', asyncHandler(tvController.getTopRated));
router.get('/:id/seasons/:season', asyncHandler(tvController.getSeason));
router.get('/:id', asyncHandler(tvController.getDetails));

module.exports = router;
