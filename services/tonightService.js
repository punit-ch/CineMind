// services/tonightService.js — "What should I watch tonight?"
//
// Pipeline (grounded: the AI can only choose real titles):
//   1. candidates come from TMDB, filtered in code (mood -> genres, time available, type)
//   2. the AI re-ranks and explains, choosing only from that list
//   3. every pick is validated against the list; if the AI fails (quota, bad JSON) we fall back
//      to a code-ranked list, so the feature keeps working without AI.
const tmdbService = require('./tmdbService');
const geminiService = require('./geminiService');
const { cleanText } = require('../utils/validate');

const MAX_CANDIDATES = 24;
const PICK_COUNT = 3;

// Mood keywords -> genre names (movie genre names; TV ids are translated below)
const MOOD_GENRES = [
  { match: /cozy|comfort|warm|wholesome|feel.?good|easy|chill|relax/i, genres: ['Comedy', 'Family', 'Romance', 'Animation'] },
  { match: /funny|laugh|light|silly|hilarious/i, genres: ['Comedy'] },
  { match: /tense|thrill|edge|gripping|suspense|intense/i, genres: ['Thriller', 'Crime', 'Mystery'] },
  { match: /scar|spook|horror|creepy|fright/i, genres: ['Horror', 'Thriller'] },
  { match: /sad|cry|emotional|devastat|heartbreak|moving/i, genres: ['Drama', 'Romance'] },
  { match: /romantic|romance|date night|love/i, genres: ['Romance', 'Comedy'] },
  { match: /adventur|epic|excit|action|adrenaline/i, genres: ['Adventure', 'Action', 'Fantasy', 'Sci-Fi'] },
  { match: /mind.?bend|smart|think|puzzle|twisty|clever/i, genres: ['Sci-Fi', 'Mystery', 'Thriller'] },
  { match: /inspir|uplift|hopeful|motivat/i, genres: ['Drama', 'Family', 'Documentary'] },
  { match: /true story|real|learn|docu/i, genres: ['Documentary', 'History'] },
];

const moodGenres = (mood) => {
  const text = cleanText(mood, 60);
  const names = new Set();
  for (const rule of MOOD_GENRES) {
    if (rule.match.test(text)) rule.genres.forEach((g) => names.add(g));
  }
  return [...names];
};

const invert = (map) =>
  Object.fromEntries(Object.entries(map).map(([id, name]) => [name.toLowerCase(), Number(id)]));
const MOVIE_IDS = invert(tmdbService.GENRE_MAP);
const TV_IDS = invert(tmdbService.TV_GENRE_MAP);

// Movie-style genre names -> TMDB genre ids for the given media type
const genreIdsFor = (mediaType, names) => {
  const ids = new Set();
  for (const raw of names) {
    const name = String(raw).toLowerCase();
    if (mediaType === 'tv') {
      if (name === 'action' || name === 'adventure') ids.add(10759);
      else if (name === 'sci-fi' || name === 'fantasy' || name === 'science fiction') ids.add(10765);
      else if (name === 'war') ids.add(10768);
      else if (TV_IDS[name]) ids.add(TV_IDS[name]);
    } else if (MOVIE_IDS[name]) {
      ids.add(MOVIE_IDS[name]);
    }
  }
  return [...ids];
};

const refOf = (item) => `${item.mediaType || 'movie'}:${item.id}`;

// Take items alternately from each list so 'either' gives a real mix
const interleave = (lists) => {
  const out = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) lists.forEach((l) => l[i] && out.push(l[i]));
  return out;
};

async function buildCandidates({ type = 'movie', genres = [], mood, minutes, page = 1, exclude = [] }) {
  const names = [...new Set([...genres, ...moodGenres(mood)])];
  const types = type === 'either' ? ['movie', 'tv'] : [type];
  const skip = new Set(exclude);

  const fetchAll = (useGenres) =>
    Promise.all(
      types.map((t) =>
        tmdbService.discoverCandidates({
          mediaType: t,
          genreIds: useGenres ? genreIdsFor(t, names) : [],
          maxRuntime: minutes,
          page,
        })
      )
    );

  let lists = await fetchAll(true);
  let merged = interleave(lists).filter((c) => !skip.has(refOf(c)));
  // Filters too narrow? Broaden to popular titles and let the AI handle the mood.
  if (merged.length < PICK_COUNT && names.length) {
    lists = await fetchAll(false);
    merged = interleave(lists).filter((c) => !skip.has(refOf(c)));
  }
  return merged.slice(0, MAX_CANDIDATES);
}

// Code-only ranking: audience rating weighted by how many people voted
const score = (c) => (c.rating || 0) * Math.log10((c.voteCount || 0) + 10);
const fallbackRank = (candidates) => [...candidates].sort((a, b) => score(b) - score(a));

// Keep only picks whose ref is in the candidate list, once each
const validatePicks = (raw, candidates, count) => {
  const byRef = new Map(candidates.map((c) => [refOf(c), c]));
  const seen = new Set();
  const picks = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const ref = typeof p?.ref === 'string' ? p.ref.trim() : '';
    if (!byRef.has(ref) || seen.has(ref)) continue;
    seen.add(ref);
    picks.push({
      item: byRef.get(ref),
      reason: cleanText(p.reason, 300),
      tonightFit: cleanText(p.tonightFit, 60),
      source: 'ai',
    });
    if (picks.length === count) break;
  }
  return picks;
};

// Shape returned to clients: no overview (it can contain spoilers; use the details endpoints)
const present = ({ item, reason, tonightFit, source }) => {
  const { overview, ...safe } = item; // eslint-disable-line no-unused-vars
  return {
    ...safe,
    mediaType: item.mediaType || 'movie',
    reason: reason || 'A well-rated pick that matches your filters.',
    tonightFit: tonightFit || '',
    source,
  };
};

async function recommendTonight(params = {}) {
  const candidates = await buildCandidates(params);
  if (!candidates.length) return { picks: [], source: 'none', candidatesConsidered: 0 };

  let picks = [];
  try {
    picks = validatePicks(
      await geminiService.pickFromCandidates({
        candidates,
        mood: params.mood,
        minutes: params.minutes,
        count: PICK_COUNT,
      }),
      candidates,
      PICK_COUNT
    );
  } catch (err) {
    console.warn(`[tonight] AI ranking failed (${err.message}); using the code-ranked fallback`);
  }

  // Top up (or fully replace) with the code-ranked list so the user always gets results
  if (picks.length < PICK_COUNT) {
    const taken = new Set(picks.map((p) => refOf(p.item)));
    for (const item of fallbackRank(candidates)) {
      if (picks.length === PICK_COUNT) break;
      if (!taken.has(refOf(item))) picks.push({ item, reason: '', tonightFit: '', source: 'fallback' });
    }
  }

  return {
    picks: picks.map(present),
    source: picks.some((p) => p.source === 'ai') ? 'ai' : 'fallback',
    candidatesConsidered: candidates.length,
  };
}

module.exports = {
  recommendTonight,
  buildCandidates,
  validatePicks,
  fallbackRank,
  moodGenres,
  genreIdsFor,
  refOf,
};
