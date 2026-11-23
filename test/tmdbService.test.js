process.env.GEMINI_API_KEY = 'test-key';
process.env.TMDB_API_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const tmdbService = require('../services/tmdbService');

// Fake HTTP client: records calls and answers from a route table
const makeHttp = (routes) => {
  const calls = [];
  return {
    calls,
    get: async (url, opts = {}) => {
      calls.push({ url, params: opts.params });
      const handler = routes[url];
      if (!handler) throw new Error(`unexpected request: ${url}`);
      return { data: typeof handler === 'function' ? handler(opts.params) : handler };
    },
  };
};

test.afterEach(() => tmdbService._setHttpForTests(null));

test('movie search still normalizes results (regression)', async () => {
  const http = makeHttp({
    '/search/movie': {
      results: [{ id: 1, title: 'Heat', release_date: '1995-12-15', genre_ids: [28, 80], vote_average: 8.04, poster_path: '/h.jpg' }],
      total_pages: 1,
    },
  });
  tmdbService._setHttpForTests(http);
  const result = await tmdbService.searchMovies('heat-regression');
  assert.equal(result.movies[0].title, 'Heat');
  assert.equal(result.movies[0].releaseYear, '1995');
  assert.deepEqual(result.movies[0].genres, ['Action', 'Crime']);
  assert.equal(result.movies[0].rating, 8);
  assert.match(result.movies[0].poster, /\/w500\/h\.jpg$/);
});

test('searchShows maps TV fields onto the movie-style card shape', async () => {
  tmdbService._setHttpForTests(
    makeHttp({
      '/search/tv': {
        results: [{ id: 7, name: 'The Wire', first_air_date: '2002-06-02', genre_ids: [80, 18, 10759], vote_average: 8.5 }],
        total_pages: 3,
      },
    })
  );
  const result = await tmdbService.searchShows('wire-search');
  const show = result.shows[0];
  assert.equal(show.title, 'The Wire');
  assert.equal(show.releaseYear, '2002');
  assert.equal(show.firstAirYear, '2002');
  assert.equal(show.mediaType, 'tv');
  assert.deepEqual(show.genres, ['Crime', 'Drama', 'Action & Adventure']);
  assert.equal(result.totalPages, 3);
});

test('getShowDetails returns seasons, creators and the next episode', async () => {
  tmdbService._setHttpForTests(
    makeHttp({
      '/tv/42': {
        id: 42,
        name: 'Show',
        first_air_date: '2020-01-01',
        status: 'Returning Series',
        number_of_seasons: 2,
        number_of_episodes: 16,
        episode_run_time: [45],
        created_by: [{ name: 'Ada' }],
        genres: [{ id: 18, name: 'Drama' }],
        credits: { cast: [{ name: 'A' }, { name: 'B' }] },
        videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abc' }] },
        seasons: [
          { season_number: 0, name: 'Specials', episode_count: 2, air_date: null },
          { season_number: 1, name: 'Season 1', episode_count: 8, air_date: '2020-01-01', poster_path: '/s1.jpg' },
        ],
        next_episode_to_air: { season_number: 2, episode_number: 3, air_date: '2026-12-01' },
      },
    })
  );
  const show = await tmdbService.getShowDetails(42);
  assert.equal(show.numberOfSeasons, 2);
  assert.equal(show.episodeRuntime, 45);
  assert.deepEqual(show.creators, ['Ada']);
  assert.deepEqual(show.cast, ['A', 'B']);
  assert.equal(show.trailerUrl, 'https://www.youtube.com/watch?v=abc');
  assert.equal(show.seasons.length, 2);
  assert.equal(show.seasons[1].airYear, '2020');
  assert.deepEqual(show.nextEpisodeToAir, { seasonNumber: 2, episodeNumber: 3, airDate: '2026-12-01' });
});

test('getSeason maps episodes', async () => {
  tmdbService._setHttpForTests(
    makeHttp({
      '/tv/43/season/1': {
        season_number: 1,
        name: 'Season 1',
        air_date: '2021-05-01',
        episodes: [
          { episode_number: 1, name: 'Pilot', overview: 'x', air_date: '2021-05-01', runtime: 50, still_path: '/e1.jpg', vote_average: 7.46 },
        ],
      },
    })
  );
  const season = await tmdbService.getSeason(43, 1);
  assert.equal(season.showId, 43);
  assert.equal(season.episodes.length, 1);
  assert.equal(season.episodes[0].name, 'Pilot');
  assert.equal(season.episodes[0].runtime, 50);
  assert.equal(season.episodes[0].rating, 7.5);
  assert.match(season.episodes[0].still, /\/w300\/e1\.jpg$/);
});

test('discoverCandidates sends sorted OR-genres, quality filters and a runtime cap for movies', async () => {
  const http = makeHttp({ '/discover/movie': { results: [{ id: 5, title: 'A', release_date: '2010-01-01', genre_ids: [35], vote_average: 7 }] } });
  tmdbService._setHttpForTests(http);
  const out = await tmdbService.discoverCandidates({ mediaType: 'movie', genreIds: [35, 10751], maxRuntime: 100, page: 2 });
  const { params } = http.calls[0];
  assert.equal(params.with_genres, '35|10751');
  assert.equal(params['with_runtime.lte'], 100);
  assert.equal(params['vote_count.gte'], 300);
  assert.equal(params.page, 2);
  assert.equal(out[0].mediaType, 'movie');
});

test('discoverCandidates for TV uses /discover/tv and ignores the runtime cap', async () => {
  const http = makeHttp({ '/discover/tv': { results: [{ id: 9, name: 'S', first_air_date: '2015-01-01', genre_ids: [18], vote_average: 8 }] } });
  tmdbService._setHttpForTests(http);
  const out = await tmdbService.discoverCandidates({ mediaType: 'tv', genreIds: [18], maxRuntime: 90 });
  assert.equal(http.calls[0].url, '/discover/tv');
  assert.equal(http.calls[0].params['with_runtime.lte'], undefined);
  assert.equal(out[0].mediaType, 'tv');
});

test('discoverCandidates caches identical requests', async () => {
  const http = makeHttp({ '/discover/movie': { results: [] } });
  tmdbService._setHttpForTests(http);
  await tmdbService.discoverCandidates({ mediaType: 'movie', genreIds: [99], page: 4 });
  await tmdbService.discoverCandidates({ mediaType: 'movie', genreIds: [99], page: 4 });
  assert.equal(http.calls.length, 1);
});
