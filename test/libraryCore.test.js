const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('../testing/loadEsm');
const core = loadEsm('library/libraryCore.js');

const NOW = new Date('2026-11-24T12:00:00');
const at = (iso) => new Date(iso);
const heat = { id: 11, mediaType: 'movie', title: 'Heat', releaseYear: '1995', poster: 'https://image.tmdb.org/t/p/w500/h.jpg' };
const ronin = { id: 12, mediaType: 'movie', title: 'Ronin', releaseYear: '1998' };
const wire = { id: 7, mediaType: 'tv', title: 'The Wire', releaseYear: '2002' };
let n = 0;
const idFn = () => `id${++n}`;

// ─── ratings ─────────────────────────────────────────────────────────────────
test('toTenths converts decimals to integer tenths and treats empty as no rating', () => {
  assert.equal(core.toTenths(7.3), 73);
  assert.equal(core.toTenths('7,5'), 75);
  assert.equal(core.toTenths('0.1'), 1);
  assert.equal(core.toTenths(10), 100);
  assert.equal(core.toTenths(''), null);
  assert.equal(core.toTenths(null), null);
});

test('toTenths rejects out-of-range and non-numeric values', () => {
  for (const bad of [0, -1, 10.1, 'abc', NaN, Infinity]) assert.throws(() => core.toTenths(bad), core.LibraryError);
});

test('formatRating', () => {
  assert.equal(core.formatRating(73), '7.3');
  assert.equal(core.formatRating(100), '10.0');
  assert.equal(core.formatRating(null), '');
  assert.equal(core.formatRating(0), '');
});

// ─── titles ──────────────────────────────────────────────────────────────────
test('sanitizeTitle builds a clean ref and drops untrusted posters', () => {
  const t = core.sanitizeTitle({ ...heat, title: ' Heat\n<b> ', poster: 'https://evil.example/x.jpg' });
  assert.equal(t.ref, 'movie:11');
  assert.equal(t.title, 'Heat <b>');
  assert.equal(t.poster, null);
  assert.equal(core.sanitizeTitle(heat).poster, heat.poster);
  assert.equal(core.sanitizeTitle({ ...heat, releaseYear: 'N/A' }).year, '');
});

test('sanitizeTitle rejects bad input', () => {
  for (const bad of [null, {}, { id: 1, title: 'x' }, { id: -1, mediaType: 'movie', title: 'x' }, { id: 1, mediaType: 'movie', title: '  ' }]) {
    assert.throws(() => core.sanitizeTitle(bad), core.LibraryError);
  }
});

// ─── queue ───────────────────────────────────────────────────────────────────
test('addToQueue adds to the right queue, sets status, and is idempotent', () => {
  let lib = core.addToQueue(core.emptyLibrary(), heat, { now: NOW });
  lib = core.addToQueue(lib, wire, { now: NOW });
  const again = core.addToQueue(lib, heat, { now: NOW });
  assert.equal(again, lib);
  assert.deepEqual(lib.queue.movie.map((q) => q.ref), ['movie:11']);
  assert.deepEqual(lib.queue.tv.map((q) => q.ref), ['tv:7']);
  assert.equal(lib.items['movie:11'].status, 'queued');
});

test('addToQueue can put a title at the top and keeps a note', () => {
  let lib = core.addToQueue(core.emptyLibrary(), heat, { now: NOW });
  lib = core.addToQueue(lib, ronin, { now: NOW, atTop: true, note: 'from a friend\n' });
  assert.deepEqual(lib.queue.movie.map((q) => q.ref), ['movie:12', 'movie:11']);
  assert.equal(lib.queue.movie[0].note, 'from a friend');
});

test('functions never mutate their input', () => {
  const lib = core.emptyLibrary();
  const frozen = JSON.stringify(lib);
  core.addToQueue(lib, heat, { now: NOW });
  core.logViewing(lib, heat, {}, { now: NOW, idFn });
  assert.equal(JSON.stringify(lib), frozen);
});

test('moveInQueue reorders and clamps the target position', () => {
  let lib = core.emptyLibrary();
  for (const t of [heat, ronin, { id: 13, mediaType: 'movie', title: 'Collateral' }]) lib = core.addToQueue(lib, t, { now: NOW });
  const refs = (l) => l.queue.movie.map((q) => q.ref);
  assert.deepEqual(refs(core.moveInQueue(lib, 'movie', 'movie:13', 0)), ['movie:13', 'movie:11', 'movie:12']);
  assert.deepEqual(refs(core.moveInQueue(lib, 'movie', 'movie:11', 99)), ['movie:12', 'movie:13', 'movie:11']);
  assert.deepEqual(refs(core.moveInQueue(lib, 'movie', 'movie:12', -5)), ['movie:12', 'movie:11', 'movie:13']);
  assert.equal(core.moveInQueue(lib, 'movie', 'movie:999', 0), lib);
});

test('removeFromQueue clears the queued status but keeps the item', () => {
  let lib = core.addToQueue(core.emptyLibrary(), heat, { now: NOW });
  lib = core.removeFromQueue(lib, 'movie:11', NOW);
  assert.equal(lib.queue.movie.length, 0);
  assert.equal(lib.items['movie:11'].status, null);
  assert.equal(core.removeFromQueue(lib, 'garbage'), lib);
});

test('getQueue returns entries with their items in order', () => {
  let lib = core.addToQueue(core.emptyLibrary(), heat, { now: NOW });
  lib = core.addToQueue(lib, ronin, { now: NOW });
  assert.deepEqual(core.getQueue(lib, 'movie').map((q) => q.item.title), ['Heat', 'Ronin']);
});

// ─── rating a title ──────────────────────────────────────────────────────────
test('rateTitle sets the rating and records a history only when it changes', () => {
  let lib = core.addToQueue(core.emptyLibrary(), heat, { now: NOW });
  lib = core.rateTitle(lib, 'movie:11', 85, NOW);
  const same = core.rateTitle(lib, 'movie:11', 85, NOW);
  assert.equal(same, lib);
  lib = core.rateTitle(lib, 'movie:11', 90, at('2026-12-01T10:00:00Z'));
  lib = core.rateTitle(lib, 'movie:11', null, at('2027-01-01T10:00:00Z'));
  assert.equal(lib.items['movie:11'].rating, null);
  assert.deepEqual(lib.items['movie:11'].ratingHistory.map((h) => h.rating), [85, 90, null]);
});

test('rateTitle validates the rating and the title', () => {
  const lib = core.addToQueue(core.emptyLibrary(), heat, { now: NOW });
  assert.throws(() => core.rateTitle(lib, 'movie:11', 101, NOW), core.LibraryError);
  assert.throws(() => core.rateTitle(lib, 'movie:11', 7.5, NOW), core.LibraryError); // must be integer tenths
  assert.throws(() => core.rateTitle(lib, 'movie:99', 50, NOW), core.LibraryError);
});

test('setStatus and setFavorite validate their input', () => {
  let lib = core.addToQueue(core.emptyLibrary(), heat, { now: NOW });
  lib = core.setStatus(lib, 'movie:11', 'dropped', NOW);
  lib = core.setFavorite(lib, 'movie:11', 1, NOW);
  assert.equal(lib.items['movie:11'].status, 'dropped');
  assert.equal(lib.items['movie:11'].favorite, true);
  assert.throws(() => core.setStatus(lib, 'movie:11', 'nope', NOW), core.LibraryError);
  assert.throws(() => core.setStatus(lib, 'movie:99', 'watched', NOW), core.LibraryError);
});

// ─── diary ───────────────────────────────────────────────────────────────────
test('logViewing records an entry, marks a movie watched, removes it from the queue and sets the rating', () => {
  let lib = core.addToQueue(core.emptyLibrary(), heat, { now: NOW });
  const { lib: next, entry } = core.logViewing(lib, heat, { watchedOn: '2026-11-20', rating: '8.5', review: 'Great.\r\nReally.', rewatch: true,
    extras: { notes: 'n', withWhom: 'friends', where: 'home', mood: 'cozy', timeOfDay: 'evening' } }, { now: NOW, idFn });
  assert.equal(next.queue.movie.length, 0);
  assert.equal(next.items['movie:11'].status, 'watched');
  assert.equal(next.items['movie:11'].rating, 85);
  assert.equal(entry.rating, 85);
  assert.equal(entry.review, 'Great.\nReally.');
  assert.equal(entry.rewatch, true);
  assert.equal(entry.extras.timeOfDay, 'evening');
  assert.equal(next.diary.length, 1);
});

test('logViewing defaults the date to today and works without a rating', () => {
  const { entry, lib } = core.logViewing(core.emptyLibrary(), ronin, {}, { now: NOW, idFn });
  assert.equal(entry.watchedOn, '2026-11-24');
  assert.equal(entry.rating, null);
  assert.equal(lib.items['movie:12'].rating, null);
});

test('logging a TV show marks it watching, not watched', () => {
  const { lib } = core.logViewing(core.emptyLibrary(), wire, {}, { now: NOW, idFn });
  assert.equal(lib.items['tv:7'].status, 'watching');
});

test('logViewing rejects bad dates and ratings', () => {
  const run = (entry) => core.logViewing(core.emptyLibrary(), heat, entry, { now: NOW, idFn });
  assert.throws(() => run({ watchedOn: '24/11/2026' }), core.LibraryError);
  assert.throws(() => run({ watchedOn: '2026-02-30' }), core.LibraryError);
  assert.throws(() => run({ watchedOn: '2027-01-01' }), /future/);
  assert.throws(() => run({ watchedOn: '1800-01-01' }), core.LibraryError);
  assert.throws(() => run({ rating: 11 }), core.LibraryError);
  assert.doesNotThrow(() => run({ watchedOn: '2026-11-25' })); // tomorrow is allowed (timezone slack)
});

test('unknown times of day are dropped and long text is capped', () => {
  const { entry } = core.logViewing(core.emptyLibrary(), heat, { review: 'x'.repeat(9000), extras: { timeOfDay: 'noon', mood: 'm'.repeat(200) } }, { now: NOW, idFn });
  assert.equal(entry.extras.timeOfDay, '');
  assert.equal(entry.review.length, 4000);
  assert.equal(entry.extras.mood.length, 40);
});

test('suggestRewatch is true only after a previous log', () => {
  const empty = core.emptyLibrary();
  assert.equal(core.suggestRewatch(empty, 'movie:11'), false);
  const { lib } = core.logViewing(empty, heat, {}, { now: NOW, idFn });
  assert.equal(core.suggestRewatch(lib, 'movie:11'), true);
});

test('diaryByMonth groups newest first and attaches item info', () => {
  let lib = core.emptyLibrary();
  for (const [t, d] of [[heat, '2026-10-05'], [ronin, '2026-11-20'], [wire, '2026-11-02']]) {
    lib = core.logViewing(lib, t, { watchedOn: d }, { now: NOW, idFn }).lib;
  }
  const groups = core.diaryByMonth(lib);
  assert.deepEqual(groups.map((g) => g.month), ['2026-11', '2026-10']);
  assert.deepEqual(groups[0].entries.map((e) => e.item.title), ['Ronin', 'The Wire']);
});

test('deleteDiaryEntry removes only that entry', () => {
  let lib = core.logViewing(core.emptyLibrary(), heat, {}, { now: NOW, idFn: () => 'a' }).lib;
  lib = core.logViewing(lib, ronin, {}, { now: NOW, idFn: () => 'b' }).lib;
  assert.deepEqual(core.deleteDiaryEntry(lib, 'a').diary.map((e) => e.id), ['b']);
});

// ─── stats ───────────────────────────────────────────────────────────────────
test('stats summarises the library', () => {
  let lib = core.emptyLibrary();
  lib = core.logViewing(lib, heat, { rating: 8, watchedOn: '2026-03-01' }, { now: NOW, idFn }).lib;
  lib = core.logViewing(lib, ronin, { rating: 6.5, watchedOn: '2025-12-31' }, { now: NOW, idFn }).lib;
  lib = core.addToQueue(lib, wire, { now: NOW });
  lib = core.setFavorite(lib, 'movie:11', true, NOW);
  const s = core.stats(lib, NOW);
  assert.equal(s.watched, 2);
  assert.equal(s.rated, 2);
  assert.equal(s.averageRating, 7.3); // (80 + 65) / 2 = 72.5 -> 73 tenths
  assert.equal(s.distribution[7], 1); // 8.0 falls in (7.0, 8.0]
  assert.equal(s.distribution[6], 1); // 6.5 falls in (6.0, 7.0]
  assert.equal(s.favorites, 1);
  assert.equal(s.totalLogs, 2);
  assert.equal(s.logsThisYear, 1);
  assert.deepEqual(s.queueSizes, { movie: 0, tv: 1 });
});

test('stats on an empty library has no average', () => {
  const s = core.stats(core.emptyLibrary(), NOW);
  assert.equal(s.averageRating, null);
  assert.equal(s.watched, 0);
});

// ─── export / import ─────────────────────────────────────────────────────────
const sample = () => {
  let lib = core.addToQueue(core.emptyLibrary(), ronin, { now: NOW, note: 'soon' });
  lib = core.addToQueue(lib, wire, { now: NOW });
  lib = core.logViewing(lib, heat, { watchedOn: '2026-11-20', rating: 9, review: 'Loved it', extras: { mood: 'tense' } }, { now: NOW, idFn }).lib;
  return lib;
};

test('export then import round-trips the library exactly', () => {
  const lib = sample();
  const { library, dropped } = core.parseImport(core.exportLibrary(lib, NOW));
  assert.equal(dropped, 0);
  assert.deepEqual(library, lib);
});

test('parseImport rejects files that are not Cinemind exports', () => {
  assert.throws(() => core.parseImport('nope'), /not valid JSON/);
  assert.throws(() => core.parseImport('{"app":"other"}'), /does not look like/);
  assert.throws(() => core.parseImport('{"app":"cinemind","version":99}'), /version/);
  assert.throws(() => core.parseImport('x'.repeat(core.MAX_IMPORT_BYTES + 1)), /too large/);
  assert.throws(() => core.parseImport(null), core.LibraryError);
});

test('parseImport drops and counts invalid records instead of trusting them', () => {
  const data = JSON.parse(core.exportLibrary(sample(), NOW));
  data.items['movie:555'] = { id: 556, mediaType: 'movie', title: 'Ref mismatch' };      // ref/id mismatch
  data.items['movie:777'] = { id: 777, mediaType: 'movie', title: '' };                  // no title
  data.queue.movie.push({ ref: 'movie:999' });                                           // unknown title
  data.queue.tv.push({ ref: 'movie:12' });                                               // wrong queue
  data.diary.push({ id: 'x', ref: 'movie:11', watchedOn: '2099-01-01' });                // future date
  data.diary.push({ id: 'y', ref: 'movie:404', watchedOn: '2026-01-01' });               // unknown title
  data.items['movie:11'].poster = 'https://evil.example/p.jpg';
  data.items['movie:11'].rating = 500;
  data.items['movie:11'].status = 'hacked';
  const { library, dropped } = core.parseImport(JSON.stringify(data));
  assert.equal(dropped, 6);
  assert.equal(library.items['movie:11'].poster, null);
  assert.equal(library.items['movie:11'].rating, null);
  assert.equal(library.items['movie:11'].status, null);
  assert.equal(library.diary.length, 1);
});

test('parseImport ignores unknown fields and prototype pollution attempts', () => {
  // A raw "__proto__" key (JSON.parse makes it an ordinary own property)
  const base = core.exportLibrary(sample(), NOW);
  const json = base
    .replace('"items": {', '"items": {"__proto__": {"id": 1, "mediaType": "movie", "title": "x", "polluted": true}, ')
    .replace('"movie:11": {', '"movie:11": {"admin": true, ');
  const { library, dropped } = core.parseImport(json);
  assert.equal({}.polluted, undefined);
  assert.ok(dropped >= 1);
  assert.equal(Object.keys(library.items).includes('__proto__'), false);
  assert.equal('admin' in library.items['movie:11'], false);
});

test('mergeLibraries keeps the newer copy, preserves queue order and unites diaries', () => {
  const base = sample();
  const incoming = core.emptyLibrary();
  let inc = core.addToQueue(incoming, { id: 99, mediaType: 'movie', title: 'New One' }, { now: NOW });
  inc = core.addToQueue(inc, ronin, { now: NOW });
  inc = core.logViewing(inc, heat, { watchedOn: '2026-11-21' }, { now: NOW, idFn: () => 'other' }).lib;
  inc = { ...inc, items: { ...inc.items, 'movie:11': { ...inc.items['movie:11'], rating: 50, updatedAt: '2099-01-01T00:00:00.000Z' } } };
  const merged = core.mergeLibraries(base, inc);
  assert.deepEqual(merged.queue.movie.map((q) => q.ref), ['movie:12', 'movie:99']);
  assert.equal(merged.items['movie:11'].rating, 50); // incoming is newer
  assert.equal(merged.diary.length, 2);
  assert.equal(merged.queue.tv.length, 1);
});
