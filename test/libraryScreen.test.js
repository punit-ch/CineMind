// Smoke tests for the Library screen's event handling, using a tiny fake DOM.
// They check the handler logic (and catch typos/undefined names), not real browser rendering.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('../testing/loadEsm');

const core = loadEsm('library/libraryCore.js');
const ui = loadEsm('ui.js');
const { createLibraryStore } = loadEsm('library/store.js', core);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeStorage = () => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } }; };

function fakeEl() {
  const handlers = {};
  return {
    innerHTML: '', value: '', handlers, classList: { add() {}, remove() {} },
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    querySelector: () => null, querySelectorAll: () => [], scrollIntoView() {}, focus() {}, setAttribute() {},
  };
}
const fire = (node, type, event) => (node.handlers[type] || []).forEach((fn) => fn(event));

// A click on a button: `ancestors` maps a selector fragment to the fake element returned by closest()
function click(node, action, ancestors = {}) {
  const btn = {
    dataset: { action },
    closest: (sel) => Object.entries(ancestors).find(([frag]) => sel.includes(frag))?.[1] || null,
  };
  fire(node, 'click', { target: { closest: (sel) => (sel === 'button[data-action]' ? btn : null) } });
}

async function setup({ fetchImpl } = {}) {
  const store = createLibraryStore(fakeStorage());
  const toasts = [];
  const els = Object.fromEntries(['#lib-tabs', '#lib-panel', '#lib-log', '#lib-results', '#lib-search', '#lib-search-type', '#lib-status'].map((id) => [id, fakeEl()]));
  const root = { querySelector: (sel) => els[sel] || null };
  const { initLibrary } = loadEsm('library/libraryView.js', {
    esc: ui.esc,
    showToast: (msg, type) => toasts.push([type, msg]),
    getLibraryStore: () => store,
    window: { confirm: () => true },
    document: { querySelector: () => null },
    navigator: { language: 'en-US' },
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({}) })),
    ...core,
  });
  initLibrary(root);
  return { store, els, toasts };
}

const json = (data, ok = true) => ({ ok, json: async () => data });
const heat = { id: 11, title: 'Heat', releaseYear: '1995', poster: null };
// Same shape the server returns for TV search results (see normalizeShow in tmdbService)
const wire = { id: 7, title: 'The Wire', releaseYear: '2002', poster: null, mediaType: 'tv' };

test('starts on the film queue with an empty state and tab counts', async () => {
  const { els } = await setup();
  assert.ok(els['#lib-panel'].innerHTML.includes('queue is empty'));
  assert.ok(els['#lib-tabs'].innerHTML.includes('Films') && els['#lib-tabs'].innerHTML.includes('Diary'));
});

test('searching, queueing, reordering and removing a film', async () => {
  const { store, els, toasts } = await setup({
    fetchImpl: async (url) => json(url.includes('/api/movies/search') ? { movies: [heat, { ...heat, id: 12, title: 'Ronin' }] } : {}),
  });
  els['#lib-search'].value = 'heat';
  fire(els['#lib-search'], 'input', {});
  await sleep(450);
  assert.ok(els['#lib-results'].innerHTML.includes('Heat') && els['#lib-results'].innerHTML.includes('Ronin'));

  click(els['#lib-results'], 'queue', { '.lib-result': { dataset: { ref: 'movie:11' } } });
  click(els['#lib-results'], 'queue', { '.lib-result': { dataset: { ref: 'movie:12' } } });
  assert.deepEqual(store.get().queue.movie.map((q) => q.ref), ['movie:11', 'movie:12']);
  assert.ok(toasts.some(([type, msg]) => type === 'success' && msg.includes('Heat')));
  assert.ok(els['#lib-panel'].innerHTML.includes('Ronin'));

  click(els['#lib-panel'], 'down', { '[data-ref]': { dataset: { ref: 'movie:11' } } });
  assert.deepEqual(store.get().queue.movie.map((q) => q.ref), ['movie:12', 'movie:11']);
  click(els['#lib-panel'], 'remove', { '[data-ref]': { dataset: { ref: 'movie:12' } } });
  assert.deepEqual(store.get().queue.movie.map((q) => q.ref), ['movie:11']);
});

test('a drag and drop reorders the queue', async () => {
  const { store, els } = await setup();
  for (const id of [1, 2, 3]) store.update((l) => core.addToQueue(l, { id, mediaType: 'movie', title: `M${id}` }));
  const row = (ref) => ({ dataset: { ref }, classList: { add() {} } });
  fire(els['#lib-panel'], 'dragstart', { target: { closest: () => row('movie:1') }, dataTransfer: { setData() {} } });
  fire(els['#lib-panel'], 'drop', { target: { closest: () => row('movie:3') }, preventDefault() {} });
  assert.deepEqual(store.get().queue.movie.map((q) => q.ref), ['movie:2', 'movie:3', 'movie:1']);
});

test('logging a viewing from the queue', async () => {
  const { store, els, toasts } = await setup();
  store.update((l) => core.addToQueue(l, { id: 11, mediaType: 'movie', title: 'Heat', releaseYear: '1995' }));
  click(els['#lib-panel'], 'log', { '[data-ref]': { dataset: { ref: 'movie:11' } } });
  assert.ok(els['#lib-log'].innerHTML.includes('lib-log-form'));

  const field = (value, extra = {}) => ({ value, ...extra });
  const form = {
    watchedOn: field('2026-11-20'), rating: field('8.5'), rewatch: { checked: false }, review: field('Great'),
    withWhom: field('friends'), where: field('home'), mood: field('tense'), timeOfDay: field('evening'), notes: field(''),
  };
  fire(els['#lib-log'], 'submit', { target: form, preventDefault() {} });
  const lib = store.get();
  assert.equal(lib.diary.length, 1);
  assert.equal(lib.diary[0].rating, 85);
  assert.equal(lib.diary[0].extras.withWhom, 'friends');
  assert.equal(lib.queue.movie.length, 0);
  assert.ok(toasts.some(([, msg]) => msg === 'Logged Heat'));
});

test('an invalid rating shows an error and logs nothing', async () => {
  const { store, els, toasts } = await setup();
  store.update((l) => core.addToQueue(l, { id: 11, mediaType: 'movie', title: 'Heat' }));
  click(els['#lib-panel'], 'log', { '[data-ref]': { dataset: { ref: 'movie:11' } } });
  const f = (value) => ({ value });
  fire(els['#lib-log'], 'submit', {
    target: { watchedOn: f('2026-11-20'), rating: f('42'), rewatch: { checked: false }, review: f(''), withWhom: f(''), where: f(''), mood: f(''), timeOfDay: f(''), notes: f('') },
    preventDefault() {},
  });
  assert.equal(store.get().diary.length, 0);
  assert.ok(toasts.some(([type]) => type === 'error'));
});

test('TV episodes: load, Spoiler Shield, mark, mark up to here, switch season, close', async () => {
  const seasons = [
    { seasonNumber: 0, name: 'Specials', episodeCount: 2 },
    { seasonNumber: 1, name: 'Season 1', episodeCount: 3 },
    { seasonNumber: 2, name: 'Season 2', episodeCount: 4 },
  ];
  const season = (n, count) => ({ seasonNumber: n, episodes: Array.from({ length: count }, (_, i) => ({ episodeNumber: i + 1, name: `Secret Title ${n}x${i + 1}`, overview: 'Spoiler text', airDate: '2002-01-01', runtime: 50 })) });
  const calls = [];
  const { store, els } = await setup({
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('/api/tv/search')) return json({ shows: [wire] });
      if (url.endsWith('/seasons/1')) return json(season(1, 3));
      if (url.endsWith('/seasons/2')) return json(season(2, 4));
      if (url.endsWith('/api/tv/7')) return json({ seasons });
      return json({ error: 'nope' }, false);
    },
  });
  // Search TV and open its episodes
  fire(els['#lib-search-type'], 'click', { target: { closest: () => ({ dataset: { type: 'tv' }, setAttribute() {} }) } });
  els['#lib-search'].value = 'the wire';
  fire(els['#lib-search'], 'input', {});
  await sleep(450);
  click(els['#lib-results'], 'episodes', { '.lib-result': { dataset: { ref: 'tv:7' } } });
  await sleep(30);

  const html = () => els['#lib-panel'].innerHTML;
  assert.ok(html().includes('lib-episodes') && html().includes('Episode 1'));
  assert.ok(!html().includes('Secret Title') && !html().includes('Spoiler text'));      // Spoiler Shield
  assert.ok(!html().includes('Specials'));                                               // specials are not listed
  assert.ok(calls.some((u) => u.endsWith('/seasons/1')));

  // Tick episode 2
  const li = (n) => ({ dataset: { episode: String(n) } });
  const tick = (n, checked) => fire(els['#lib-panel'], 'change', {
    target: { id: '', checked, matches: (sel) => sel.includes('toggle-episode'), closest: () => li(n) },
  });
  tick(2, true);
  assert.deepEqual(store.get().episodes['tv:7'].seasons[1].watched, [2]);
  assert.equal(store.get().items['tv:7'].status, 'watching');
  assert.ok(html().includes('Secret Title 1x2'));                                        // watched episodes reveal their title

  // Reveal episode 3 without watching it
  click(els['#lib-panel'], 'reveal-episode', { '[data-episode]': li(3) });
  assert.ok(html().includes('Secret Title 1x3'));
  assert.deepEqual(store.get().episodes['tv:7'].seasons[1].watched, [2]);

  // Switch to season 2 and mark up to episode 2
  fire(els['#lib-panel'], 'change', { target: { id: 'lib-season-select', value: '2', matches: () => false } });
  await sleep(30);
  click(els['#lib-panel'], 'up-to', { '[data-episode]': li(2) });
  const eps = store.get().episodes['tv:7'].seasons;
  assert.deepEqual(eps[1].watched, [1, 2, 3]);
  assert.deepEqual(eps[2].watched, [1, 2]);

  // Close
  click(els['#lib-panel'], 'close-episodes');
  assert.ok(!html().includes('lib-episodes'));
});

test('an episode load failure shows an error message and can be closed', async () => {
  const { els } = await setup({ fetchImpl: async (url) => (url.includes('search') ? json({ shows: [wire] }) : json({ error: 'TMDB is down' }, false)) });
  fire(els['#lib-search-type'], 'click', { target: { closest: () => ({ dataset: { type: 'tv' }, setAttribute() {} }) } });
  els['#lib-search'].value = 'wire';
  fire(els['#lib-search'], 'input', {});
  await sleep(450);
  click(els['#lib-results'], 'episodes', { '.lib-result': { dataset: { ref: 'tv:7' } } });
  await sleep(30);
  assert.ok(els['#lib-panel'].innerHTML.includes('TMDB is down'));
  click(els['#lib-panel'], 'close-episodes');
  assert.ok(!els['#lib-panel'].innerHTML.includes('TMDB is down'));
});

test('export, then import with merge, reports what was imported', async () => {
  const { store, els } = await setup();
  store.update((l) => core.addToQueue(l, { id: 11, mediaType: 'movie', title: 'Heat' }));
  const exported = core.exportLibrary(store.get());
  store.reset();
  const msg = { textContent: '' };
  const panel = els['#lib-panel'];
  const realQuery = panel.querySelector;
  panel.querySelector = (sel) => (sel === '#lib-import-msg' ? msg : sel.includes('import-mode') ? { value: 'merge' } : realQuery(sel));
  await Promise.all((panel.handlers.change || []).map((fn) => fn({ target: { id: 'lib-import-file', files: [{ text: async () => exported }], value: 'x' } })));
  assert.ok(msg.textContent.startsWith('Imported 1 titles'));
  assert.deepEqual(store.get().queue.movie.map((q) => q.ref), ['movie:11']);
});

test('importing a bad file shows an error and leaves the library alone', async () => {
  const { store, els } = await setup();
  store.update((l) => core.addToQueue(l, { id: 11, mediaType: 'movie', title: 'Heat' }));
  const msg = { textContent: '' };
  const panel = els['#lib-panel'];
  panel.querySelector = (sel) => (sel === '#lib-import-msg' ? msg : null);
  await Promise.all((panel.handlers.change || []).map((fn) => fn({ target: { id: 'lib-import-file', files: [{ text: async () => 'not json' }], value: 'x' } })));
  assert.match(msg.textContent, /not valid JSON/);
  assert.equal(store.get().queue.movie.length, 1);
});
