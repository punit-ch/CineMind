// services/spoilerGuard.js — A safety net behind the "spoiler-free, no exceptions" prompt rule.
//
// Language models can ignore instructions, so every AI answer is scanned for phrases that usually signal a
// spoiler (deaths, twists, endings, reveals). If something is found the caller can retry once with a stricter
// instruction; whatever still matches is removed sentence by sentence. This is a heuristic: it lowers the
// risk but cannot guarantee a spoiler-free answer, and it can drop harmless sentences.
const { SPOILER_RULE } = require('./spoilerPolicy');

const PATTERNS = [
  // deaths
  /\b(dies|gets killed|is killed|are killed|killed off|is murdered|ends up dead|doesn't survive|does not survive|commits suicide|kills (himself|herself|themselves))\b/i,
  // twists and reveals
  /\b(plot twists?|twist ending|the twist|big twist|shocking twist|big reveal|final reveal)\b/i,
  /\bturns? out (that|to be)\b|\bit is revealed\b|\bis revealed (to|as)\b|\bis actually\b|\bwas actually\b|\bthe real (killer|villain|culprit|traitor)\b/i,
  // endings
  /\b(the )?(ending|finale|final (scene|act|twist)|last scene|climax)\b/i,
  /\b(in|by|at) the (end|final)\b/i,
  // who did it
  /\b(killer|villain|murderer|culprit|traitor|mole|spy) (is|was|turns out to be)\b/i,
];

// Fields that hold titles or names, which can contain these words innocently ("The Man Who Killed Don Quixote")
// Covers snake_case and camelCase variants used across AI responses and TMDB data
const SKIP_KEYS = new Set([
  // Common title/name fields (snake_case)
  'title', 'movie1', 'movie2', 'watchfirst', 'similarmovies', 'ref', 'directors', 'genre',
  'name', 'original_title', 'original_name', 'overview', 'tagline',
  // camelCase variants
  'movieTitle', 'movie1Title', 'movie2Title', 'watchFirst', 'similarMovies', 'similarShows',
  'originalTitle', 'originalName', 'movieTitle', 'showTitle', 'seriesTitle',
  // TMDB-specific fields
  'movie', 'show', 'series', 'episode', 'season',
  // Generic name fields
  'character', 'actor', 'director', 'writer', 'producer', 'creator',
]);

const STRICT_REMINDER = `${SPOILER_RULE}
Your previous answer contained wording that may reveal plot details. Rewrite it so that no sentence mentions deaths, twists, reveals, endings or who is responsible for anything. Describe only the premise, tone, themes, genre and craft.`;

const sentences = (text) => String(text).split(/(?<=[.!?])\s+/).filter(Boolean);
const isRisky = (sentence) => PATTERNS.some((p) => p.test(sentence));

// Strings are scanned recursively; keys that hold titles are skipped
function walk(value, key, visit) {
  if (typeof value === 'string') return visit(value, key);
  if (Array.isArray(value)) return value.map((v) => walk(v, key, visit));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k.toLowerCase(), visit)]));
  }
  return value;
}

const skipped = (key) => key !== undefined && SKIP_KEYS.has(key);

function hasRisk(value) {
  let found = false;
  walk(value, undefined, (text, key) => {
    if (!skipped(key) && sentences(text).some(isRisky)) found = true;
    return text;
  });
  return found;
}

// Remove risky sentences from every string. Returns the cleaned value and how many sentences were removed.
function scrub(value) {
  let removed = 0;
  const cleaned = walk(value, undefined, (text, key) => {
    if (skipped(key)) return text;
    const kept = sentences(text).filter((s) => {
      if (isRisky(s)) {
        removed += 1;
        return false;
      }
      return true;
    });
    return kept.join(' ');
  });
  return { value: cleaned, removed };
}

const FALLBACK_REPLY =
  "I'd rather not spoil that. I can tell you what makes it worth watching without giving anything away, if you like.";

module.exports = { hasRisk, scrub, sentences, isRisky, STRICT_REMINDER, FALLBACK_REPLY, PATTERNS };
