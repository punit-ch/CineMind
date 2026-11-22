// services/llmClient.js — Thin wrapper around the Google Gen AI SDK (@google/genai)
//
// Responsibilities:
//  - create the SDK client lazily (so the server and tests start without it installed)
//  - JSON-mode generation and chat
//  - fall back to another model when the configured one is renamed or retired
const config = require('../config');
const { cleanText } = require('../utils/validate');

const UNAVAILABLE_TTL_MS = 10 * 60 * 1000; // skip a model we know is gone for 10 minutes

let client = null;
const unavailableUntil = new Map(); // model -> timestamp

function getClient() {
  if (client) return client;
  let GoogleGenAI;
  try {
    ({ GoogleGenAI } = require('@google/genai'));
  } catch {
    throw new Error('The @google/genai package is not installed. Run: npm install @google/genai');
  }
  client = new GoogleGenAI({
    apiKey: config.gemini.apiKey || 'missing-key',
    ...(config.gemini.baseUrl ? { httpOptions: { baseUrl: config.gemini.baseUrl } } : {}),
  });
  return client;
}

// Primary model first, then fallbacks, without duplicates
const modelCandidates = () => [...new Set([config.gemini.model, ...config.gemini.fallbackModels])];

// True when the error means "this model name doesn't exist (any more)"
const isModelUnavailable = (err) =>
  err?.status === 404 ||
  /not found|no longer available|has been deprecated|unknown model|is not supported for/i.test(
    String(err?.message || '')
  );

// Run fn(model) against each candidate model until one is not "unavailable".
// Any other error (rate limit, auth, bad request...) is thrown immediately.
async function withModelFallback(fn) {
  const all = modelCandidates();
  const now = Date.now();
  const usable = all.filter((m) => (unavailableUntil.get(m) || 0) <= now);
  const models = usable.length ? usable : all;

  let lastErr;
  for (const model of models) {
    try {
      return await fn(model);
    } catch (err) {
      lastErr = err;
      if (!isModelUnavailable(err)) throw err;
      unavailableUntil.set(model, Date.now() + UNAVAILABLE_TTL_MS);
      console.warn(`[gemini] model "${model}" unavailable (${err.message}); trying the next one`);
    }
  }
  throw lastErr;
}

// Ask for JSON (no markdown fences) and return the raw text
async function generateJSONText(prompt) {
  return withModelFallback(async (model) => {
    const response = await getClient().models.generateContent({
      model,
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.8 },
    });
    return response.text ?? '';
  });
}

// Gemini requires history to start with a user turn and alternate roles
function buildChatTurns(messages) {
  const turns = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: cleanText(m.content, 2000) }],
  }));
  const last = turns.pop();
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return { history: turns, last: last.parts[0].text };
}

async function chat(messages, systemInstruction) {
  const { history, last } = buildChatTurns(messages);
  return withModelFallback(async (model) => {
    const session = getClient().chats.create({
      model,
      history,
      config: { systemInstruction, maxOutputTokens: 1000 },
    });
    const response = await session.sendMessage({ message: last });
    return response.text ?? '';
  });
}

// Test hooks (not used by the app)
const _setClientForTests = (fake) => {
  client = fake;
};
const _resetForTests = () => {
  client = null;
  unavailableUntil.clear();
};

module.exports = {
  generateJSONText,
  chat,
  buildChatTurns,
  modelCandidates,
  isModelUnavailable,
  withModelFallback,
  _setClientForTests,
  _resetForTests,
};
