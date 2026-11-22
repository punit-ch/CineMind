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

### Unchanged
- AI prompts, API routes and response shapes are exactly as before. Spoiler-related prompt changes and
  grounding recommendations in TMDB candidates are planned as separate changes.
