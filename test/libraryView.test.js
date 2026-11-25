const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadEsm } = require('../testing/loadEsm');

const core = loadEsm('library/libraryCore.js');
const ui = loadEsm('ui.js');
const view = loadEsm('library/libraryView.js', { esc: ui.esc, showToast() {}, getLibraryStore() {}, ...core });

const NOW = new Date('2026-11-24T12:00:00');
const poster = 'https://image.tmdb.org/t/p/w500/p.jpg';
const heat = { id: 11, mediaType: 'movie', title: 'Heat <i>', releaseYear: '1995', poster };

test('monthLabel formats a month', () => {
  assert.equal(view.monthLabel('2026-11', 'en-US'), 'November 2026');
  assert.equal(view.monthLabel('2026-01', 'en-US'), 'January 2026');
});

test('queue rows escape text, show the position and disable edge arrows', () => {
  let lib = core.addToQueue(core.emptyLibrary(), heat, { now: NOW, note: '<b>from a friend</b>' });
  lib = core.addToQueue(lib, { id: 12, mediaType: 'movie', title: 'Ronin' }, { now: NOW });
  const [first, second] = core.getQueue(lib, 'movie');
  const a = view.buildQueueRow(first, 0, 2);
  assert.ok(!a.includes('<i>') && a.includes('Heat &lt;i&gt;'));
  assert.ok(a.includes('&lt;b&gt;from a friend'));
  assert.ok(a.includes('data-ref="movie:11"') && a.includes('draggable="true"'));
  assert.match(a, /data-action="up"[^>]*disabled/);
  assert.doesNotMatch(a, /data-action="down"[^>]*disabled/);
  const b = view.buildQueueRow(second, 1, 2);
  assert.match(b, /data-action="down"[^>]*disabled/);
  assert.ok(a.includes('class="lib-thumb"') && b.includes('lib-thumb--empty'));
});

test('queue rows show the rating when there is one', () => {
  let lib = core.addToQueue(core.emptyLibrary(), heat, { now: NOW });
  lib = core.rateTitle(lib, 'movie:11', 87, NOW);
  assert.ok(view.buildQueueRow(core.getQueue(lib, 'movie')[0], 0, 1).includes('★ 8.7'));
});

test('diary entries show rating, rewatch, extras and private notes safely', () => {
  const { lib } = core.logViewing(core.emptyLibrary(), heat, {
    watchedOn: '2026-11-20', rating: 9, rewatch: true, review: '<script>x</script>',
    extras: { withWhom: 'friends', where: 'home', timeOfDay: 'evening', mood: 'tense', notes: 'a <b>note</b>' },
  }, { now: NOW, idFn: () => 'e1' });
  const entry = core.diaryByMonth(lib)[0].entries[0];
  const html = view.buildDiaryEntry(entry);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('★ 9.0') && html.includes('Rewatch'));
  assert.ok(html.includes('With friends · home · evening · Mood: tense'));
  assert.ok(html.includes('Private notes') && html.includes('a &lt;b&gt;note'));
  assert.ok(html.includes('data-id="e1"') && html.includes('>20<'));
});

test('a minimal diary entry has no empty extras sections', () => {
  const { lib } = core.logViewing(core.emptyLibrary(), { id: 1, mediaType: 'movie', title: 'A' }, {}, { now: NOW, idFn: () => 'e2' });
  const html = view.buildDiaryEntry(core.diaryByMonth(lib)[0].entries[0]);
  assert.ok(!html.includes('Private notes') && !html.includes('lib-review') && !html.includes('lib-badge'));
});

test('search results disable the queue button for titles already queued', () => {
  const info = core.sanitizeTitle(heat);
  assert.match(view.buildSearchResult(info, false), /data-action="queue" >\+ Queue/);
  assert.match(view.buildSearchResult(info, true), /data-action="queue" disabled>In queue/);
});

test('stats markup shows totals and scales the bars', () => {
  let lib = core.emptyLibrary();
  lib = core.logViewing(lib, heat, { rating: 8 }, { now: NOW, idFn: () => 'a' }).lib;
  lib = core.logViewing(lib, { id: 2, mediaType: 'movie', title: 'B' }, { rating: 8.5 }, { now: NOW, idFn: () => 'b' }).lib;
  const html = view.buildStats(core.stats(lib, NOW));
  assert.ok(html.includes('<strong>2</strong><span>watched</span>'));
  assert.ok(html.includes('8.3')); // (80 + 85) / 2 = 82.5 -> 83 tenths
  assert.ok(html.includes('height:100%'));
  assert.equal((html.match(/lib-bar__fill/g) || []).length, 10);
});

test('empty stats render without NaN', () => {
  const html = view.buildStats(core.stats(core.emptyLibrary(), NOW));
  assert.ok(!html.includes('NaN') && html.includes('<strong>–</strong>'));
});

// ─── TV markup ───────────────────────────────────────────────────────────────
const tvItem = { id: 7, mediaType: 'tv', title: 'The Wire', releaseYear: '2002', poster };

test('TV queue rows and TV search results have an Episodes button; movie ones do not', () => {
  const lib = core.addToQueue(core.emptyLibrary(), tvItem, { now: NOW });
  assert.ok(view.buildQueueRow(core.getQueue(lib, 'tv')[0], 0, 1).includes('data-action="episodes"'));
  assert.ok(view.buildSearchResult(core.sanitizeTitle(tvItem), false).includes('data-action="episodes"'));
  assert.ok(!view.buildSearchResult(core.sanitizeTitle(heat), false).includes('data-action="episodes"'));
});

test('progressText', () => {
  assert.equal(view.progressText({ watched: 0, total: 7, next: null }), 'Not started');
  assert.equal(view.progressText({ watched: 5, total: 7, next: { season: 2, episode: 3 } }), '5 of 7 watched · Next: S2E3');
  assert.equal(view.progressText({ watched: 2, total: null, next: { season: 1, episode: 3 } }), '2 watched · Next: S1E3');
  assert.equal(view.progressText({ watched: 7, total: 7, next: null }), '7 of 7 watched');
});

test('shelf rows show progress and an Episodes button', () => {
  const lib = core.markUpTo(core.emptyLibrary(), tvItem, 1, 2, { seasons: [{ seasonNumber: 1, episodeCount: 3 }], now: NOW });
  const html = view.buildShelfRow(core.watchingShows(lib)[0]);
  assert.ok(html.includes('2 of 3 watched · Next: S1E3') && html.includes('data-action="episodes"'));
});

const episode = { episodeNumber: 4, name: 'Secret <b>Twist</b> Title', overview: 'The hero dies.', airDate: '2002-07-07', runtime: 58 };

test('Spoiler Shield: an unwatched episode hides its title and summary', () => {
  const html = view.buildEpisodeRow(episode, {});
  assert.ok(!html.includes('Twist') && !html.includes('hero dies'));
  assert.ok(html.includes('Episode 4') && html.includes('2002-07-07 · 58 min'));
  assert.ok(html.includes('data-action="reveal-episode"'));
  assert.ok(!html.includes(' checked'));
});

test('Spoiler Shield: watched or revealed episodes show their title and summary, escaped', () => {
  for (const opts of [{ watched: true }, { revealed: true }]) {
    const html = view.buildEpisodeRow(episode, opts);
    assert.ok(html.includes('Secret &lt;b&gt;Twist&lt;/b&gt; Title') && html.includes('The hero dies.'));
    assert.ok(!html.includes('<b>Twist'));
    assert.ok(!html.includes('reveal-episode'));
  }
  assert.ok(view.buildEpisodeRow(episode, { watched: true }).includes(' checked'));
});

test('the next episode is marked', () => {
  const html = view.buildEpisodeRow(episode, { isNext: true });
  assert.ok(html.includes('Next up') && html.includes('lib-ep--next'));
});

// The element ids the script uses must exist in the markup that the patch inserts
const patchScript = path.join(__dirname, '..', 'scripts', 'apply_tonight_ui.py');
test('every element id used by the Library screen exists in the dashboard markup', { skip: !fs.existsSync(patchScript) }, () => {
  const script = fs.readFileSync(patchScript, 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'library', 'libraryView.js'), 'utf8');
  const root = new Set((source.match(/\$\('#(lib-[a-z-]+)'\)/g) || []).map((s) => s.slice(4, -2)));
  assert.ok(root.size >= 6);
  for (const id of root) assert.ok(script.includes(`id="${id}"`), `dashboard markup is missing #${id}`);
});
