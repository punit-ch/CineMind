// routes/library.js — Personal library routes (watchlist, watched, watching, dropped)
const express = require('express');
const router = express.Router();
const libraryController = require('../controllers/libraryController');

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// All library routes require auth
router.use(asyncHandler(libraryController.requireAuth));

router.get('/', asyncHandler(libraryController.getLibrary));
router.post('/', asyncHandler(libraryController.addToLibrary));
router.get('/stats', asyncHandler(libraryController.getStats));
router.patch('/:tmdbId/:mediaType', asyncHandler(libraryController.updateLibraryItem));
router.delete('/:tmdbId/:mediaType', asyncHandler(libraryController.removeFromLibrary));

module.exports = router;