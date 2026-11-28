// controllers/diaryController.js — Diary (viewing log) handlers
const supabaseService = require('../services/supabaseService');
const { HttpError, cleanText, toInt, cleanList } = require('../utils/validate');

async function requireAuth(req, res, next) {
  const { userId, error } = await supabaseService.verifyAuth(req);
  if (error) {
    throw new HttpError(401, error);
  }
  req.userId = userId;
  next();
}

const diaryController = {
  requireAuth,

  // GET /api/diary?limit=50&mediaType=movie&fromDate=2024-01-01&toDate=2024-12-31
  async getDiary(req, res) {
    const { limit, mediaType, fromDate, toDate } = req.query;

    const diary = await supabaseService.getDiary(req.userId, {
      limit: toInt(limit, 50, { min: 1, max: 200 }),
      mediaType,
      fromDate,
      toDate,
    });

    res.json({ entries: diary, count: diary.length });
  },

  // POST /api/diary
  // body: { tmdbId, mediaType, title, poster, releaseYear, userRating, userNotes, watchedAt, rewatch }
  async addDiaryEntry(req, res) {
    const { tmdbId, mediaType, title, poster, releaseYear, userRating, userNotes, watchedAt, rewatch } = req.body;

    if (!tmdbId || !mediaType || !title) {
      throw new HttpError(400, 'tmdbId, mediaType, and title are required');
    }

    if (!['movie', 'tv'].includes(mediaType)) {
      throw new HttpError(400, 'mediaType must be "movie" or "tv"');
    }

    const entry = {
      tmdbId: Number(tmdbId),
      mediaType,
      title: cleanText(title, 200),
      poster: poster || null,
      releaseYear: releaseYear || '',
      userRating: userRating ? toInt(userRating, null, { min: 0, max: 10 }) : null,
      userNotes: userNotes ? cleanText(userNotes, 2000) : null,
      watchedAt: watchedAt || new Date().toISOString(),
      rewatch: Boolean(rewatch),
    };

    const saved = await supabaseService.addDiaryEntry(req.userId, entry);

    // Also add to ratings history if rated
    if (entry.userRating) {
      await supabaseService.addRating(req.userId, {
        tmdbId: entry.tmdbId,
        mediaType: entry.mediaType,
        title: entry.title,
        poster: entry.poster,
        releaseYear: entry.releaseYear,
        userRating: entry.userRating,
        ratedAt: entry.watchedAt,
      });
    }

    // Update library item status to 'watched' if it exists
    try {
      await supabaseService.updateLibraryItem(req.userId, tmdbId, mediaType, {
        status: 'watched',
        user_rating: entry.userRating,
        user_notes: entry.userNotes,
      });
    } catch {
      // Library item might not exist, that's fine
    }

    res.status(201).json(saved);
  },

  // PATCH /api/diary/:entryId
  async updateDiaryEntry(req, res) {
    const entryId = toInt(req.params.entryId, 0, { min: 1 });
    if (!entryId) {
      throw new HttpError(400, 'Valid entryId is required');
    }

    const { userRating, userNotes, watchedAt, rewatch } = req.body;
    const updates = {};

    if (userRating !== undefined) {
      updates.user_rating = userRating === null ? null : toInt(userRating, null, { min: 0, max: 10 });
    }
    if (userNotes !== undefined) {
      updates.user_notes = userNotes ? cleanText(userNotes, 2000) : null;
    }
    if (watchedAt !== undefined) {
      updates.watched_at = watchedAt;
    }
    if (rewatch !== undefined) {
      updates.rewatch = Boolean(rewatch);
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, 'No valid updates provided');
    }

    const updated = await supabaseService.updateDiaryEntry(req.userId, entryId, updates);

    // If rating changed, update ratings history
    if (userRating !== undefined && updated) {
      await supabaseService.addRating(req.userId, {
        tmdbId: updated.tmdb_id,
        mediaType: updated.media_type,
        title: updated.title,
        poster: updated.poster,
        releaseYear: updated.release_year,
        userRating: updates.user_rating,
        ratedAt: updated.watched_at,
      });
    }

    res.json(updated);
  },

  // DELETE /api/diary/:entryId
  async deleteDiaryEntry(req, res) {
    const entryId = toInt(req.params.entryId, 0, { min: 1 });
    if (!entryId) {
      throw new HttpError(400, 'Valid entryId is required');
    }

    await supabaseService.deleteDiaryEntry(req.userId, entryId);
    res.json({ success: true });
  },
};

module.exports = diaryController;