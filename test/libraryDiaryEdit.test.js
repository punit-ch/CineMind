const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('../testing/loadEsm');
const core = loadEsm('library/libraryCore.js');

const NOW = new Date('2026-11-24T12:00:00');
const heat = { id: 11, mediaType: 'movie', title: 'Heat', releaseYear: '1995' };
let n = 0;
const log = (lib, entry, at = NOW) => core.logViewing(lib, heat, entry, { now: at, idFn: () => `e${++n}` });

test('editing changes only the given fields and keeps identity fields', () => {
  const { lib, entry } = log(core.emptyLibrary(), { watchedOn: '2026-11-20', rating: 8, review: 'Good', rewatch: false, extras: { mood: 'tense', where: 'home' } });
  const edited = core.updateDiaryEntry(lib, entry.id, { review: 'Great.', extras: { mood: 'excited' } }, { now: NOW });
  const e = edited.diary[0];
  assert.equal(e.id, entry.id);
  assert.equal(e.ref, 'movie:11');
  assert.equal(e.createdAt, entry.createdAt);
  assert.equal(e.watchedOn, '2026-11-20');
  assert.equal(e.rating, 80);
  assert.equal(e.review, 'Great.');
  assert.deepEqual([e.extras.mood, e.extras.where], ['excited', 'home']); // extras merge
});

test('editing validates the date and rating, and rejects unknown entries', () => {
  const { lib, entry } = log(core.emptyLibrary(), { watchedOn: '2026-11-20' });
  assert.throws(() => core.updateDiaryEntry(lib, entry.id, { watchedOn: '2027-06-01' }, { now: NOW }), /future/);
  assert.throws(() => core.updateDiaryEntry(lib, entry.id, { rating: 11 }, { now: NOW }), core.LibraryError);
  assert.throws(() => core.updateDiaryEntry(lib, 'nope', { review: 'x' }, { now: NOW }), /not found/);
});

test('an empty date keeps the current one', () => {
  const { lib, entry } = log(core.emptyLibrary(), { watchedOn: '2026-11-20' });
  assert.equal(core.updateDiaryEntry(lib, entry.id, { watchedOn: '' }, { now: NOW }).diary[0].watchedOn, '2026-11-20');
});

test('the rating can be cleared and text is cleaned and capped', () => {
  const { lib, entry } = log(core.emptyLibrary(), { rating: 7 });
  const edited = core.updateDiaryEntry(lib, entry.id, { rating: '', review: 'x'.repeat(9000), extras: { timeOfDay: 'noon' } }, { now: NOW });
  assert.equal(edited.diary[0].rating, null);
  assert.equal(edited.diary[0].review.length, 4000);
  assert.equal(edited.diary[0].extras.timeOfDay, '');
});

test('changing the rating of the latest entry updates the title rating and its history', () => {
  const { lib, entry } = log(core.emptyLibrary(), { watchedOn: '2026-11-20', rating: 6 });
  const edited = core.updateDiaryEntry(lib, entry.id, { rating: 9 }, { now: new Date('2026-11-25T10:00:00') });
  assert.equal(edited.items['movie:11'].rating, 90);
  assert.deepEqual(edited.items['movie:11'].ratingHistory.map((h) => h.rating), [60, 90]);
});

test('changing the rating of an older entry leaves the title rating alone', () => {
  let { lib, entry: first } = log(core.emptyLibrary(), { watchedOn: '2026-10-01', rating: 6 });
  ({ lib } = log(lib, { watchedOn: '2026-11-20', rating: 8 }));
  const edited = core.updateDiaryEntry(lib, first.id, { rating: 3 }, { now: NOW });
  assert.equal(edited.items['movie:11'].rating, 80);
  assert.equal(edited.diary.find((e) => e.id === first.id).rating, 30);
});

test('moving an entry to a later date does not by itself change the title rating', () => {
  let { lib, entry: first } = log(core.emptyLibrary(), { watchedOn: '2026-10-01', rating: 6 });
  ({ lib } = log(lib, { watchedOn: '2026-11-20', rating: 8 }));
  const edited = core.updateDiaryEntry(lib, first.id, { watchedOn: '2026-11-24' }, { now: NOW });
  assert.equal(edited.items['movie:11'].rating, 80);
});

test('editing never mutates the input and returns a library that survives export and import', () => {
  const { lib, entry } = log(core.emptyLibrary(), { rating: 7, review: 'ok' });
  const before = JSON.stringify(lib);
  const edited = core.updateDiaryEntry(lib, entry.id, { review: 'better', rewatch: true }, { now: NOW });
  assert.equal(JSON.stringify(lib), before);
  const { library, dropped } = core.parseImport(core.exportLibrary(edited, NOW));
  assert.equal(dropped, 0);
  assert.deepEqual(library, edited);
});
