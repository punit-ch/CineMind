// controllers/libraryController.js — Library (watchlist, watched, etc.) handlers
const supabaseService = require('../services/supabaseService');
const tmdbService = require('../services/tmdbService');
const { HttpError, cleanText, toInt, cleanList } = require('../utils/validate');

const VALID_STATUSES = ['watchlist', 'watching', 'watched', 'dropped'];
const VALID_MEDIA_TYPES = ['movie', 'tv'];

async function requireAuth(req, res, next) {
  const { userId, error } = await supabaseService.verifyAuth(req);
  if (error) {
    throw new HttpError(401, error);
  }
  req.userId = userId;
  next();
}

const libraryController = {
  requireAuth,

  // GET /api/library?status=watchlist&mediaType=movie&limit=50
  async getLibrary(req, res) {
    const { status, mediaType, limit } = req.query;

    if (status && !VALID_STATUSES.includes(status)) {
      throw new HttpError(400, `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    if (mediaType && !VALID_MEDIA_TYPES.includes(mediaType)) {
      throw new HttpError(400, `Invalid mediaType. Must be one of: ${VALID_MEDIA_TYPES.join(', ')}`);
    }

    const library = await supabaseService.getLibrary(req.userId, {
      status,
      mediaType,
      limit: toInt(limit, 50, { min: 1, max: 200 }),
    });

    res.json({ items: library, count: library.length });
  },

  // POST /api/library
  // body: { tmdbId, mediaType, title, poster, releaseYear, genres, rating, status, userRating, userNotes, progress, totalEpisodes }
  async addToLibrary(req, res) {
    const { tmdbId, mediaType, title, poster, releaseYear, genres, rating, status, userRating, userNotes, progress, totalEpisodes } = req.body;

    if (!tmdbId || !mediaType || !title) {
      throw new HttpError(400, 'tmdbId, mediaType, and title are required');
    }

    if (!VALID_MEDIA_TYPES.includes(mediaType)) {
      throw new HttpError(400, `Invalid mediaType. Must be one of: ${VALID_MEDIA_TYPES.join(', ')}`);
    }

    const itemStatus = status || 'watchlist';
    if (!VALID_STATUSES.includes(itemStatus)) {
      throw new HttpError(400, `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    // Verify with TMDB if possible
    let tmdbData = null;
    try {
      if (mediaType === 'movie') {
        tmdbData = await tmdbService.getMovieDetails(tmdbId);
      } else {
        tmdbData = await tmdbService.getShowDetails(tmdbId);
      }
    } catch {
      // TMDB lookup failed, use provided data
    }

    const item = {
      tmdbId: Number(tmdbId),
      mediaType,
      title: cleanText(title, 200),
      poster: poster || tmdbData?.poster || null,
      releaseYear: releaseYear || tmdbData?.releaseYear || tmdbData?.firstAirYear || '',
      genres: genres || tmdbData?.genres || [],
      rating: rating || tmdbData?.rating || 0,
      status: itemStatus,
      userRating: userRating ? toInt(userRating, null, { min: 0, max: 10 }) : null,
      userNotes: userNotes ? cleanText(userNotes, 1000) : null,
      progress: toInt(progress, 0, { min: 0 }),
      totalEpisodes: toInt(totalEpisodes, null, { min: 0 }),
    };

    const saved = await supabaseService.addToLibrary(req.userId, item);

    // If status is 'watched', also add to diary
    if (itemStatus === 'watched' && item.userRating) {
      await supabaseService.addDiaryEntry(req.userId, {
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
        poster: item.poster,
        releaseYear: item.releaseYear,
        userRating: item.userRating,
        userNotes: item.userNotes,
        watchedAt: new Date().toISOString(),
      });

      // Also add to ratings history
      await supabaseService.addRating(req.userId, {
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
        poster: item.poster,
        releaseYear: item.releaseYear,
        userRating: item.userRating,
        ratedAt: new Date().toISOString(),
      });
    }

    res.status(201).json(saved);
  },

  // PATCH /api/library/:tmdbId/:mediaType
  async updateLibraryItem(req, res) {
    const tmdbId = toInt(req.params.tmdbId, 0, { min: 1 });
    const mediaType = req.params.mediaType;

    if (!tmdbId || !VALID_MEDIA_TYPES.includes(mediaType)) {
      throw new HttpError(400, 'Valid tmdbId and mediaType are required');
    }

    const { status, userRating, userNotes, progress, totalEpisodes } = req.body;
    const updates = {};

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        throw new HttpError(400, `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
      }
      updates.status = status;
    }
    if (userRating !== undefined) {
      updates.user_rating = userRating === null ? null : toInt(userRating, null, { min: 0, max: 10 });
    }
    if (userNotes !== undefined) {
      updates.user_notes = userNotes ? cleanText(userNotes, 1000) : null;
    }
    if (progress !== undefined) {
      updates.progress = toInt(progress, 0, { min: 0 });
    }
    if (totalEpisodes !== undefined) {
      updates.total_episodes = toInt(totalEpisodes, null, { min: 0 });
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, 'No valid updates provided');
    }

    const updated = await supabaseService.updateLibraryItem(req.userId, tmdbId, mediaType, updates);

    // If status changed to 'watched', add to diary and ratings
    if (status === 'watched' && updated) {
      const existingDiary = await supabaseService.getDiary(req.userId, {
        limit: 1
      });
      // Check if already in diary
      const inDiary = existingDiary.some(d => d.tmdb_id === tmdbId && d.media_type === mediaType);

      if (!inDiary && updated.user_rating) {
        await supabaseService.addDiaryEntry(req.userId, {
          tmdbId,
          mediaType,
          title: updated.title,
          poster: updated.poster,
          releaseYear: updated.release_year,
          userRating: updated.user_rating,
          userNotes: updated.user_notes,
          watchedAt: new Date().toISOString(),
        });

        await supabaseService.addRating(req.userId, {
          tmdbId,
          mediaType,
          title: updated.title,
          poster: updated.poster,
          releaseYear: updated.release_year,
          userRating: updated.user_rating,
          ratedAt: new Date().toISOString(),
        });
      }
    }

    res.json(updated);
  },

  // DELETE /api/library/:tmdbId/:mediaType
  async removeFromLibrary(req, res) {
    const tmdbId = toInt(req.params.tmdbId, 0, { min: 1 });
    const mediaType = req.params.mediaType;

    if (!tmdbId || !VALID_MEDIA_TYPES.includes(mediaType)) {
      throw new HttpError(400, 'Valid tmdbId and mediaType are required');
    }

    await supabaseService.removeFromLibrary(req.userId, tmdbId, mediaType);
    res.json({ success: true });
  },

  // GET /api/library/stats
  async getStats(req, res) {
    const stats = await supabaseService.getUserStats(req.userId);
    res.json(stats);
  },
};

module.exports = libraryController;