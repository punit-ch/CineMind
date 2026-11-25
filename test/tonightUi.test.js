// Tests for the Tonight screen's browser modules.
// The files are ES modules that the app serves to the browser; here they are loaded into plain functions
// (imports stripped and replaced by injected dependencies) so they can run under Node without a DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadEsm } = require('../testing/loadEsm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8');

const ui = loadEsm('ui.js');
const logic = loadEsm('tonightLogic.js');
const libraryCore = loadEsm('library/libraryCore.js');
const view = loadEsm('tonight.js', {
  aiApi: {},
  esc: ui.esc,
  showToast() {},
  setLoading() {},
  syncWatchlistButtons() {},
  getLibraryStore() {},
  ...libraryCore,
  ...logic,
});

// ─── tonightLogic ────────────────────────────────────────────────────────────
test('buildRequest falls back to movies, trims the mood and only sends meaningful fields', () => {
  assert.deepEqual(logic.buildRequest({ type: 'podcast', minutes: null, mood: '   ', page: 1, shown: [] }), { type: 'movie', page: 1 });
  const body = logic.buildRequest({ type: 'either', minutes: '120', mood: '  cozy  ', page: 3, shown: ['movie:1'] });
  assert.deepEqual(body, { type: 'either', page: 3, mood: 'cozy', minutes: 120, exclude: ['movie:1'] });
});

test('buildRequest caps the mood length and the exclude list', () => {
  const shown = Array.from({ length: 400 }, (_, i) => `movie:${i}`);
  const body = logic.buildRequest({ type: 'movie', mood: 'x'.repeat(200), shown });
  assert.equal(body.mood.length, 60);
  assert.equal(body.exclude.length, 150);
  assert.equal(body.exclude.at(-1), 'movie:399'); // keeps the most recent
});

test('nextPage cycles from 1 to 5 and back', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(logic.nextPage), [2, 3, 4, 5, 1]);
});

test('refOf, tmdbUrl and sourceLabel', () => {
  assert.equal(logic.refOf({ id: 5, mediaType: 'tv' }), 'tv:5');
  assert.equal(logic.refOf({ id: 5 }), 'movie:5');
  assert.equal(logic.tmdbUrl({ id: 5, mediaType: 'tv' }), 'https://www.themoviedb.org/tv/5');
  assert.equal(logic.sourceLabel('ai'), '✦ AI pick');
  assert.equal(logic.sourceLabel('fallback'), 'Top-rated pick');
});

const fakeStorage = (initial) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
};

test('loadPrefs returns defaults for missing or corrupt data', () => {
  assert.deepEqual(logic.loadPrefs(fakeStorage({})), logic.DEFAULT_PREFS);
  assert.deepEqual(logic.loadPrefs(fakeStorage({ cinemind_tonight_prefs: '{nope' })), logic.DEFAULT_PREFS);
  assert.deepEqual(logic.loadPrefs({ getItem() { throw new Error('blocked'); } }), logic.DEFAULT_PREFS);
});

test('loadPrefs sanitizes stored values', () => {
  const stored = JSON.stringify({ type: 'hack', minutes: 999, mood: 'x'.repeat(100) });
  const prefs = logic.loadPrefs(fakeStorage({ cinemind_tonight_prefs: stored }));
  assert.equal(prefs.type, 'movie');
  assert.equal(prefs.minutes, null);
  assert.equal(prefs.mood.length, 60);
});

test('savePrefs round-trips and never throws', () => {
  const storage = fakeStorage({});
  logic.savePrefs(storage, { type: 'tv', minutes: 90, mood: 'tense', extra: 'ignored' });
  assert.deepEqual(logic.loadPrefs(storage), { type: 'tv', minutes: 90, mood: 'tense' });
  assert.doesNotThrow(() => logic.savePrefs({ setItem() { throw new Error('quota'); } }, logic.DEFAULT_PREFS));
});

// ─── Card markup ─────────────────────────────────────────────────────────────
const moviePick = {
  id: 11, title: 'Heat <script>alert(1)</script>', mediaType: 'movie', releaseYear: '1995', rating: 8.04,
  poster: 'https://image.tmdb.org/t/p/w500/h.jpg', genres: ['Crime', 'Drama', 'Thriller', 'Action'],
  reason: 'A "tense" pick & more', tonightFit: 'Gripping', source: 'ai',
};

test('a movie card escapes text, shows Details and a watchlist heart with compact movie data', () => {
  const html = view.buildTonightCard(moviePick);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Heat &lt;script&gt;'));
  assert.ok(html.includes('movie-info-btn'));
  assert.ok(html.includes('watchlist-toggle'));
  assert.ok(html.includes('tonight-card__source--ai'));
  assert.ok(html.includes('8.0'));
  assert.equal((html.match(/class="tag">/g) || []).length, 4); // type + three genres
  const json = /data-movie="([^"]*)"/.exec(html)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
  const data = JSON.parse(json);
  assert.deepEqual(Object.keys(data).sort(), ['genres', 'id', 'poster', 'rating', 'releaseYear', 'title']);
});

test('a TV card links out to TMDB and has no movie-only controls', () => {
  const html = view.buildTonightCard({ ...moviePick, id: 7, mediaType: 'tv', source: 'fallback', reason: 'Great' });
  assert.ok(html.includes('https://www.themoviedb.org/tv/7'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(!html.includes('movie-info-btn'));
  assert.ok(!html.includes('watchlist-toggle'));
  assert.ok(!html.includes('data-movie='));
  assert.ok(html.includes('tonight-card__source--top'));
});

test('every card has a queue button, which is disabled once the title is queued', () => {
  assert.match(view.buildTonightCard(moviePick), /data-queue-ref="movie:11" >\+ Queue/);
  assert.match(view.buildTonightCard({ ...moviePick, id: 7, mediaType: 'tv' }, 0, true), /data-queue-ref="tv:7" disabled>In queue/);
});

test('queue button data works with the library core (a pick can be queued as is)', () => {
  const pick = { id: 21, mediaType: 'tv', title: 'The Wire', releaseYear: '2002', poster: 'https://image.tmdb.org/t/p/w500/w.jpg', genres: ['Crime'], reason: 'r', source: 'ai' };
  const lib = libraryCore.addToQueue(libraryCore.emptyLibrary(), pick);
  assert.deepEqual(lib.queue.tv.map((q) => q.ref), ['tv:21']);
  assert.equal(lib.items['tv:21'].title, 'The Wire');
});

test('unsafe poster URLs are not rendered as images', () => {
  const html = view.buildTonightCard({ ...moviePick, poster: 'javascript:alert(1)' });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('tonight-card__poster--empty'));
});

test('a missing year ("N/A") is left out', () => {
  assert.ok(!view.buildTonightCard({ ...moviePick, releaseYear: 'N/A' }).includes('tonight-card__year'));
});

// ─── The element ids the script uses must exist in the markup the patch inserts ─
const patchScript = path.join(__dirname, '..', 'scripts', 'apply_tonight_ui.py');
// Skipped once the one-time patch script has been deleted
test('every element id used by tonight.js exists in the dashboard section markup', { skip: !fs.existsSync(patchScript) }, () => {
  const script = fs.readFileSync(patchScript, 'utf8');
  const used = new Set((read('tonight.js').match(/#(tonight-[a-z-]+)/g) || []).map((s) => s.slice(1)));
  used.delete('tonight-retry'); // created at runtime by the error state
  assert.ok(used.size >= 7);
  for (const id of used) assert.ok(script.includes(`id="${id}"`), `dashboard markup is missing #${id}`);
});
