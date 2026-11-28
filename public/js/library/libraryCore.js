// public/js/library/libraryCore.js — Pure data logic for the personal library (no DOM, no imports).
//
// Schema v2 (stored in the browser, exported as JSON, designed to import into a database later; v1 files still import):
//   items:    { "movie:123": { ref, mediaType, id, title, year, poster, status, favorite, rating, ratingHistory, updatedAt } }
//   queue:    { movie: [{ ref, note, addedAt }], tv: [...] }     array order = rank
//   diary:    [{ id, ref, watchedOn, rating, review, rewatch, extras, createdAt }]
//   episodes: { "tv:7": { seasons: { "1": { count: 8 | null, watched: [1, 2, 3] } } } }   TV episode tracking
//   settings: { tvRatingDepth: 'show' | 'season' | 'episode' }
// Ratings are integer tenths (1..100 = 0.1..10.0). Every function returns a new library; nothing is mutated.

export const SCHEMA_VERSION = 2;
export const STATUSES = ['queued', 'watching', 'watched', 'paused', 'dropped'];
export const MEDIA_TYPES = ['movie', 'tv'];
export const TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'late night'];
export const TV_RATING_DEPTHS = ['show', 'season', 'episode'];
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const LIMITS = { seasons: 100, episodes: 1000, title: 200, review: 4000, note: 1000, short: 80, mood: 40, items: 5000, diary: 20000, queue: 2000, history: 50 };

export class LibraryError extends Error {}

export const emptyLibrary = () => ({
  version: SCHEMA_VERSION,
  items: {},
  queue: { movie: [], tv: [] },
  diary: [],
  episodes: {},
  settings: { tvRatingDepth: 'show' },
});

// ── Small helpers ─────────────────────────────────────────────────────────────
const clean = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const cleanMultiline = (value, max) =>
  String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

const iso = (now) => new Date(now).toISOString();

export const localDate = (now = new Date()) => {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// 'YYYY-MM-DD', a real calendar date, not before cinema existed, not later than tomorrow (timezone slack)
function normalizeDate(value, now) {
  const text = value === undefined || value === null || value === '' ? localDate(now) : String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) throw new LibraryError('Date must look like 2026-11-24');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    throw new LibraryError('That date does not exist');
  }
  if (y < 1888) throw new LibraryError('Date is too early');
  const tomorrow = new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000);
  if (text > localDate(tomorrow)) throw new LibraryError('Date is in the future');
  return text;
}

export const makeRef = (mediaType, id) => `${mediaType}:${id}`;

export function parseRef(ref) {
  const m = /^(movie|tv):(\d{1,12})$/.exec(String(ref));
  return m ? { mediaType: m[1], id: Number(m[2]) } : null;
}

// ── Ratings ───────────────────────────────────────────────────────────────────
// 7.3 -> 73. Empty means "no rating" (null). Out-of-range or non-numeric input throws.
export function toTenths(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0.1 || n > 10) throw new LibraryError('Rating must be between 0.1 and 10');
  return Math.round(n * 10);
}

export const formatRating = (tenths) =>
  Number.isInteger(tenths) && tenths >= 1 && tenths <= 100 ? (tenths / 10).toFixed(1) : '';

const validTenths = (v) => (Number.isInteger(v) && v >= 1 && v <= 100 ? v : null);

// ── Titles and items ──────────────────────────────────────────────────────────
export function sanitizeTitle(raw) {
  const mediaType = raw?.mediaType === 'tv' ? 'tv' : raw?.mediaType === 'movie' ? 'movie' : null;
  const id = Number(raw?.id);
  if (!mediaType || !Number.isInteger(id) || id <= 0) throw new LibraryError('Invalid title');
  const title = clean(raw.title, LIMITS.title);
  if (!title) throw new LibraryError('Title is missing a name');
  const yearRaw = String(raw.releaseYear ?? raw.year ?? '');
  const poster = /^https:\/\/image\.tmdb\.org\//.test(String(raw.poster || '')) ? String(raw.poster).slice(0, 300) : null;
  return { ref: makeRef(mediaType, id), mediaType, id, title, year: /^\d{4}$/.test(yearRaw) ? yearRaw : '', poster };
}

const newItem = (info, now) => ({
  ...info, status: null, favorite: false, rating: null, ratingHistory: [], updatedAt: iso(now),
});

// Returns a library that contains the item (creating it if needed), plus the item itself
function ensureItem(lib, info, now) {
  const existing = lib.items[info.ref];
  if (existing) return [lib, existing];
  if (Object.keys(lib.items).length >= LIMITS.items) throw new LibraryError('Library is full');
  const item = newItem(info, now);
  return [{ ...lib, items: { ...lib.items, [info.ref]: item } }, item];
}

const patchItem = (lib, ref, patch, now) => ({
  ...lib,
  items: { ...lib.items, [ref]: { ...lib.items[ref], ...patch, updatedAt: iso(now) } },
});

// ── Queue ─────────────────────────────────────────────────────────────────────
export function addToQueue(lib, rawTitle, { note = '', atTop = false, now = new Date() } = {}) {
  const info = sanitizeTitle(rawTitle);
  const list = lib.queue[info.mediaType];
  if (list.some((q) => q.ref === info.ref)) return lib; // already queued
  if (list.length >= LIMITS.queue) throw new LibraryError('Queue is full');
  let next;
  [next] = ensureItem(lib, info, now);
  if (!next.items[info.ref].status) next = patchItem(next, info.ref, { status: 'queued' }, now);
  const entry = { ref: info.ref, note: clean(note, LIMITS.note), addedAt: iso(now) };
  return { ...next, queue: { ...next.queue, [info.mediaType]: atTop ? [entry, ...list] : [...list, entry] } };
}

export function removeFromQueue(lib, ref, now = new Date()) {
  const parsed = parseRef(ref);
  if (!parsed) return lib;
  const list = lib.queue[parsed.mediaType];
  if (!list.some((q) => q.ref === ref)) return lib;
  let next = { ...lib, queue: { ...lib.queue, [parsed.mediaType]: list.filter((q) => q.ref !== ref) } };
  if (next.items[ref]?.status === 'queued') next = patchItem(next, ref, { status: null }, now);
  return next;
}

// Move a queue entry to a new position (0 = top). Out-of-range positions are clamped.
export function moveInQueue(lib, mediaType, ref, toIndex) {
  const list = lib.queue[mediaType];
  const from = list.findIndex((q) => q.ref === ref);
  if (from === -1) return lib;
  const to = Math.min(Math.max(Math.trunc(Number(toIndex)) || 0, 0), list.length - 1);
  if (to === from) return lib;
  const copy = [...list];
  const [entry] = copy.splice(from, 1);
  copy.splice(to, 0, entry);
  return { ...lib, queue: { ...lib.queue, [mediaType]: copy } };
}

export function setQueueNote(lib, ref, note) {
  const parsed = parseRef(ref);
  if (!parsed) return lib;
  return {
    ...lib,
    queue: { ...lib.queue, [parsed.mediaType]: lib.queue[parsed.mediaType].map((q) => (q.ref === ref ? { ...q, note: clean(note, LIMITS.note) } : q)) },
  };
}

export function getQueue(lib, mediaType) {
  return lib.queue[mediaType].map((q) => ({ ...q, item: lib.items[q.ref] })).filter((q) => q.item);
}

// ── Status, favorite, rating ──────────────────────────────────────────────────
export function setStatus(lib, ref, status, now = new Date()) {
  if (!lib.items[ref]) throw new LibraryError('Title is not in your library');
  if (!STATUSES.includes(status)) throw new LibraryError('Unknown status');
  return patchItem(lib, ref, { status }, now);
}

export function setFavorite(lib, ref, value, now = new Date()) {
  if (!lib.items[ref]) throw new LibraryError('Title is not in your library');
  return patchItem(lib, ref, { favorite: Boolean(value) }, now);
}

// Current rating for a title; changes are kept in a short history (for "taste evolution" later)
// reason: 'manual' (user changed rating directly) | 'diary-edit' (rating updated via diary entry edit) | 'log-viewing' (rating set when logging a viewing)
export function rateTitle(lib, ref, tenths, { now = new Date(), reason = 'manual' } = {}) {
  const item = lib.items[ref];
  if (!item) throw new LibraryError('Title is not in your library');
  const value = tenths === null ? null : validTenths(tenths);
  if (tenths !== null && value === null) throw new LibraryError('Rating must be between 0.1 and 10');
  if (item.rating === value) return lib;
  const history = [...item.ratingHistory, { rating: value, at: iso(now), reason }].slice(-LIMITS.history);
  return patchItem(lib, ref, { rating: value, ratingHistory: history }, now);
}

// ── Diary ─────────────────────────────────────────────────────────────────────
const defaultId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const suggestRewatch = (lib, ref) => lib.diary.some((e) => e.ref === ref);

function cleanExtras(extras = {}) {
  return {
    notes: cleanMultiline(extras.notes, LIMITS.note),
    withWhom: clean(extras.withWhom, LIMITS.short),
    where: clean(extras.where, LIMITS.short),
    mood: clean(extras.mood, LIMITS.mood),
    timeOfDay: TIMES_OF_DAY.includes(extras.timeOfDay) ? extras.timeOfDay : '',
  };
}

// Log a viewing. Also updates the title's status, leaves the queue, and sets the current rating if given.
export function logViewing(lib, rawTitle, entry = {}, { now = new Date(), idFn = defaultId } = {}) {
  const info = sanitizeTitle(rawTitle);
  if (lib.diary.length >= LIMITS.diary) throw new LibraryError('Diary is full');
  const watchedOn = normalizeDate(entry.watchedOn, now);
  const rating = toTenths(entry.rating);

  let [next, item] = ensureItem(lib, info, now);
  const status = info.mediaType === 'movie' ? 'watched' : item.status === 'watched' ? 'watched' : 'watching';
  next = patchItem(next, info.ref, { status }, now);
  next = removeFromQueue(next, info.ref, now);
  if (rating !== null) next = rateTitle(next, info.ref, rating, { now, reason: 'log-viewing' });

  const record = {
    id: clean(idFn(), 40),
    ref: info.ref,
    watchedOn,
    rating,
    review: cleanMultiline(entry.review, LIMITS.review),
    rewatch: Boolean(entry.rewatch),
    extras: cleanExtras(entry.extras),
    createdAt: iso(now),
  };
  return { lib: { ...next, diary: [...next.diary, record] }, entry: record };
}

// Edit a diary entry (only the fields given change). If it is the latest entry for its title and the rating changed,
// the title's current rating follows it.
export function updateDiaryEntry(lib, id, changes = {}, { now = new Date() } = {}) {
  const current = lib.diary.find((e) => e.id === id);
  if (!current) throw new LibraryError('Diary entry not found');
  const has = (key) => Object.prototype.hasOwnProperty.call(changes, key);
  const record = {
    ...current,
    watchedOn: normalizeDate(changes.watchedOn || current.watchedOn, now),
    rating: has('rating') ? toTenths(changes.rating) : current.rating,
    review: has('review') ? cleanMultiline(changes.review, LIMITS.review) : current.review,
    rewatch: has('rewatch') ? Boolean(changes.rewatch) : current.rewatch,
    extras: has('extras') ? cleanExtras({ ...current.extras, ...changes.extras }) : current.extras,
  };
  let next = { ...lib, diary: lib.diary.map((e) => (e.id === id ? record : e)) };
  const sameTitle = next.diary.filter((e) => e.ref === record.ref);
  const latest = sameTitle.reduce((a, b) => (b.watchedOn > a.watchedOn || (b.watchedOn === a.watchedOn && b.createdAt > a.createdAt) ? b : a));
  if (latest.id === id && record.rating !== current.rating && next.items[record.ref]) {
    next = rateTitle(next, record.ref, record.rating, { now, reason: 'diary-edit' });
  }
  return next;
}

export const deleteDiaryEntry = (lib, id) => ({ ...lib, diary: lib.diary.filter((e) => e.id !== id) });

// Newest first, grouped by month ("2026-11"), each entry carrying its title info
export function diaryByMonth(lib) {
  const sorted = [...lib.diary].sort((a, b) =>
    a.watchedOn === b.watchedOn ? (a.createdAt < b.createdAt ? 1 : -1) : a.watchedOn < b.watchedOn ? 1 : -1
  );
  const groups = [];
  for (const entry of sorted) {
    const month = entry.watchedOn.slice(0, 7);
    let group = groups[groups.length - 1];
    if (!group || group.month !== month) {
      group = { month, entries: [] };
      groups.push(group);
    }
    group.entries.push({ ...entry, item: lib.items[entry.ref] });
  }
  return groups;
}

// ── TV episodes ───────────────────────────────────────────────────────────────
// Season 0 (specials) is not tracked. A season's `count` is null until the show's details have been fetched.
const intIn = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

function checkEpisode(season, episode) {
  if (intIn(season, 1, LIMITS.seasons) === null) throw new LibraryError('Season number is out of range');
  if (intIn(episode, 1, LIMITS.episodes) === null) throw new LibraryError('Episode number is out of range');
}

const showOf = (lib, ref) => lib.episodes?.[ref] || { seasons: {} };
const sortedUnique = (list) => [...new Set(list)].sort((a, b) => a - b);

// Record known episode counts from TMDB's season list ([{ seasonNumber, episodeCount }])
function mergeCounts(show, seasons = []) {
  const out = { seasons: { ...show.seasons } };
  for (const s of seasons) {
    const n = intIn(Number(s?.seasonNumber), 1, LIMITS.seasons);
    const count = intIn(Number(s?.episodeCount), 1, LIMITS.episodes);
    if (n === null || count === null) continue;
    const current = out.seasons[n] || { count: null, watched: [] };
    out.seasons[n] = { count, watched: current.watched.filter((e) => e <= count) };
  }
  return out;
}

export function showProgress(lib, ref) {
  const show = showOf(lib, ref);
  const numbers = Object.keys(show.seasons).map(Number).sort((a, b) => a - b);
  let watched = 0;
  let total = 0;
  let totalKnown = numbers.length > 0;
  let next = null;
  for (const n of numbers) {
    const s = show.seasons[n];
    watched += s.watched.length;
    if (s.count === null) totalKnown = false;
    else total += s.count;
    if (!next) {
      if (s.count !== null) {
        for (let e = 1; e <= s.count; e++) {
          if (!s.watched.includes(e)) {
            next = { season: n, episode: e };
            break;
          }
        }
      } else if (s.watched.length) {
        next = { season: n, episode: Math.max(...s.watched) + 1 };
      }
    }
  }
  return { watched, total: totalKnown ? total : null, next };
}

export const seasonProgress = (lib, ref, season) => {
  const s = showOf(lib, ref).seasons[season];
  return { watched: s ? s.watched.length : 0, count: s ? s.count : null };
};

// Keep the show's status consistent with its episodes; the first watched episode takes it out of the queue
function reconcileShow(lib, ref, now) {
  const progress = showProgress(lib, ref);
  const status = lib.items[ref].status;
  let next = lib;
  if (progress.watched === 0) return next;
  const done = progress.total !== null && progress.watched >= progress.total;
  const wanted = done ? 'watched' : 'watching';
  if (status !== wanted) next = patchItem(next, ref, { status: wanted }, now);
  return removeFromQueue(next, ref, now);
}

function tvInfo(rawTitle) {
  const info = sanitizeTitle(rawTitle);
  if (info.mediaType !== 'tv') throw new LibraryError('Episodes can only be tracked for TV shows');
  return info;
}

export function toggleEpisode(lib, rawTitle, season, episode, watched, { seasons, now = new Date() } = {}) {
  checkEpisode(season, episode);
  const info = tvInfo(rawTitle);
  let [next] = ensureItem(lib, info, now);
  const show = mergeCounts(showOf(next, info.ref), seasons);
  const current = show.seasons[season] || { count: null, watched: [] };
  // Validate against known episode count; if unknown, enforce a reasonable absolute ceiling
  // to prevent direct API calls from marking absurd episode numbers (e.g., episode 999 for a 10-ep season)
  const maxKnown = current.count ?? LIMITS.episodes;
  if (episode > maxKnown) throw new LibraryError('That season has fewer episodes');
  const list = watched ? sortedUnique([...current.watched, episode]) : current.watched.filter((e) => e !== episode);
  next = { ...next, episodes: { ...next.episodes, [info.ref]: { seasons: { ...show.seasons, [season]: { count: current.count, watched: list } } } } };
  return reconcileShow(next, info.ref, now);
}

// "I've watched everything up to here": all earlier seasons (when their size is known) and this season up to `episode`
export function markUpTo(lib, rawTitle, season, episode, { seasons, now = new Date() } = {}) {
  checkEpisode(season, episode);
  const info = tvInfo(rawTitle);
  let [next] = ensureItem(lib, info, now);
  const show = mergeCounts(showOf(next, info.ref), seasons);
  const out = { seasons: { ...show.seasons } };
  for (const key of Object.keys(out.seasons).map(Number)) {
    const s = out.seasons[key];
    if (key < season && s.count !== null) out.seasons[key] = { count: s.count, watched: Array.from({ length: s.count }, (_, i) => i + 1) };
  }
  const here = out.seasons[season] || { count: null, watched: [] };
  // Validate against known episode count; if unknown, enforce a reasonable absolute ceiling
  const maxKnown = here.count ?? LIMITS.episodes;
  if (episode > maxKnown) throw new LibraryError('That season has fewer episodes');
  out.seasons[season] = { count: here.count, watched: sortedUnique([...here.watched, ...Array.from({ length: episode }, (_, i) => i + 1)]) };
  next = { ...next, episodes: { ...next.episodes, [info.ref]: out } };
  return reconcileShow(next, info.ref, now);
}

// Refresh known episode counts for a show that is already in the library (no-op otherwise)
export function setSeasonInfo(lib, ref, seasons) {
  if (!lib.items[ref] || lib.items[ref].mediaType !== 'tv') return lib;
  const before = showOf(lib, ref);
  const after = mergeCounts(before, seasons);
  if (JSON.stringify(before) === JSON.stringify(after)) return lib;
  return { ...lib, episodes: { ...lib.episodes, [ref]: after } };
}

// Shows currently being watched, with progress
export function watchingShows(lib) {
  return Object.values(lib.items)
    .filter((i) => i.mediaType === 'tv' && i.status === 'watching')
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((item) => ({ item, progress: showProgress(lib, item.ref) }));
}

// ── Stats ─────────────────────────────────────────────────────────────────────
export function stats(lib, now = new Date()) {
  const items = Object.values(lib.items);
  const rated = items.filter((i) => i.rating !== null);
  const distribution = Array(10).fill(0);
  for (const i of rated) distribution[Math.ceil(i.rating / 10) - 1] += 1;
  const year = String(new Date(now).getFullYear());
  return {
    watched: items.filter((i) => i.status === 'watched').length,
    rated: rated.length,
    averageRating: rated.length ? Math.round(rated.reduce((s, i) => s + i.rating, 0) / rated.length) / 10 : null,
    distribution, // index 0 = ratings in (0, 1.0], index 9 = (9.0, 10.0]
    favorites: items.filter((i) => i.favorite).length,
    episodesWatched: Object.values(lib.episodes || {}).reduce((n, show) => n + Object.values(show.seasons).reduce((m, s) => m + s.watched.length, 0), 0),
    totalLogs: lib.diary.length,
    logsThisYear: lib.diary.filter((e) => e.watchedOn.startsWith(year)).length,
    queueSizes: { movie: lib.queue.movie.length, tv: lib.queue.tv.length },
  };
}

// ── Export / import ───────────────────────────────────────────────────────────
export function exportLibrary(lib, now = new Date()) {
  return JSON.stringify({ app: 'cinemind', exportedAt: iso(now), ...lib }, null, 2);
}

const validIso = (v) => (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

// Strictly validates an export file. Anything invalid is dropped (and counted), never trusted.
export function parseImport(text) {
  if (typeof text !== 'string') throw new LibraryError('No file content');
  if (text.length > MAX_IMPORT_BYTES) throw new LibraryError('That file is too large');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LibraryError('That file is not valid JSON');
  }
  if (!data || typeof data !== 'object' || data.app !== 'cinemind') throw new LibraryError('This does not look like a Cinemind export');
  if (!Number.isInteger(data.version) || data.version < 1 || data.version > SCHEMA_VERSION) throw new LibraryError('Unsupported export version');

  const lib = emptyLibrary();
  let dropped = 0;
  const fallbackDate = new Date();

  for (const [ref, raw] of Object.entries(data.items && typeof data.items === 'object' ? data.items : {}).slice(0, LIMITS.items)) {
    try {
      const info = sanitizeTitle(raw);
      if (info.ref !== ref) throw new LibraryError('ref mismatch');
      const history = (Array.isArray(raw.ratingHistory) ? raw.ratingHistory : [])
        .map((h) => ({ rating: h?.rating === null ? null : validTenths(h?.rating), at: validIso(h?.at), reason: typeof h?.reason === 'string' ? h.reason : 'manual' }))
        .filter((h) => h.at)
        .slice(-LIMITS.history);
      lib.items[ref] = {
        ...info,
        status: STATUSES.includes(raw.status) ? raw.status : null,
        favorite: raw.favorite === true,
        rating: validTenths(raw.rating),
        ratingHistory: history,
        updatedAt: validIso(raw.updatedAt) || iso(fallbackDate),
      };
    } catch {
      dropped += 1;
    }
  }

  for (const type of MEDIA_TYPES) {
    const seen = new Set();
    for (const q of (Array.isArray(data.queue?.[type]) ? data.queue[type] : []).slice(0, LIMITS.queue)) {
      const ref = q?.ref;
      if (typeof ref !== 'string' || !lib.items[ref] || parseRef(ref)?.mediaType !== type || seen.has(ref)) {
        dropped += 1;
        continue;
      }
      seen.add(ref);
      lib.queue[type].push({ ref, note: clean(q.note, LIMITS.note), addedAt: validIso(q.addedAt) || iso(fallbackDate) });
    }
  }

  const ids = new Set();
  for (const e of (Array.isArray(data.diary) ? data.diary : []).slice(0, LIMITS.diary)) {
    try {
      const id = clean(e?.id, 40);
      if (!id || ids.has(id) || !lib.items[e.ref]) throw new LibraryError('bad entry');
      ids.add(id);
      lib.diary.push({
        id,
        ref: e.ref,
        watchedOn: normalizeDate(e.watchedOn, fallbackDate),
        rating: validTenths(e.rating),
        review: cleanMultiline(e.review, LIMITS.review),
        rewatch: e.rewatch === true,
        extras: cleanExtras(e.extras),
        createdAt: validIso(e.createdAt) || iso(fallbackDate),
      });
    } catch {
      dropped += 1;
    }
  }

  for (const [ref, raw] of Object.entries(data.episodes && typeof data.episodes === 'object' ? data.episodes : {}).slice(0, LIMITS.items)) {
    if (!lib.items[ref] || lib.items[ref].mediaType !== 'tv' || !raw || typeof raw.seasons !== 'object' || raw.seasons === null) {
      dropped += 1;
      continue;
    }
    const seasons = {};
    for (const [key, s] of Object.entries(raw.seasons).slice(0, LIMITS.seasons)) {
      const n = intIn(Number(key), 1, LIMITS.seasons);
      if (n === null || !s || typeof s !== 'object') {
        dropped += 1;
        continue;
      }
      const count = intIn(s.count, 1, LIMITS.episodes);
      const watched = sortedUnique((Array.isArray(s.watched) ? s.watched : []).filter((e) => intIn(e, 1, count ?? LIMITS.episodes) !== null));
      seasons[n] = { count, watched };
    }
    lib.episodes[ref] = { seasons };
  }

  if (TV_RATING_DEPTHS.includes(data.settings?.tvRatingDepth)) lib.settings.tvRatingDepth = data.settings.tvRatingDepth;
  return { library: lib, dropped };
}

// Combine two libraries: the more recently updated copy of a title wins; queues keep your order, then
// add anything new; diary entries are united by id.
export function mergeLibraries(base, incoming) {
  const items = { ...base.items };
  for (const [ref, item] of Object.entries(incoming.items)) {
    if (!items[ref] || item.updatedAt > items[ref].updatedAt) items[ref] = item;
  }
  const queue = { movie: [...base.queue.movie], tv: [...base.queue.tv] };
  for (const type of MEDIA_TYPES) {
    const have = new Set(queue[type].map((q) => q.ref));
    for (const q of incoming.queue[type]) if (!have.has(q.ref) && items[q.ref]) queue[type].push(q);
  }
  const ids = new Set(base.diary.map((e) => e.id));
  const diary = [...base.diary, ...incoming.diary.filter((e) => !ids.has(e.id) && items[e.ref])];
  const episodes = { ...base.episodes };
  for (const [ref, show] of Object.entries(incoming.episodes || {})) {
    if (!items[ref]) continue;
    const mine = episodes[ref] || { seasons: {} };
    const seasons = { ...mine.seasons };
    for (const [n, s] of Object.entries(show.seasons)) {
      const have = seasons[n] || { count: null, watched: [] };
      seasons[n] = { count: have.count ?? s.count, watched: sortedUnique([...have.watched, ...s.watched]) };
    }
    episodes[ref] = { seasons };
  }
  return { ...base, items, queue, diary, episodes };
}
