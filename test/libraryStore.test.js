const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('../testing/loadEsm');
const core = loadEsm('library/libraryCore.js');
const { createLibraryStore, STORAGE_KEY } = loadEsm('library/store.js', core);

const NOW = new Date('2026-11-24T12:00:00');
const heat = { id: 11, mediaType: 'movie', title: 'Heat', releaseYear: '1995' };
const ronin = { id: 12, mediaType: 'movie', title: 'Ronin' };

const fakeStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};

test('a new store starts empty and does not write anything yet', () => {
  const storage = fakeStorage();
  const store = createLibraryStore(storage);
  assert.deepEqual(store.get(), core.emptyLibrary());
  assert.deepEqual(storage.data, {});
});

test('updates are saved and a new store reads them back', () => {
  const storage = fakeStorage();
  const a = createLibraryStore(storage);
  a.update((lib) => core.addToQueue(lib, heat, { now: NOW }));
  assert.ok(STORAGE_KEY in storage.data);
  const b = createLibraryStore(storage);
  assert.deepEqual(b.get().queue.movie.map((q) => q.ref), ['movie:11']);
});

test('update returns the function result, including extra fields', () => {
  const store = createLibraryStore(fakeStorage());
  const result = store.update((lib) => core.logViewing(lib, heat, {}, { now: NOW, idFn: () => 'e1' }));
  assert.equal(result.entry.id, 'e1');
  assert.equal(store.get().diary.length, 1);
});

test('if the update function throws, nothing changes or is saved', () => {
  const storage = fakeStorage();
  const store = createLibraryStore(storage);
  assert.throws(() => store.update((lib) => core.logViewing(lib, heat, { rating: 99 }, { now: NOW })), core.LibraryError);
  assert.deepEqual(store.get(), core.emptyLibrary());
  assert.deepEqual(storage.data, {});
});

test('listeners are notified, can unsubscribe, and one failing listener does not stop others', () => {
  const store = createLibraryStore(fakeStorage());
  const seen = [];
  store.subscribe(() => { throw new Error('bad listener'); });
  const off = store.subscribe((lib) => seen.push(lib.queue.movie.length));
  store.update((lib) => core.addToQueue(lib, heat, { now: NOW }));
  off();
  store.update((lib) => core.addToQueue(lib, ronin, { now: NOW }));
  assert.deepEqual(seen, [1]);
});

test('corrupt stored data is kept as a backup and the store starts fresh', () => {
  const storage = fakeStorage({ [STORAGE_KEY]: '{not json' });
  const store = createLibraryStore(storage);
  assert.deepEqual(store.get(), core.emptyLibrary());
  assert.equal(storage.data[`${STORAGE_KEY}_corrupt_backup`], '{not json');
  assert.equal(store.status().recoveredFromCorruption, true);
});

test('a save failure keeps the in-memory change and reports an error', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const store = createLibraryStore(storage);
  store.update((lib) => core.addToQueue(lib, heat, { now: NOW }));
  assert.equal(store.get().queue.movie.length, 1);
  assert.match(store.status().error, /Could not save/);
});

test('unavailable storage is reported and the store still works in memory', () => {
  const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const store = createLibraryStore(storage);
  assert.match(store.status().error, /unavailable/);
  store.update((lib) => core.addToQueue(lib, heat, { now: NOW }));
  assert.equal(store.get().queue.movie.length, 1);
});

test('merge and reset', () => {
  const store = createLibraryStore(fakeStorage());
  store.update((lib) => core.addToQueue(lib, heat, { now: NOW }));
  const incoming = core.addToQueue(core.emptyLibrary(), ronin, { now: NOW });
  store.merge(incoming);
  assert.deepEqual(store.get().queue.movie.map((q) => q.ref), ['movie:11', 'movie:12']);
  store.reset();
  assert.deepEqual(store.get(), core.emptyLibrary());
});
