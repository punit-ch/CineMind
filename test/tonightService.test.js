process.env.GEMINI_API_KEY = 'test-key';
process.env.TMDB_API_KEY = 'test-key';
process.env.AI_RETRY_DELAY_MS = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const tmdbService = require('../services/tmdbService');
const geminiService = require('../services/geminiService');
const tonight = require('../services/tonightService');

const movie = (id, extra = {}) => ({
  id, title: `Movie ${id}`, overview: 'plot details', poster: null, backdrop: null,
  rating: 7 + (id % 3) / 10, voteCount: 1000 + id, releaseYear: '2010', genres: ['Comedy'], mediaType: 'movie', ...extra,
});
const show = (id, extra = {}) => movie(id, { title: `Show ${id}`, mediaType: 'tv', ...extra });

const realDiscover = tmdbService.discoverCandidates;
const realPick = geminiService.pickFromCandidates;
test.afterEach(() => {
  tmdbService.discoverCandidates = realDiscover;
  geminiService.pickFromCandidates = realPick;
});

test('moodGenres maps mood words to genres', () => {
  assert.deepEqual(tonight.moodGenres('something cozy'), ['Comedy', 'Family', 'Romance', 'Animation']);
  assert.ok(tonight.moodGenres('tense and gripping').includes('Thriller'));
  assert.deepEqual(tonight.moodGenres('qwerty'), []);
  assert.deepEqual(tonight.moodGenres(''), []);
});

test('genreIdsFor translates movie-style names for movies and TV', () => {
  assert.deepEqual(tonight.genreIdsFor('movie', ['Comedy', 'Sci-Fi']).sort((a, b) => a - b), [35, 878]);
  assert.deepEqual(tonight.genreIdsFor('tv', ['Action', 'Adventure', 'Sci-Fi', 'War', 'Drama']).sort((a, b) => a - b), [18, 10759, 10765, 10768]);
  assert.deepEqual(tonight.genreIdsFor('movie', ['Nonsense']), []);
});

test('buildCandidates passes mood genres and runtime, and excludes seen titles', async () => {
  let args;
  tmdbService.discoverCandidates = async (a) => {
    args = a;
    return [movie(1), movie(2), movie(3), movie(4)];
  };
  const out = await tonight.buildCandidates({ type: 'movie', mood: 'cozy', minutes: 95, exclude: ['movie:2'] });
  assert.deepEqual(out.map((c) => c.id), [1, 3, 4]);
  assert.equal(args.maxRuntime, 95);
  assert.ok(args.genreIds.includes(35));
});

test("buildCandidates for 'either' interleaves movies and TV and excludes by type", async () => {
  tmdbService.discoverCandidates = async ({ mediaType }) =>
    mediaType === 'movie' ? [movie(1), movie(2)] : [show(1), show(2)];
  const out = await tonight.buildCandidates({ type: 'either', exclude: ['tv:1'] });
  assert.deepEqual(out.map(tonight.refOf), ['movie:1', 'movie:2', 'tv:2']);
});

test('buildCandidates broadens the search when filters leave too few titles', async () => {
  const calls = [];
  tmdbService.discoverCandidates = async (a) => {
    calls.push(a.genreIds.length);
    return a.genreIds.length ? [movie(1)] : [movie(1), movie(2), movie(3)];
  };
  const out = await tonight.buildCandidates({ type: 'movie', mood: 'cozy' });
  assert.equal(out.length, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 0);
});

test('validatePicks drops unknown refs and duplicates and respects the count', () => {
  const cands = [movie(1), movie(2), show(2), movie(3)];
  const picks = tonight.validatePicks(
    [{ ref: 'movie:999' }, { ref: 'tv:2', reason: 'good' }, { ref: 'tv:2' }, { ref: 'movie:1' }, { ref: 'movie:3' }],
    cands,
    2
  );
  assert.deepEqual(picks.map((p) => tonight.refOf(p.item)), ['tv:2', 'movie:1']);
  assert.equal(picks[0].reason, 'good');
});

test('validatePicks tolerates garbage', () => {
  assert.deepEqual(tonight.validatePicks('nope', [movie(1)], 3), []);
  assert.deepEqual(tonight.validatePicks([null, {}, { ref: 5 }], [movie(1)], 3), []);
});

test('recommendTonight returns AI picks that are validated against the candidates', async () => {
  tmdbService.discoverCandidates = async () => [movie(1), movie(2), movie(3), movie(4)];
  geminiService.pickFromCandidates = async () => [
    { ref: 'movie:3', reason: 'Easy and warm', tonightFit: 'Cozy' },
    { ref: 'movie:77', reason: 'invented' },
    { ref: 'movie:1', reason: 'Fun', tonightFit: 'Light' },
    { ref: 'movie:2', reason: 'Nice', tonightFit: 'Gentle' },
  ];
  const out = await tonight.recommendTonight({ type: 'movie', mood: 'cozy' });
  assert.equal(out.source, 'ai');
  assert.deepEqual(out.picks.map((p) => p.id), [3, 1, 2]);
  assert.equal(out.picks[0].reason, 'Easy and warm');
  assert.equal(out.candidatesConsidered, 4);
});

test('picks never include the overview (it can contain spoilers)', async () => {
  tmdbService.discoverCandidates = async () => [movie(1), movie(2), movie(3)];
  geminiService.pickFromCandidates = async () => [{ ref: 'movie:1', reason: 'r' }];
  const out = await tonight.recommendTonight({});
  for (const p of out.picks) assert.equal('overview' in p, false);
});

test('tops up with code-ranked picks when the AI returns too few valid ones', async () => {
  tmdbService.discoverCandidates = async () => [movie(1), movie(2), movie(3), movie(4)];
  geminiService.pickFromCandidates = async () => [{ ref: 'movie:2', reason: 'only one' }];
  const out = await tonight.recommendTonight({});
  assert.equal(out.picks.length, 3);
  assert.equal(out.picks[0].source, 'ai');
  assert.equal(out.picks[1].source, 'fallback');
  assert.equal(out.source, 'ai');
  assert.equal(new Set(out.picks.map((p) => p.id)).size, 3);
});

test('falls back to code ranking when the AI fails (quota, bad JSON)', async () => {
  tmdbService.discoverCandidates = async () => [movie(1), movie(2), movie(3), movie(4)];
  geminiService.pickFromCandidates = async () => {
    throw Object.assign(new Error('quota'), { status: 429 });
  };
  const out = await tonight.recommendTonight({ mood: 'cozy' });
  assert.equal(out.source, 'fallback');
  assert.equal(out.picks.length, 3);
  assert.ok(out.picks.every((p) => p.source === 'fallback' && p.reason));
});

test('returns an empty result when there are no candidates', async () => {
  tmdbService.discoverCandidates = async () => [];
  let called = false;
  geminiService.pickFromCandidates = async () => {
    called = true;
    return [];
  };
  const out = await tonight.recommendTonight({});
  assert.deepEqual(out, { picks: [], source: 'none', candidatesConsidered: 0 });
  assert.equal(called, false);
});

test('fallbackRank prefers well-rated titles with many votes', () => {
  const ranked = tonight.fallbackRank([
    { id: 1, rating: 8.5, voteCount: 20 },
    { id: 2, rating: 8.0, voteCount: 20000 },
    { id: 3, rating: 6.4, voteCount: 50000 },
  ]);
  assert.equal(ranked[0].id, 2);
});
