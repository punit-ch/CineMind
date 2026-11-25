const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('../testing/loadEsm');
const core = loadEsm('library/libraryCore.js');

const NOW = new Date('2026-11-24T12:00:00');
const wire = { id: 7, mediaType: 'tv', title: 'The Wire', releaseYear: '2002', poster: 'https://image.tmdb.org/t/p/w500/w.jpg' };
const heat = { id: 11, mediaType: 'movie', title: 'Heat' };
const SEASONS = [{ seasonNumber: 1, episodeCount: 3 }, { seasonNumber: 2, episodeCount: 4 }];
const watched = (lib, ref, season) => lib.episodes[ref].seasons[season].watched;

test('marking an episode creates the show, sets it to watching and takes it out of the queue', () => {
  let lib = core.addToQueue(core.emptyLibrary(), wire, { now: NOW });
  lib = core.toggleEpisode(lib, wire, 1, 2, true, { now: NOW });
  assert.deepEqual(watched(lib, 'tv:7', 1), [2]);
  assert.equal(lib.items['tv:7'].status, 'watching');
  assert.equal(lib.queue.tv.length, 0);
});

test('episodes are kept sorted and unique, and can be unmarked', () => {
  let lib = core.emptyLibrary();
  for (const e of [3, 1, 3, 2]) lib = core.toggleEpisode(lib, wire, 1, e, true, { now: NOW });
  assert.deepEqual(watched(lib, 'tv:7', 1), [1, 2, 3]);
  lib = core.toggleEpisode(lib, wire, 1, 2, false, { now: NOW });
  assert.deepEqual(watched(lib, 'tv:7', 1), [1, 3]);
});

test('invalid seasons, episodes and non-TV titles are rejected', () => {
  const lib = core.emptyLibrary();
  assert.throws(() => core.toggleEpisode(lib, wire, 0, 1, true), core.LibraryError);
  assert.throws(() => core.toggleEpisode(lib, wire, 1, 0, true), core.LibraryError);
  assert.throws(() => core.toggleEpisode(lib, wire, 1.5, 1, true), core.LibraryError);
  assert.throws(() => core.toggleEpisode(lib, wire, 1, 5000, true), core.LibraryError);
  assert.throws(() => core.toggleEpisode(lib, heat, 1, 1, true), /TV shows/);
});

test('with known counts, a season cannot have more episodes than it has', () => {
  const lib = core.emptyLibrary();
  assert.throws(() => core.toggleEpisode(lib, wire, 1, 4, true, { seasons: SEASONS, now: NOW }), /fewer episodes/);
});

test('watching every known episode marks the show watched, and unmarking goes back to watching', () => {
  let lib = core.emptyLibrary();
  for (const [s, e] of [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3]]) lib = core.toggleEpisode(lib, wire, s, e, true, { seasons: SEASONS, now: NOW });
  assert.equal(lib.items['tv:7'].status, 'watching');
  lib = core.toggleEpisode(lib, wire, 2, 4, true, { seasons: SEASONS, now: NOW });
  assert.equal(lib.items['tv:7'].status, 'watched');
  lib = core.toggleEpisode(lib, wire, 2, 4, false, { seasons: SEASONS, now: NOW });
  assert.equal(lib.items['tv:7'].status, 'watching');
});

test('markUpTo fills earlier seasons and this season up to the episode', () => {
  const lib = core.markUpTo(core.emptyLibrary(), wire, 2, 2, { seasons: SEASONS, now: NOW });
  assert.deepEqual(watched(lib, 'tv:7', 1), [1, 2, 3]);
  assert.deepEqual(watched(lib, 'tv:7', 2), [1, 2]);
  const p = core.showProgress(lib, 'tv:7');
  assert.deepEqual(p, { watched: 5, total: 7, next: { season: 2, episode: 3 } });
});

test('markUpTo without known counts only fills the chosen season', () => {
  const lib = core.markUpTo(core.emptyLibrary(), wire, 3, 2, { now: NOW });
  assert.deepEqual(watched(lib, 'tv:7', 3), [1, 2]);
  assert.equal(lib.episodes['tv:7'].seasons[1], undefined);
  assert.equal(core.showProgress(lib, 'tv:7').total, null);
});

test('markUpTo keeps episodes already watched later in the season', () => {
  let lib = core.toggleEpisode(core.emptyLibrary(), wire, 1, 3, true, { seasons: SEASONS, now: NOW });
  lib = core.markUpTo(lib, wire, 1, 2, { seasons: SEASONS, now: NOW });
  assert.deepEqual(watched(lib, 'tv:7', 1), [1, 2, 3]);
});

test('showProgress finds the next unwatched episode, including gaps', () => {
  let lib = core.toggleEpisode(core.emptyLibrary(), wire, 1, 1, true, { seasons: SEASONS, now: NOW });
  lib = core.toggleEpisode(lib, wire, 1, 3, true, { seasons: SEASONS, now: NOW });
  assert.deepEqual(core.showProgress(lib, 'tv:7').next, { season: 1, episode: 2 });
  assert.deepEqual(core.seasonProgress(lib, 'tv:7', 1), { watched: 2, count: 3 });
  assert.deepEqual(core.seasonProgress(lib, 'tv:7', 9), { watched: 0, count: null });
});

test('with unknown counts the next episode is the one after the last watched', () => {
  let lib = core.toggleEpisode(core.emptyLibrary(), wire, 2, 1, true, { now: NOW });
  lib = core.toggleEpisode(lib, wire, 2, 2, true, { now: NOW });
  assert.deepEqual(core.showProgress(lib, 'tv:7').next, { season: 2, episode: 3 });
});

test('showProgress for an untracked show is empty', () => {
  assert.deepEqual(core.showProgress(core.emptyLibrary(), 'tv:1'), { watched: 0, total: null, next: null });
});

test('setSeasonInfo only touches shows already in the library and is a no-op when nothing changes', () => {
  const empty = core.emptyLibrary();
  assert.equal(core.setSeasonInfo(empty, 'tv:7', SEASONS), empty);
  let lib = core.toggleEpisode(empty, wire, 1, 1, true, { now: NOW });
  const updated = core.setSeasonInfo(lib, 'tv:7', SEASONS);
  assert.notEqual(updated, lib);
  assert.equal(updated.episodes['tv:7'].seasons[1].count, 3);
  assert.equal(core.setSeasonInfo(updated, 'tv:7', SEASONS), updated);
  assert.deepEqual(watched(updated, 'tv:7', 1), [1]);
});

test('a smaller episode count trims watched episodes beyond it', () => {
  let lib = core.markUpTo(core.emptyLibrary(), wire, 1, 5, { now: NOW });
  lib = core.setSeasonInfo(lib, 'tv:7', [{ seasonNumber: 1, episodeCount: 3 }]);
  assert.deepEqual(watched(lib, 'tv:7', 1), [1, 2, 3]);
});

test('watchingShows lists shows being watched, newest first, with progress', () => {
  let lib = core.toggleEpisode(core.emptyLibrary(), wire, 1, 1, true, { seasons: SEASONS, now: new Date('2026-11-01T10:00:00Z') });
  lib = core.toggleEpisode(lib, { id: 8, mediaType: 'tv', title: 'Severance' }, 1, 1, true, { now: new Date('2026-11-20T10:00:00Z') });
  lib = core.addToQueue(lib, { id: 9, mediaType: 'tv', title: 'Queued only' }, { now: NOW });
  const list = core.watchingShows(lib);
  assert.deepEqual(list.map((x) => x.item.title), ['Severance', 'The Wire']);
  assert.equal(list[1].progress.total, 7);
});

test('stats count watched episodes', () => {
  const lib = core.markUpTo(core.emptyLibrary(), wire, 2, 2, { seasons: SEASONS, now: NOW });
  assert.equal(core.stats(lib, NOW).episodesWatched, 5);
});

test('episode data round-trips through export and import', () => {
  const lib = core.markUpTo(core.emptyLibrary(), wire, 2, 2, { seasons: SEASONS, now: NOW });
  const { library, dropped } = core.parseImport(core.exportLibrary(lib, NOW));
  assert.equal(dropped, 0);
  assert.deepEqual(library, lib);
});

test('a v1 export (no episodes) still imports', () => {
  const v1 = JSON.stringify({ app: 'cinemind', version: 1, items: {}, queue: { movie: [], tv: [] }, diary: [], settings: { tvRatingDepth: 'show' } });
  const { library } = core.parseImport(v1);
  assert.deepEqual(library.episodes, {});
});

test('import drops invalid episode data instead of trusting it', () => {
  const data = JSON.parse(core.exportLibrary(core.markUpTo(core.emptyLibrary(), wire, 1, 2, { seasons: SEASONS, now: NOW }), NOW));
  data.episodes['movie:11'] = { seasons: { 1: { count: 3, watched: [1] } } };       // not a TV item
  data.episodes['tv:7'].seasons['0'] = { count: 5, watched: [1] };                   // specials are not tracked
  data.episodes['tv:7'].seasons['1'].watched = [1, 2, 3, 99, -1, 'x', 2];            // out of range / duplicate
  const { library, dropped } = core.parseImport(JSON.stringify(data));
  assert.ok(dropped >= 2);
  assert.deepEqual(library.episodes['tv:7'].seasons[1].watched, [1, 2, 3]);
  assert.equal(library.episodes['tv:7'].seasons[0], undefined);
  assert.equal(library.episodes['movie:11'], undefined);
});

test('merging unions watched episodes and keeps known counts', () => {
  const a = core.toggleEpisode(core.emptyLibrary(), wire, 1, 1, true, { now: NOW });
  const b = core.toggleEpisode(core.emptyLibrary(), wire, 1, 3, true, { seasons: SEASONS, now: NOW });
  const merged = core.mergeLibraries(a, b);
  assert.deepEqual(watched(merged, 'tv:7', 1), [1, 3]);
  assert.equal(merged.episodes['tv:7'].seasons[1].count, 3);
});
