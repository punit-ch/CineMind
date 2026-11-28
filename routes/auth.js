// routes/auth.js — Authentication routes (Supabase)
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Public routes (no auth required)
router.post('/signup', asyncHandler(authController.signup));
router.post('/login', asyncHandler(authController.login));
router.post('/logout', asyncHandler(authController.logout));
router.post('/refresh', asyncHandler(authController.refresh));
router.get('/me', asyncHandler(authController.getMe));

// Protected routes (require valid session)
router.put('/profile', asyncHandler(authController.updateProfile));
router.delete('/account', asyncHandler(authController.deleteAccount));

module.exports = router;