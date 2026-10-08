// config/index.js — Central configuration
require('dotenv').config();

const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
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
