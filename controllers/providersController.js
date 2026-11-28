// controllers/providersController.js — where to watch
const tmdbService = require('../services/tmdbService');
const { HttpError } = require('../utils/validate');

const EMPTY = { stream: [], free: [], ads: [], rent: [], buy: [] };

const providersController = {
  // GET /api/providers/:mediaType/:id?country=IN
  async get(req, res) {
    const { mediaType, id } = req.params;
    if (!['movie', 'tv'].includes(mediaType)) throw new HttpError(400, "mediaType must be 'movie' or 'tv'");
    if (!/^\d+$/.test(String(id))) throw new HttpError(400, 'Invalid ID');
    const country = String(req.query.country || 'US').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'country must be a two-letter code such as IN or US');

    const all = await tmdbService.getWatchProviders(mediaType, parseInt(id, 10));
    const here = all[country];
    const available = Boolean(here && ['stream', 'free', 'ads', 'rent', 'buy'].some((k) => here[k].length));
    res.json({
      country,
      available,
      link: here?.link || null,
      ...EMPTY,
      ...(here ? { stream: here.stream, free: here.free, ads: here.ads, rent: here.rent, buy: here.buy } : {}),
      attribution: 'JustWatch',
    });
  },
};

module.exports = providersController;
