// config/index.js — Central configuration
require('dotenv').config();

// Comma-separated env value -> trimmed, non-empty list
const list = (value, fallback) =>
  String(value ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    // Model names change often. Confirm the current free-tier names in Google AI Studio
    // and override these with GEMINI_MODEL / GEMINI_FALLBACK_MODELS when needed.
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    // Tried in order when the primary model is renamed or retired (HTTP 404 / "not found").
    fallbackModels: list(process.env.GEMINI_FALLBACK_MODELS, 'gemini-3.1-flash-lite,gemini-3.8-flash,gemini-2.5-flash'),
    baseUrl: process.env.GEMINI_BASE_URL || undefined, // optional (proxy / tests)
  },
  tmdb: {
    apiKey: process.env.TMDB_API_KEY,
    baseUrl: process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3',
    imageBase: process.env.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p',
    posterSize: 'w500',
    backdropSize: 'w1280',
  },
  cache: {
    ttl: 10 * 60 * 1000, // 10 minutes in ms
  },
};

// Fail loudly (but don't crash) when keys are missing so the cause is obvious
if (!config.gemini.apiKey) console.warn('[config] GEMINI_API_KEY is not set — AI features will fail.');
if (!config.tmdb.apiKey) console.warn('[config] TMDB_API_KEY is not set — movie data will fail.');

module.exports = config;
