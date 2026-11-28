// services/tmdbService.js — TMDB API integration
const axios = require('axios');
const config = require('../config');
const cache = require('../utils/cache');

const realClient = axios.create({
  baseURL: config.tmdb.baseUrl,
  params: { api_key: config.tmdb.apiKey },
  timeout: 8000,
});
// Indirection so tests can swap the HTTP client (see _setHttpForTests)
let tmdb = realClient;

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

// TV genres differ from movie genres in TMDB
const TV_GENRE_MAP = {
  10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 10762: 'Kids',
  9648: 'Mystery', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy',
  10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics', 37: 'Western',
};

// Normalize a raw TMDB TV show object to the same shape as a movie, plus show-specific fields
const normalizeShow = (show) => ({
  ...normalizeMovie({ ...show, title: show.name, release_date: show.first_air_date }),
  mediaType: 'tv',
  firstAirYear: show.first_air_date ? show.first_air_date.slice(0, 4) : 'N/A',
});

const resolveTvGenres = (show) => {
  if (show.genres?.length) return show;
  return { ...show, genres: show.genreIds.map((id) => TV_GENRE_MAP[id] || 'Unknown') };
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

  // ─── TV ────────────────────────────────────────────────────────────────────

  async searchShows(query, page = 1) {
    const cacheKey = `tv:search:${query.toLowerCase()}:${page}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get('/search/tv', {
      params: { query, page, include_adult: false },
    });
    const result = {
      shows: data.results.slice(0, 20).map(normalizeShow).map(resolveTvGenres),
      totalPages: data.total_pages,
      currentPage: page,
    };
    cache.set(cacheKey, result);
    return result;
  },

  // Show details with its season list (episode lists come from getSeason)
  async getShowDetails(showId) {
    const cacheKey = `tv:show:${showId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get(`/tv/${showId}`, {
      params: { append_to_response: 'credits,videos' },
    });
    const trailer = (data.videos?.results || []).find(
      (v) => v.site === 'YouTube' && v.type === 'Trailer'
    );

    const result = {
      ...normalizeShow(data),
      tagline: data.tagline || '',
      status: data.status || null,
      numberOfSeasons: data.number_of_seasons ?? null,
      numberOfEpisodes: data.number_of_episodes ?? null,
      episodeRuntime: (data.episode_run_time || [])[0] || null,
      creators: (data.created_by || []).map((c) => c.name),
      cast: (data.credits?.cast || []).slice(0, 6).map((c) => c.name),
      trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
      seasons: (data.seasons || []).map((se) => ({
        seasonNumber: se.season_number,
        name: se.name,
        episodeCount: se.episode_count,
        airYear: se.air_date ? se.air_date.slice(0, 4) : null,
        poster: posterUrl(se.poster_path),
      })),
      nextEpisodeToAir: data.next_episode_to_air
        ? {
            seasonNumber: data.next_episode_to_air.season_number,
            episodeNumber: data.next_episode_to_air.episode_number,
            airDate: data.next_episode_to_air.air_date || null,
          }
        : null,
    };
    cache.set(cacheKey, result);
    return result;
  },

  // Episode list for one season. Episode titles and summaries can contain spoilers:
  // clients should hide them for unwatched episodes (the "Spoiler Shield").
  async getSeason(showId, seasonNumber) {
    const cacheKey = `tv:season:${showId}:${seasonNumber}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get(`/tv/${showId}/season/${seasonNumber}`);
    const result = {
      showId: Number(showId),
      seasonNumber: data.season_number,
      name: data.name,
      airYear: data.air_date ? data.air_date.slice(0, 4) : null,
      episodes: (data.episodes || []).map((e) => ({
        episodeNumber: e.episode_number,
        name: e.name,
        overview: e.overview,
        airDate: e.air_date || null,
        runtime: e.runtime || null,
        still: posterUrl(e.still_path, 'w300'),
        rating: e.vote_average ? parseFloat(e.vote_average.toFixed(1)) : 0,
      })),
    };
    cache.set(cacheKey, result);
    return result;
  },

  async getTrendingShows(timeWindow = 'week', page = 1) {
    const cacheKey = `tv:trending:${timeWindow}:${page}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get(`/trending/tv/${timeWindow}`, { params: { page } });
    const result = data.results.slice(0, 20).map(normalizeShow).map(resolveTvGenres);
    cache.set(cacheKey, result, 15 * 60 * 1000);
    return result;
  },

  async getTopRatedShows(page = 1) {
    const cacheKey = `tv:toprated:${page}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get('/tv/top_rated', { params: { page } });
    const result = data.results.slice(0, 20).map(normalizeShow).map(resolveTvGenres);
    cache.set(cacheKey, result);
    return result;
  },

  // ─── Candidate discovery (used by the Tonight flow) ────────────────────────

  // Real titles that match the filters, as the pool the AI is allowed to choose from.
  //  mediaType: 'movie' | 'tv'   genreIds: number[] (OR-combined)   maxRuntime: minutes (movies only)
  async discoverCandidates({ mediaType = 'movie', genreIds = [], maxRuntime, page = 1 } = {}) {
    const isTv = mediaType === 'tv';
    const genreParam = [...genreIds].sort((a, b) => a - b).join('|');
    const cacheKey = `cand:${mediaType}:${genreParam}:${maxRuntime || ''}:${page}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const params = {
      sort_by: 'popularity.desc',
      'vote_count.gte': 300, // skip obscure titles with unreliable ratings
      'vote_average.gte': 6.3,
      include_adult: false,
      page,
    };
    if (genreParam) params.with_genres = genreParam;
    if (!isTv && maxRuntime) params['with_runtime.lte'] = maxRuntime;

    const { data } = await tmdb.get(isTv ? '/discover/tv' : '/discover/movie', { params });
    const result = data.results.slice(0, 20).map((r) =>
      isTv ? resolveTvGenres(normalizeShow(r)) : { ...this.resolveGenres(normalizeMovie(r)), mediaType: 'movie' }
    );
    cache.set(cacheKey, result, 15 * 60 * 1000);
    return result;
  },

  // ─── Where to watch ────────────────────────────────────────────────────────

  // Streaming availability per country, from TMDB's watch-provider data (provided by JustWatch; the app must show
  // JustWatch attribution wherever it is displayed). Returns { [COUNTRY]: { link, stream, free, ads, rent, buy } }
  // where each group is a list of { id, name, logo }.
  async getWatchProviders(mediaType, id) {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const cacheKey = `providers:${type}:${id}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data } = await tmdb.get(`/${type}/${id}/watch/providers`);
    const group = (list) =>
      (Array.isArray(list) ? list : [])
        .slice(0, 12)
        .map((p) => ({ id: p.provider_id, name: p.provider_name, logo: posterUrl(p.logo_path, 'w92') }))
        .filter((p) => p.name);

    const result = {};
    for (const [country, info] of Object.entries(data.results || {})) {
      result[country] = {
        link: info.link || null,
        stream: group(info.flatrate),
        free: group(info.free),
        ads: group(info.ads),
        rent: group(info.rent),
        buy: group(info.buy),
      };
    }
    cache.set(cacheKey, result, 6 * 60 * 60 * 1000); // availability changes slowly: 6 hours
    return result;
  },

  // Test hook (not used by the app)
  _setHttpForTests(fake) {
    tmdb = fake || realClient;
  },

  GENRE_MAP,
  TV_GENRE_MAP,
};

module.exports = tmdbService;
