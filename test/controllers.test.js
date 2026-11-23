process.env.GEMINI_API_KEY = 'test-key';
process.env.TMDB_API_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const tmdbService = require('../services/tmdbService');
const tonightService = require('../services/tonightService');
const tvController = require('../controllers/tvController');
const aiController = require('../controllers/aiController');

const makeRes = () => ({ body: undefined, json(v) { this.body = v; return this; } });

// ─── TV controller ───────────────────────────────────────────────────────────
const tmdbOriginals = { ...tmdbService };
test.afterEach(() => Object.assign(tmdbService, tmdbOriginals));

test('tv search requires a query', async () => {
  await assert.rejects(tvController.search({ query: {} }, makeRes()), { status: 400 });
});

test('tv search passes a trimmed query and page to the service', async () => {
  let args;
  tmdbService.searchShows = async (q, page) => {
    args = [q, page];
    return { shows: [] };
  };
  const res = makeRes();
  await tvController.search({ query: { q: '  The Wire  ', page: '2' } }, res);
  assert.deepEqual(args, ['The Wire', 2]);
  assert.deepEqual(res.body, { shows: [] });
});

test('tv details rejects non-numeric ids', async () => {
  await assert.rejects(tvController.getDetails({ params: { id: 'abc' } }, makeRes()), { status: 400, message: 'Invalid show ID' });
});

test('tv season validates both ids and calls the service', async () => {
  await assert.rejects(tvController.getSeason({ params: { id: '1', season: 'x' } }, makeRes()), { status: 400 });
  let args;
  tmdbService.getSeason = async (...a) => {
    args = a;
    return { episodes: [] };
  };
  const res = makeRes();
  await tvController.getSeason({ params: { id: '42', season: '0' } }, res);
  assert.deepEqual(args, [42, 0]);
});

test('tv trending defaults to a weekly window', async () => {
  tmdbService.getTrendingShows = async (w) => [{ w }];
  const res = makeRes();
  await tvController.getTrending({ query: {} }, res);
  assert.equal(res.body.timeWindow, 'week');
});

// ─── Tonight controller ──────────────────────────────────────────────────────
const realRecommend = tonightService.recommendTonight;
test.afterEach(() => {
  tonightService.recommendTonight = realRecommend;
});

test('tonight rejects an unknown type', async () => {
  await assert.rejects(aiController.tonight({ body: { type: 'podcast' } }, makeRes()), { status: 400 });
});

test('tonight cleans and bounds its inputs before calling the service', async () => {
  let params;
  tonightService.recommendTonight = async (p) => {
    params = p;
    return { picks: [], source: 'none', candidatesConsidered: 0 };
  };
  const res = makeRes();
  await aiController.tonight(
    {
      body: {
        type: 'either',
        mood: 'cozy`{}',
        minutes: '5',
        genres: ['Comedy', 'Drama'],
        page: '99',
        exclude: ['movie:1', 'tv:2', 'bad', 'movie:abc', 7, 'tv:3'],
      },
    },
    res
  );
  assert.equal(params.type, 'either');
  assert.equal(params.mood, 'cozy');
  assert.equal(params.minutes, 20); // clamped to the minimum
  assert.equal(params.page, 5); // clamped to the maximum
  assert.deepEqual(params.exclude, ['movie:1', 'tv:2', 'tv:3']);
  assert.deepEqual(res.body, { picks: [], source: 'none', candidatesConsidered: 0 });
});

test('tonight works with an empty body and defaults to movies', async () => {
  let params;
  tonightService.recommendTonight = async (p) => {
    params = p;
    return { picks: [] };
  };
  await aiController.tonight({}, makeRes());
  assert.equal(params.type, 'movie');
  assert.equal(params.minutes, undefined);
  assert.equal(params.page, 1);
});
