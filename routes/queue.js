// routes/queue.js — Queue (Up Next) routes
const express = require('express');
const router = express.Router();
const queueController = require('../controllers/queueController');

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// All queue routes require auth
router.use(asyncHandler(queueController.requireAuth));

router.get('/', asyncHandler(queueController.getQueue));
router.post('/', asyncHandler(queueController.addToQueue));
router.patch('/reorder', asyncHandler(queueController.reorderQueue));
router.delete('/:queueId', asyncHandler(queueController.removeFromQueue));

module.exports = router;