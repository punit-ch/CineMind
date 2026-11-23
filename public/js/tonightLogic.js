// public/js/tonightLogic.js — Pure helpers for the Tonight screen (no DOM, no imports: easy to test)

export const TYPES = [
  { value: 'movie', label: 'Movie' },
  { value: 'tv', label: 'TV' },
  { value: 'either', label: 'Either' },
];

// Movies are filtered by total runtime; TV ignores the time limit
export const TIMES = [
  { label: 'Any length', minutes: null },
  { label: 'Up to 90 min', minutes: 90 },
  { label: 'Up to 2 hrs', minutes: 120 },
  { label: 'Up to 3 hrs', minutes: 180 },
];

export const MOODS = ['Cozy', 'Funny', 'Tense', 'Mind-bending', 'Emotional', 'Epic', 'Spooky', 'Uplifting'];

export const DEFAULT_PREFS = { type: 'movie', minutes: null, mood: '' };
const PREFS_KEY = 'cinemind_tonight_prefs';
const MAX_EXCLUDE = 150; // the API accepts up to 200

export const refOf = (pick) => `${pick.mediaType === 'tv' ? 'tv' : 'movie'}:${pick.id}`;

// Request body for POST /api/ai/tonight
export function buildRequest({ type, minutes, mood, page = 1, shown = [] }) {
  const body = { type: TYPES.some((t) => t.value === type) ? type : 'movie', page };
  const cleanMood = String(mood || '').trim().slice(0, 60);
  if (cleanMood) body.mood = cleanMood;
  if (Number(minutes) > 0) body.minutes = Number(minutes);
  if (shown.length) body.exclude = shown.slice(-MAX_EXCLUDE);
  return body;
}

// "Different picks" walks through TMDB result pages 1..5, then starts over
export const nextPage = (page) => (page >= 5 ? 1 : page + 1);

export const sourceLabel = (source) => (source === 'ai' ? '✦ AI pick' : 'Top-rated pick');

export const tmdbUrl = (pick) => `https://www.themoviedb.org/${pick.mediaType === 'tv' ? 'tv' : 'movie'}/${pick.id}`;

// Same compact shape the watchlist and card handlers already use for movies
export const movieData = (pick) => ({
  id: pick.id,
  title: pick.title,
  poster: pick.poster || null,
  rating: pick.rating ?? 0,
  releaseYear: pick.releaseYear || '',
  genres: pick.genres || [],
});

// Remember the last choices (storage is injected so this works with localStorage or a fake)
export function loadPrefs(storage) {
  try {
    const raw = JSON.parse(storage.getItem(PREFS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
    return {
      type: TYPES.some((t) => t.value === raw.type) ? raw.type : DEFAULT_PREFS.type,
      minutes: TIMES.some((t) => t.minutes === raw.minutes) ? raw.minutes : DEFAULT_PREFS.minutes,
      mood: typeof raw.mood === 'string' ? raw.mood.slice(0, 60) : '',
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(storage, prefs) {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify({ type: prefs.type, minutes: prefs.minutes, mood: prefs.mood }));
  } catch { /* storage can be unavailable (private mode, quota) */ }
}
