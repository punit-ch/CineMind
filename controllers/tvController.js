// controllers/tvController.js
const tmdbService = require('../services/tmdbService');
const { HttpError, toInt } = require('../utils/validate');

const requireId = (value, label = 'show ID') => {
  if (!/^\d+$/.test(String(value))) throw new HttpError(400, `Invalid ${label}`);
  return parseInt(value, 10);
};

const tvController = {
  // GET /api/tv/search?q=query&page=1
  async search(req, res) {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (!q) throw new HttpError(400, 'Search query is required');
    res.json(await tmdbService.searchShows(q, toInt(req.query.page, 1, { max: 500 })));
  },

  // GET /api/tv/trending?window=week
  async getTrending(req, res) {
    const timeWindow = req.query.window === 'day' ? 'day' : 'week';
    const shows = await tmdbService.getTrendingShows(timeWindow, toInt(req.query.page, 1, { max: 500 }));
    res.json({ shows, timeWindow });
  },

  // GET /api/tv/top-rated
  async getTopRated(req, res) {
    res.json({ shows: await tmdbService.getTopRatedShows(toInt(req.query.page, 1, { max: 500 })) });
  },

  // GET /api/tv/:id
  async getDetails(req, res) {
    res.json(await tmdbService.getShowDetails(requireId(req.params.id)));
  },

  // GET /api/tv/:id/seasons/:season   (season 0 = specials)
  async getSeason(req, res) {
    const showId = requireId(req.params.id);
    const season = requireId(req.params.season, 'season number');
    res.json(await tmdbService.getSeason(showId, season));
  },
};

module.exports = tvController;
