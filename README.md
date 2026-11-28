# CineMind AI

AI-powered movie discovery: Gemini-driven recommendations, mood picks, critic analysis, movie-night planner, film comparison and chat, on top of TMDB data.

**Stack:** Node.js · Express · Google Gen AI SDK (`@google/genai`) · TMDB API · vanilla JS (ES modules)

## Setup
```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY and TMDB_API_KEY
npm run dev            # http://localhost:3000
```

## Tests
```bash
npm test               # Node's built-in test runner, no network needed
```
Tests live in `test/` and run in CI on every push and pull request.

## Features
Recommendations (taste form + mood) · Tonight (three spoiler-free picks for right now) · Search · Trending / Top Rated / genre browse · TV shows, seasons and episodes (API) · AI Chat · AI Critic · Movie Night Planner · Compare Films · Watchlist · History · AI Taste Profile · Library (queues, diary, ratings out of 10, JSON export/import)

Watchlist, history, taste-profile cache and the Library are stored in the browser (`localStorage`); there are no user accounts.

### Library
Separate film and TV queues (drag or use the arrows to rank), TV episode tracking with a Spoiler Shield (hidden titles for unwatched episodes), a viewing diary that you can edit (date, rating out of 10 with decimals,
review, rewatch flag, and private details such as who with, where, mood and notes), simple stats, and JSON
export/import (merge or replace). Data lives only in this browser, so export regularly. The export format is versioned
(`version: 2`) and is designed to import into a database later.

## Config
| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY`, `TMDB_API_KEY` | required |
| `GEMINI_MODEL` | primary model, default `gemini-3.5-flash-lite` (confirm current names in Google AI Studio) |
| `GEMINI_FALLBACK_MODELS` | comma-separated models tried if the primary is retired or renamed, default `gemini-3.1-flash-lite,gemini-3.8-flash,gemini-2.5-flash` |
| `AI_RATE_LIMIT` | AI requests / minute / IP (default 12) |
| `ALLOWED_ORIGIN` | CORS origin in production |

## API
`GET /api/health` · `GET /api/movies/{search,trending,top-rated,genres/:id,:id,:id/similar}` · `GET /api/tv/{search,trending,top-rated,:id,:id/seasons/:season}` · `GET /api/providers/:mediaType/:id?country=IN` · `POST /api/ai/{recommend,mood,tonight,critic,plan,chat,profile,compare}`

### Tonight (`POST /api/ai/tonight`)
Picks three real titles for tonight. Candidates come from TMDB (filtered by mood, time available and type), the AI
only re-ranks and explains them, and if the AI is unavailable the endpoint falls back to a code-ranked list.

```json
{ "mood": "cozy", "minutes": 100, "type": "movie", "genres": ["Comedy"], "page": 1, "exclude": ["movie:550", "tv:1396"] }
```
`type` is `movie`, `tv` or `either`. Use `page` (1 to 5) and `exclude` for "not this one". The response lists `picks`
(each with `reason`, `tonightFit` and `source` of `ai` or `fallback`), the overall `source`, and `candidatesConsidered`.
Overviews are left out on purpose, because they can contain spoilers.

### Where to watch
Tonight picks show where each title streams in your country (Stream, Free, Free with ads, Rent, Buy). The country is
detected from your browser and can be changed on the Tonight page. Availability comes from TMDB's watch-provider data,
which is provided by JustWatch, so the app shows JustWatch attribution next to it. TMDB's terms for the free API key
cover non-commercial use only; ads or paid plans need a separate TMDB agreement.

## Spoiler-free AI
Every AI prompt carries a strict no-spoilers rule (`services/spoilerPolicy.js`), and every answer is checked
afterwards (`services/spoilerGuard.js`). The check looks for wording that usually signals a spoiler (deaths, twists,
reveals, endings, who is responsible). If it finds some, the AI is asked once more with a stricter instruction, and
any sentence that still matches is removed. Title fields are skipped. This is a heuristic: it lowers the risk, it can
drop harmless sentences, and it cannot guarantee zero spoilers.
