// services/tmdbService.js — TMDB API integration
const axios = require('axios');
const config = require('../config');
const cache = require('../utils/cache');

const tmdb = axios.create({
  baseURL: config.tmdb.baseUrl,
  params: { api_key: config.tmdb.apiKey },
  timeout: 8000,
});

// Build full poster/backdrop URL
const posterUrl = (path, size = config.tmdb.posterSize) =>
  path ? `${config.tmdb.imageBase}/${size}${path}` : null;

// Normalize a raw TMDB movie object to our clean shape
const normalizeMovie = (movie) => ({
  id: movie.id,
  title: movie.title || movie.name,
  overview: movie.overview,
  poster: posterUrl(movie.poster_path),
  backdrop: posterUrl(movie.backdrop_path, config.tmdb.backdropSize),
  rating: movie.vote_average ? parseFloat(movie.vote_average.toFixed(1)) : 0,
  voteCount: movie.vote_count,
  releaseYear: movie.release_date ? movie.release_date.slice(0, 4) : 'N/A',
  genreIds: movie.genre_ids || [],
  genres: movie.genres ? movie.genres.map((g) => g.name) : [],
  popularity: movie.popularity,
});

const GENRE_MAP = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
  80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie',
  53: 'Thriller', 10752: 'War', 37: 'Western',
};

const tmdbService = {
  // Resolve genre names from IDs
  resolveGenres(movie) {
    if (movie.genres?.length) return movie;
    return {
      ...movie,
      genres: movie.genreIds.map((id) => GENRE_MAP[id] || 'Unknown'),
    };
  },

  // Search movies by query
  async searchMovies(query, page = 1) {
    const cacheKey = `search:${query.toLowerCase()}:${page}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get('/search/movie', {
      params: { query, page, include_adult: false },
    });

    const result = {
      movies: data.results.slice(0, 20).map(normalizeMovie).map(m => this.resolveGenres(m)),
      totalPages: data.total_pages,
      currentPage: page,
    };
    cache.set(cacheKey, result);
    return result;
  },

  // Get movie details (full genres, runtime, director, cast, trailer)
  async getMovieDetails(movieId) {
    const cacheKey = `movie:${movieId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get(`/movie/${movieId}`, {
      params: { append_to_response: 'credits,videos' },
    });

    const trailer = (data.videos?.results || []).find(
      (v) => v.site === 'YouTube' && v.type === 'Trailer'
    );

    const result = {
      ...normalizeMovie(data),
      tagline: data.tagline || '',
      runtime: data.runtime || null,
      director: (data.credits?.crew || []).find((c) => c.job === 'Director')?.name || null,
      cast: (data.credits?.cast || []).slice(0, 6).map((c) => c.name),
      trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    };
    cache.set(cacheKey, result);
    return result;
  },

  // Get trending movies
  async getTrending(timeWindow = 'week', page = 1) {
    const cacheKey = `trending:${timeWindow}:${page}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get(`/trending/movie/${timeWindow}`, { params: { page } });
    const result = data.results.slice(0, 20).map(normalizeMovie).map(m => this.resolveGenres(m));
    cache.set(cacheKey, result, 15 * 60 * 1000); // 15 min for trending
    return result;
  },

  // Get top rated movies
  async getTopRated(page = 1) {
    const cacheKey = `toprated:${page}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get('/movie/top_rated', { params: { page } });
    const result = data.results.slice(0, 20).map(normalizeMovie).map(m => this.resolveGenres(m));
    cache.set(cacheKey, result);
    return result;
  },

  // Get similar movies
  async getSimilarMovies(movieId) {
    const cacheKey = `similar:${movieId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get(`/movie/${movieId}/similar`);
    const result = data.results.slice(0, 12).map(normalizeMovie).map(m => this.resolveGenres(m));
    cache.set(cacheKey, result);
    return result;
  },

  // Look up TMDB data for AI-suggested films.
  // `items` are { title, year }. The result is aligned with the input:
  // result[i] is the TMDB movie for items[i], or null if nothing matched.
  async enrichMovieTitles(items) {
    return Promise.all(
      items.map(async ({ title, year }) => {
        if (!title) return null;
        const cacheKey = `enrich:${title.toLowerCase()}:${year || ''}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        try {
          const search = (extra = {}) =>
            tmdb.get('/search/movie', { params: { query: title, include_adult: false, ...extra } });

          let { data } = await search(year ? { year } : {});
          // AI years are sometimes off by one — retry without the year filter
          if (!data.results.length && year) ({ data } = await search());
          if (!data.results.length) return null;

          const movie = this.resolveGenres(normalizeMovie(data.results[0]));
          cache.set(cacheKey, movie);
          return movie;
        } catch (err) {
          console.warn(`[tmdb] enrich failed for "${title}": ${err.message}`);
          return null;
        }
      })
    );
  },

  // Discover movies by genre
  async discoverByGenre(genreId, page = 1) {
    const cacheKey = `discover:${genreId}:${page}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get('/discover/movie', {
      params: { with_genres: genreId, sort_by: 'popularity.desc', page },
    });
    const result = data.results.slice(0, 20).map(normalizeMovie).map(m => this.resolveGenres(m));
    cache.set(cacheKey, result);
    return result;
  },

  GENRE_MAP,
};

module.exports = tmdbService;