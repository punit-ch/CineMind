process.env.GEMINI_API_KEY = 'test-key';
process.env.TMDB_API_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('../testing/loadEsm');
const tmdbService = require('../services/tmdbService');
const providersController = require('../controllers/providersController');
const pv = loadEsm('providers.js');

// ─── service ─────────────────────────────────────────────────────────────────
const tmdbResponse = {
  id: 550,
  results: {
    IN: {
      link: 'https://www.themoviedb.org/movie/550/watch?locale=IN',
      flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg' }],
      rent: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: '/a.jpg' }, { provider_id: 3, provider_name: '', logo_path: null }],
    },
    US: { link: 'https://www.themoviedb.org/movie/550/watch?locale=US', free: [{ provider_id: 9, provider_name: 'Tubi', logo_path: null }] },
  },
};

test('getWatchProviders normalizes TMDB data per country, drops nameless providers, and caches', async () => {
  const calls = [];
  tmdbService._setHttpForTests({ get: async (url) => { calls.push(url); return { data: tmdbResponse }; } });
  const a = await tmdbService.getWatchProviders('movie', 550);
  const b = await tmdbService.getWatchProviders('movie', 550);
  tmdbService._setHttpForTests(null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], '/movie/550/watch/providers');
  assert.equal(a, b);
  assert.deepEqual(a.IN.stream, [{ id: 8, name: 'Netflix', logo: 'https://image.tmdb.org/t/p/w92/n.jpg' }]);
  assert.deepEqual(a.IN.rent.map((p) => p.name), ['Apple TV']);
  assert.deepEqual(a.IN.free, []);
  assert.equal(a.US.free[0].logo, null);
});

test('getWatchProviders uses the TV endpoint for shows and survives empty data', async () => {
  const calls = [];
  tmdbService._setHttpForTests({ get: async (url) => { calls.push(url); return { data: {} }; } });
  const out = await tmdbService.getWatchProviders('tv', 9991);
  tmdbService._setHttpForTests(null);
  assert.equal(calls[0], '/tv/9991/watch/providers');
  assert.deepEqual(out, {});
});

// ─── controller ──────────────────────────────────────────────────────────────
const makeRes = () => ({ body: undefined, json(v) { this.body = v; return this; } });
const original = tmdbService.getWatchProviders;
test.afterEach(() => { tmdbService.getWatchProviders = original; });

test('controller returns the requested country, upper-cased, with attribution', async () => {
  tmdbService.getWatchProviders = async () => ({ IN: { link: 'https://www.themoviedb.org/x', stream: [{ id: 8, name: 'Netflix', logo: null }], free: [], ads: [], rent: [], buy: [] } });
  const res = makeRes();
  await providersController.get({ params: { mediaType: 'movie', id: '550' }, query: { country: 'in' } }, res);
  assert.equal(res.body.country, 'IN');
  assert.equal(res.body.available, true);
  assert.equal(res.body.stream[0].name, 'Netflix');
  assert.equal(res.body.attribution, 'JustWatch');
});

test('controller reports not available for countries without data, defaulting to US', async () => {
  tmdbService.getWatchProviders = async () => ({ IN: { link: null, stream: [{ id: 1, name: 'X', logo: null }], free: [], ads: [], rent: [], buy: [] } });
  const res = makeRes();
  await providersController.get({ params: { mediaType: 'tv', id: '7' }, query: {} }, res);
  assert.equal(res.body.country, 'US');
  assert.equal(res.body.available, false);
  assert.deepEqual(res.body.stream, []);
});

test('controller validates mediaType, id and country', async () => {
  const run = (params, query) => providersController.get({ params, query }, makeRes());
  await assert.rejects(run({ mediaType: 'podcast', id: '1' }, {}), { status: 400 });
  await assert.rejects(run({ mediaType: 'movie', id: 'abc' }, {}), { status: 400 });
  await assert.rejects(run({ mediaType: 'movie', id: '1' }, { country: 'INDIA' }), { status: 400 });
  await assert.rejects(run({ mediaType: 'movie', id: '1' }, { country: '1;' }), { status: 400 });
});

// ─── frontend helpers ────────────────────────────────────────────────────────
test('detectCountry prefers a language region, then the time zone, then the US', () => {
  assert.equal(pv.detectCountry({ languages: ['en-IN', 'hi'] }), 'IN');
  assert.equal(pv.detectCountry({ languages: ['en', 'fr-CA'] }), 'CA');
  assert.equal(pv.detectCountry({ languages: ['en'], timeZone: 'Asia/Kolkata' }), 'IN');
  assert.equal(pv.detectCountry({ languages: ['en'] }), 'US');
  assert.equal(pv.detectCountry(), 'US');
});

const fakeStorage = (init = {}) => { const d = { ...init }; return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } }; };

test('getCountry uses a valid saved choice, ignores junk, and saveCountry validates', () => {
  assert.equal(pv.getCountry(fakeStorage({ cinemind_country: 'GB' }), { languages: ['en-IN'] }), 'GB');
  assert.equal(pv.getCountry(fakeStorage({ cinemind_country: '<x>' }), { languages: ['en-IN'] }), 'IN');
  assert.equal(pv.getCountry({ getItem() { throw new Error('blocked'); } }, { languages: ['en-AU'] }), 'AU');
  const s = fakeStorage();
  pv.saveCountry(s, 'in');
  assert.deepEqual(s.d, {});
  pv.saveCountry(s, 'IN');
  assert.equal(s.d.cinemind_country, 'IN');
});

test('countryOptionsHtml selects the current country and adds unknown ones', () => {
  assert.match(pv.countryOptionsHtml('IN'), /<option value="IN" selected>India<\/option>/);
  assert.match(pv.countryOptionsHtml('PH'), /<option value="PH" selected>Other \(PH\)<\/option>/);
});

test('buildProviders shows groups, caps each list, and escapes names', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: i, name: `Svc${i}`, logo: null }));
  const html = pv.buildProviders({
    country: 'IN', available: true, link: 'https://www.themoviedb.org/movie/1/watch?locale=IN',
    stream: [{ id: 1, name: 'Net<b>flix', logo: 'https://image.tmdb.org/t/p/w92/n.jpg' }], free: [], ads: [], rent: many, buy: [],
  });
  assert.ok(html.includes('Net&lt;b&gt;flix') && !html.includes('<b>flix'));
  assert.ok(html.includes('>Stream<') && html.includes('>Rent<'));
  assert.ok(!html.includes('>Free<') && !html.includes('>Buy<'));
  assert.ok(html.includes('Svc4') && !html.includes('Svc5') && html.includes('+2 more'));
  assert.ok(html.includes('class="where__logo"') && html.includes('All options'));
});

test('buildProviders drops untrusted links and logos', () => {
  const html = pv.buildProviders({ country: 'IN', available: true, link: 'https://evil.example/x', stream: [{ id: 1, name: 'A', logo: 'https://evil.example/l.png' }], free: [], ads: [], rent: [], buy: [] });
  assert.ok(!html.includes('evil.example') && !html.includes('<img') && !html.includes('All options'));
});

test('buildProviders handles unavailable and missing data', () => {
  assert.match(pv.buildProviders({ country: 'IN', available: false }), /Not listed on streaming services in IN/);
  assert.match(pv.buildProviders(null), /Not listed/);
});

test('fetchProviders requests the endpoint once per title and country, and surfaces errors', async () => {
  const calls = [];
  const ok = async (url) => { calls.push(url); return { ok: true, json: async () => ({ country: 'IN', available: false }) }; };
  await pv.fetchProviders('movie', 123456, 'IN', ok);
  await pv.fetchProviders('movie', 123456, 'IN', ok);
  assert.deepEqual(calls, ['/api/providers/movie/123456?country=IN']);
  await assert.rejects(pv.fetchProviders('tv', 654321, 'IN', async () => ({ ok: false, json: async () => ({ error: 'TMDB down' }) })), /TMDB down/);
});

test('the attribution names JustWatch and links out safely', () => {
  assert.match(pv.ATTRIBUTION_HTML, /JustWatch/);
  assert.match(pv.ATTRIBUTION_HTML, /rel="noopener noreferrer"/);
});
