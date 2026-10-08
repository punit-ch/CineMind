# CineMind AI

AI-powered movie discovery: Gemini-driven recommendations, mood picks, critic analysis, movie-night planner, film comparison and chat, on top of TMDB data.

**Stack:** Node.js · Express · Google Gemini API · TMDB API · vanilla JS (ES modules)

## Setup
```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY and TMDB_API_KEY
npm run dev            # http://localhost:3000
```

## Features
Recommendations (taste form + mood) · Search · Trending / Top Rated / genre browse · AI Chat · AI Critic · Movie Night Planner · Compare Films · Watchlist · History · AI Taste Profile

Watchlist, history and taste-profile cache are stored in the browser (`localStorage`); there are no user accounts.

## Config
| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY`, `TMDB_API_KEY` | required |
| `GEMINI_MODEL` | default `gemini-2.5-flash` |
| `AI_RATE_LIMIT` | AI requests / minute / IP (default 12) |
| `ALLOWED_ORIGIN` | CORS origin in production |

## API
`GET /api/health` · `GET /api/movies/{search,trending,top-rated,genres/:id,:id,:id/similar}` · `POST /api/ai/{recommend,mood,critic,plan,chat,profile,compare}`
