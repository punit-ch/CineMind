// routes/diary.js — Viewing diary routes
const express = require('express');
const router = express.Router();
const diaryController = require('../controllers/diaryController');

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// All diary routes require auth
router.use(asyncHandler(diaryController.requireAuth));

router.get('/', asyncHandler(diaryController.getDiary));
router.post('/', asyncHandler(diaryController.addDiaryEntry));
router.patch('/:entryId', asyncHandler(diaryController.updateDiaryEntry));
router.delete('/:entryId', asyncHandler(diaryController.deleteDiaryEntry));

module.exports = router;