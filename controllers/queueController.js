// controllers/queueController.js — Queue (Up Next) handlers
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

const queueController = {
  requireAuth,

  // GET /api/queue?limit=50
  async getQueue(req, res) {
    const { limit } = req.query;
    const queue = await supabaseService.getQueue(req.userId, {
      limit: toInt(limit, 50, { min: 1, max: 200 }),
    });
    res.json({ items: queue, count: queue.length });
  },

  // POST /api/queue
  // body: { tmdbId, mediaType, title, poster, releaseYear, notes }
  async addToQueue(req, res) {
    const { tmdbId, mediaType, title, poster, releaseYear, notes } = req.body;

    if (!tmdbId || !mediaType || !title) {
      throw new HttpError(400, 'tmdbId, mediaType, and title are required');
    }

    if (!['movie', 'tv'].includes(mediaType)) {
      throw new HttpError(400, 'mediaType must be "movie" or "tv"');
    }

    const item = {
      tmdbId: Number(tmdbId),
      mediaType,
      title: cleanText(title, 200),
      poster: poster || null,
      releaseYear: releaseYear || '',
      notes: notes ? cleanText(notes, 1000) : null,
    };

    const saved = await supabaseService.addToQueue(req.userId, item);
    res.status(201).json(saved);
  },

  // PATCH /api/queue/reorder
  // body: { items: [{ id, position }] }
  async reorderQueue(req, res) {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpError(400, 'Items array is required');
    }

    for (const item of items) {
      if (!item.id || item.position === undefined) {
        throw new HttpError(400, 'Each item must have id and position');
      }
    }

    await supabaseService.reorderQueue(req.userId, items);
    res.json({ success: true });
  },

  // DELETE /api/queue/:queueId
  async removeFromQueue(req, res) {
    const queueId = toInt(req.params.queueId, 0, { min: 1 });
    if (!queueId) {
      throw new HttpError(400, 'Valid queueId is required');
    }

    await supabaseService.removeFromQueue(req.userId, queueId);
    res.json({ success: true });
  },
};

module.exports = queueController;