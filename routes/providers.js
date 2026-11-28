// routes/providers.js
const express = require('express');
const router = express.Router();
const providersController = require('../controllers/providersController');

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.get('/:mediaType/:id', asyncHandler(providersController.get));

module.exports = router;
