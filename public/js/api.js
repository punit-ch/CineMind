// public/js/api.js — All API calls to the Express backend
const API_BASE = '/api';
const TIMEOUT_MS = 40000; // Gemini can be slow

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiFetch(endpoint, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options,
    });
  } catch (err) {
    throw new ApiError(
      err.name === 'AbortError'
        ? 'The request took too long. Please try again.'
        : 'Cannot reach the server. Check your connection.',
      0
    );
  } finally {
    clearTimeout(timer);
  }

  // The server always sends JSON, but a proxy/host error page might not
  let data = null;
  try {
    data = await response.json();
  } catch { /* handled below */ }

  if (!response.ok) {
    throw new ApiError(data?.error || `Request failed (${response.status})`, response.status);
  }
  if (data === null) throw new ApiError('Unexpected response from the server.', response.status);
  return data;
}

const post = (endpoint, body) =>
  apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });

// ── AI Endpoints ──────────────────────────────────────────────────────────────
export const aiApi = {
  recommend: (preferences) => post('/ai/recommend', preferences),
  moodRecommend: (mood) => post('/ai/mood', { mood }),
  critic: (title) => post('/ai/critic', { title }),
  planNight: (data) => post('/ai/plan', data),
  chat: (messages) => post('/ai/chat', { messages }),
  tasteProfile: (titles) => post('/ai/profile', { titles }),
  compareMovies: (movie1, movie2) => post('/ai/compare', { movie1, movie2 }),
};

// ── Movie Endpoints ───────────────────────────────────────────────────────────
// Note: trending/topRated/byGenre/similar resolve to { movies: [...] }
export const moviesApi = {
  search: (query, page = 1) => apiFetch(`/movies/search?q=${encodeURIComponent(query)}&page=${page}`),
  details: (id) => apiFetch(`/movies/${id}`),
  similar: (id) => apiFetch(`/movies/${id}/similar`),
  trending: (window = 'week') => apiFetch(`/movies/trending?window=${window}`),
  topRated: () => apiFetch('/movies/top-rated'),
  byGenre: (genreId) => apiFetch(`/movies/genres/${genreId}`),
};
