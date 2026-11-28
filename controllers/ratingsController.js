// controllers/ratingsController.js — Ratings history handlers
const supabaseService = require('../services/supabaseService');
const { HttpError, cleanText, toInt } = require('../utils/validate');

async function requireAuth(req, res, next) {
  const { userId, error } = await supabaseService.verifyAuth(req);
  if (error) {
    throw new HttpError(401, error);
  }
  req.userId = userId;
  next();
}

const ratingsController = {
  requireAuth,

  // GET /api/ratings?limit=100
  async getRatingsHistory(req, res) {
    const { limit } = req.query;
    const ratings = await supabaseService.getRatingsHistory(req.userId, {
      limit: toInt(limit, 100, { min: 1, max: 500 }),
    });
    res.json({ ratings, count: ratings.length });
  },

  // POST /api/ratings
  // body: { tmdbId, mediaType, title, poster, releaseYear, userRating }
  async addRating(req, res) {
    const { tmdbId, mediaType, title, poster, releaseYear, userRating } = req.body;

    if (!tmdbId || !mediaType || !title || userRating === undefined) {
      throw new HttpError(400, 'tmdbId, mediaType, title, and userRating are required');
    }

    if (!['movie', 'tv'].includes(mediaType)) {
      throw new HttpError(400, 'mediaType must be "movie" or "tv"');
    }

    const rating = toInt(userRating, null, { min: 0, max: 10 });
    if (rating === null) {
      throw new HttpError(400, 'userRating must be a number between 0 and 10');
    }

    const ratingEntry = {
      tmdbId: Number(tmdbId),
      mediaType,
      title: cleanText(title, 200),
      poster: poster || null,
      releaseYear: releaseYear || '',
      userRating: rating,
      ratedAt: new Date().toISOString(),
    };

    const saved = await supabaseService.addRating(req.userId, ratingEntry);
    res.status(201).json(saved);
  },
};

module.exports = ratingsController;