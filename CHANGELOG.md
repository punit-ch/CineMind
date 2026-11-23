# Changelog

## Unreleased

### Changed
- Migrated the Gemini integration from the deprecated `@google/generative-ai` SDK to `@google/genai`.
  All Gemini calls now go through `services/llmClient.js`.
- Default model is now `gemini-3.5-flash-lite` (confirm current names in Google AI Studio). Set `GEMINI_MODEL`
  to override. If a model is retired or renamed (HTTP 404 / "not found"), the client automatically tries the
  models in `GEMINI_FALLBACK_MODELS` (default `gemini-3.1-flash-lite,gemini-3.8-flash,gemini-2.5-flash`).
- JSON helpers `parseJSON` and `asArray` moved from `services/geminiService.js` to `utils/aiJson.js`.
- The TTL cache cleanup timer no longer keeps the process alive (`unref`).

### Added
- Automated tests (`npm test`, Node's built-in runner): input validation, JSON parsing, TTL cache, model
  fallback and chat history building, and `geminiService` behaviour (retries, prompt cleaning) with a stubbed client.
- GitHub Actions workflow (`.github/workflows/ci.yml`) running the tests on Node 20 and 22.
- `GEMINI_FALLBACK_MODELS` environment variable.
- TV support: `GET /api/tv/search`, `/trending`, `/top-rated`, `/:id` (with seasons) and `/:id/seasons/:season`
  (episode lists; clients should hide titles and summaries of unwatched episodes).
- `POST /api/ai/tonight`: three real picks per request from TMDB candidates, with AI re-ranking validated against the
  candidate list and a code-ranked fallback when the AI is unavailable. Supports movies, TV or both.
- Spoiler-free rule (`services/spoilerPolicy.js`) appended to every AI prompt and to the chat system instruction.

- Tonight screen in the dashboard (`public/js/tonight.js`, `public/js/tonightLogic.js`, `public/css/tonight.css`):
  choose Movie, TV or Either, available time and mood, get three picks with reasons, and ask for different picks.
  Movie picks open the existing detail modal and can be added to the watchlist; TV picks link to TMDB until
  TV detail screens exist. The last choices are remembered in `localStorage`.
- `scripts/apply_tonight_ui.py`: one-time script that adds the Tonight section, nav item, quick-action card and
  wiring to `public/dashboard.html`, `public/js/app.js` and `public/js/api.js`.

### Changed (spoiler policy)
- The critic prompt no longer asks for real scenes. `bestMoment` and `hiddenDetails` keep their keys but now ask for
  spoiler-free content, so the frontend does not need changes.
- The chat assistant now declines spoiler requests.

### Unchanged
- Existing API routes and response shapes. Movie endpoints behave as before.

### Not done yet
- TV screens (browse, details, episode tracking), accounts, and an automated spoiler check on AI output.
