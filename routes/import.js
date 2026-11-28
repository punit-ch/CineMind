// routes/import.js — Data import routes (JSON/CSV)
const express = require('express');
const router = express.Router();
const importController = require('../controllers/importController');

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// All import routes require auth
router.use(asyncHandler(importController.requireAuth));

router.post('/library', asyncHandler(importController.importLibrary));
router.post('/diary', asyncHandler(importController.importDiary));
router.post('/ratings', asyncHandler(importController.importRatings));
router.post('/full', asyncHandler(importController.importFull));

module.exports = router;