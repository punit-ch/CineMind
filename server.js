// server.js — CineMind AI Express server
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');

const app = express();

// Behind Render/Railway/Vercel etc. the real client IP comes via X-Forwarded-For;
// without this every user shares one rate-limit bucket.
if (config.nodeEnv === 'production') app.set('trust proxy', 1);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'https://image.tmdb.org', 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(cors({
  origin: config.nodeEnv === 'production' ? (process.env.ALLOWED_ORIGIN || false) : '*',
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300, // the dashboard makes several calls per page view
  message: { error: 'Too many requests, please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT) || 12, // Gemini free tier allows roughly 10-15 requests/min
  message: { error: 'AI rate limit reached. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '16kb' }));

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/ai', apiLimiter, aiLimiter, require('./routes/ai'));
app.use('/api/movies', apiLimiter, require('./routes/movies'));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: require('./package.json').version,
    services: {
      gemini: !!config.gemini.apiKey,
      tmdb: !!config.tmdb.apiKey,
    },
  });
});

// Unknown /api/* paths must return JSON, not the landing page
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

// ─── Pages ────────────────────────────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || err.response?.status;
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} →`, err.message);

  // Malformed / oversized request bodies (checked first: body-parser errors also set `expose`)
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });

  // Errors we raised on purpose (validation etc.)
  if (err.expose) return res.status(err.status).json({ error: err.message });

  // Gemini: quota, bad key, overload
  const msg = err.message || '';
  if (status === 429 || /quota|RESOURCE_EXHAUSTED|rate limit/i.test(msg)) {
    return res.status(429).json({ error: 'The AI is busy right now. Please try again in a minute.' });
  }
  if (status === 403 || /API[_ ]KEY|PERMISSION_DENIED/i.test(msg)) {
    return res.status(503).json({ error: 'AI service is not configured correctly.' });
  }
  if (status === 503 || /overloaded|UNAVAILABLE/i.test(msg)) {
    return res.status(503).json({ error: 'AI service temporarily unavailable. Please retry.' });
  }

  // TMDB
  if (err.response?.status === 401) return res.status(503).json({ error: 'Movie database authentication failed.' });
  if (err.response?.status === 404) return res.status(404).json({ error: 'Movie not found.' });
  if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'Movie database timed out.' });

  // Gemini returned something that isn't valid JSON
  if (err instanceof SyntaxError) {
    return res.status(502).json({ error: 'AI response could not be read. Please retry.' });
  }

  res.status(500).json({
    error: config.nodeEnv === 'production' ? 'An unexpected error occurred.' : err.message,
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`CineMind AI running on http://localhost:${config.port} (${config.nodeEnv})`);
  });
}

module.exports = app;
