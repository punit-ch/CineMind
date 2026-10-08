// routes/movies.js
const express = require('express');
const router = express.Router();
const movieController = require('../controllers/movieController');

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.get('/search', asyncHandler(movieController.search));
router.get('/trending', asyncHandler(movieController.getTrending));
router.get('/top-rated', asyncHandler(movieController.getTopRated));
router.get('/genres/:genreId', asyncHandler(movieController.getByGenre));
router.get('/:id/similar', asyncHandler(movieController.getSimilar));
router.get('/:id', asyncHandler(movieController.getDetails));

module.exports = router;    