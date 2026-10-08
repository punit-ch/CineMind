// controllers/movieController.js
const tmdbService = require('../services/tmdbService');
const { HttpError, toInt } = require('../utils/validate');

const requireId = (value, label = 'movie ID') => {
  if (!/^\d+$/.test(String(value))) throw new HttpError(400, `Invalid ${label}`);
  return parseInt(value, 10);
};

const movieController = {
  // GET /api/movies/search?q=query&page=1
  async search(req, res) {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (!q) throw new HttpError(400, 'Search query is required');

    const result = await tmdbService.searchMovies(q, toInt(req.query.page, 1, { max: 500 }));
    res.json(result);
  },

  // GET /api/movies/:id
  async getDetails(req, res) {
    res.json(await tmdbService.getMovieDetails(requireId(req.params.id)));
  },

  // GET /api/movies/:id/similar
  async getSimilar(req, res) {
    const movies = await tmdbService.getSimilarMovies(requireId(req.params.id));
    res.json({ movies });
  },

  // GET /api/movies/trending?window=week
  async getTrending(req, res) {
    const timeWindow = req.query.window === 'day' ? 'day' : 'week';
    const movies = await tmdbService.getTrending(timeWindow, toInt(req.query.page, 1, { max: 500 }));
    res.json({ movies, timeWindow });
  },

  // GET /api/movies/top-rated
  async getTopRated(req, res) {
    const movies = await tmdbService.getTopRated(toInt(req.query.page, 1, { max: 500 }));
    res.json({ movies });
  },

  // GET /api/movies/genres/:genreId
  async getByGenre(req, res) {
    const genreId = requireId(req.params.genreId, 'genre ID');
    const movies = await tmdbService.discoverByGenre(genreId, toInt(req.query.page, 1, { max: 500 }));
    res.json({ movies, genreId });
  },
};

module.exports = movieController;
