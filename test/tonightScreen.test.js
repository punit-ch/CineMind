// Smoke tests for the Tonight screen's behaviour, using a tiny fake DOM (handler logic, not real rendering).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('../testing/loadEsm');

const core = loadEsm('library/libraryCore.js');
const ui = loadEsm('ui.js');
const logic = loadEsm('tonightLogic.js');
const providers = loadEsm('providers.js');
const { createLibraryStore } = loadEsm('library/store.js', core);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeStorage = () => { const d = {}; return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } }; };

function fakeEl(extra = {}) {
  const handlers = {};
  const { classes = [], ...rest } = extra;
  const el = {
    innerHTML: '', value: '', className: classes.join(' '), handlers, parentNode: null,
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, click() { (handlers.click || []).forEach((fn) => fn({})); },
    ...rest,
  };
  // classList mirrors className, like the real DOM
  const list = () => el.className.split(/\s+/).filter(Boolean);
  el.classList = {
    add: (c) => { if (!list().includes(c)) el.className = [...list(), c].join(' '); },
    remove: (c) => { el.className = list().filter((x) => x !== c).join(' '); },
    has: (c) => list().includes(c),
  };
  return el;
}
const fire = (node, type, event = {}) => (node.handlers[type] || []).forEach((fn) => fn(event));

const pick = (id, mediaType = 'movie') => ({ id, mediaType, title: `Title ${id}`, releaseYear: '2010', rating: 7.5, genres: ['Comedy'], poster: null, reason: 'Good', tonightFit: 'Easy', source: 'ai' });

async function setup({ picks = [pick(1), pick(2, 'tv')], providersImpl, language = 'en-IN' } = {}) {
  const storage = fakeStorage();
  const store = createLibraryStore(fakeStorage());
  const requests = [];
  const providerCalls = [];
  const slots = new Map();
  const toasts = [];

  const results = fakeEl();
  results.querySelector = (sel) => {
    const m = /^\[data-where="([^"]+)"\]$/.exec(sel);
    if (!m) return null;
    if (!slots.has(m[1])) slots.set(m[1], { innerHTML: '' });
    return slots.get(m[1]);
  };
  const inserted = [];
  const parent = { insertBefore: (el) => inserted.push(el) };
  results.parentNode = parent;
  const countrySelect = fakeEl();
  const els = {
    '#tonight-type': fakeEl(), '#tonight-time': fakeEl(), '#tonight-moods': fakeEl(), '#tonight-mood-input': fakeEl(),
    '#tonight-go': fakeEl(), '#tonight-again': fakeEl(), '#tonight-more': fakeEl({ classes: ['hidden'] }), '#tonight-results': results,
  };
  const root = { querySelector: (sel) => els[sel] || null };

  const { initTonight } = loadEsm('tonight.js', {
    aiApi: { tonight: async (body) => { requests.push(body); return { picks, source: 'ai', candidatesConsidered: 10 }; } },
    esc: ui.esc,
    showToast: (m, t) => toasts.push([t, m]),
    setLoading() {},
    syncWatchlistButtons() {},
    getLibraryStore: () => store,
    window: { localStorage: storage, navigator: { languages: [language] } },
    document: { createElement: () => fakeEl({ querySelector: (sel) => (sel === '#tonight-country' ? countrySelect : null) }) },
    ...core, ...providers, ...logic,
    fetchProviders: providersImpl || (async (type, id, country) => { providerCalls.push([type, id, country]); return { country, available: true, link: null, stream: [{ id: 1, name: `On ${country}`, logo: null }], free: [], ads: [], rent: [], buy: [] }; }),
  });
  initTonight(root);
  return { els, results, store, requests, providerCalls, slots, toasts, storage, countrySelect, inserted };
}

test('the country control and attribution are added next to the results, using the browser region', async () => {
  const { inserted } = await setup({ language: 'en-IN' });
  assert.equal(inserted.length, 2);
  assert.ok(inserted[0].innerHTML.includes('Where to watch in'));
  assert.ok(inserted[0].innerHTML.includes('<option value="IN" selected>India</option>'));
  assert.ok(inserted[1].innerHTML.includes('JustWatch'));
  assert.ok(inserted[1].classList.has('hidden')); // shown once there are picks
});

test('picking requests Tonight, renders the cards, then fills where to watch for each pick', async () => {
  const { els, results, requests, providerCalls, slots, inserted } = await setup();
  els['#tonight-go'].click();
  await sleep(20);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].type, 'movie');
  assert.ok(results.innerHTML.includes('Title 1') && results.innerHTML.includes('Title 2'));
  assert.deepEqual(providerCalls.sort(), [['movie', 1, 'IN'], ['tv', 2, 'IN']].sort());
  assert.ok(slots.get('movie:1').innerHTML.includes('On IN'));
  assert.ok(slots.get('tv:2').innerHTML.includes('On IN'));
  assert.ok(!els['#tonight-more'].classList.has('hidden'));
  assert.ok(!inserted[1].classList.has('hidden'));
});

test('changing the country saves it and refetches availability without asking the AI again', async () => {
  const { els, requests, providerCalls, slots, storage, countrySelect } = await setup();
  els['#tonight-go'].click();
  await sleep(20);
  providerCalls.length = 0;
  fire(countrySelect, 'change', { target: { value: 'US' } });
  await sleep(20);
  assert.equal(requests.length, 1);
  assert.equal(storage.d.cinemind_country, 'US');
  assert.deepEqual(providerCalls.map((c) => c[2]), ['US', 'US']);
  assert.ok(slots.get('movie:1').innerHTML.includes('On US'));
});

test('a slow answer for the old country never overwrites the new one', async () => {
  const resolvers = {};
  const providersImpl = (type, id, country) => new Promise((resolve) => { resolvers[`${type}:${id}:${country}`] = () => resolve({ country, available: true, link: null, stream: [{ id: 1, name: `On ${country}`, logo: null }], free: [], ads: [], rent: [], buy: [] }); });
  const { els, slots, countrySelect } = await setup({ providersImpl, picks: [pick(1)] });
  els['#tonight-go'].click();
  await sleep(20);
  fire(countrySelect, 'change', { target: { value: 'US' } });
  await sleep(5);
  resolvers['movie:1:US']();
  await sleep(5);
  resolvers['movie:1:IN']();
  await sleep(5);
  assert.ok(slots.get('movie:1').innerHTML.includes('On US'));
  assert.ok(!slots.get('movie:1').innerHTML.includes('On IN'));
});

test('a failed availability lookup shows a quiet message and the picks stay', async () => {
  const { els, results, slots } = await setup({ providersImpl: async () => { throw new Error('down'); }, picks: [pick(1)] });
  els['#tonight-go'].click();
  await sleep(20);
  assert.ok(results.innerHTML.includes('Title 1'));
  assert.ok(slots.get('movie:1').innerHTML.includes('not available right now'));
});

test('"+ Queue" still adds a pick to the library', async () => {
  const { els, results, store } = await setup();
  els['#tonight-go'].click();
  await sleep(20);
  const btn = { disabled: false, textContent: '+ Queue', dataset: { queueRef: 'tv:2' } };
  fire(results, 'click', { target: { closest: (sel) => (sel === '[data-queue-ref]' ? btn : null) } });
  assert.deepEqual(store.get().queue.tv.map((q) => q.ref), ['tv:2']);
  assert.equal(btn.textContent, 'In queue');
});
