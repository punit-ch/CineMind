// public/js/watchlist.js — Watchlist stored in localStorage
import { showToast, buildMovieCard } from './ui.js';

const STORAGE_KEY = 'cinemind_watchlist';

export function getWatchlist() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveWatchlist(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    showToast('Could not save — browser storage is full or blocked', 'error');
  }
}

export function isInWatchlist(movieId) {
  return getWatchlist().some((m) => Number(m.id) === Number(movieId));
}

// Keep only what the cards need (saves storage, avoids stale blobs)
const slim = (m) => ({
  id: Number(m.id),
  title: m.title,
  poster: m.poster || null,
  rating: m.rating ?? 0,
  releaseYear: m.releaseYear || m.year || '',
  genres: m.genres || [],
});

export function toggleWatchlist(movie) {
  if (!movie || movie.id == null) return false;
  const list = getWatchlist();
  const idx = list.findIndex((m) => Number(m.id) === Number(movie.id));

  if (idx >= 0) {
    list.splice(idx, 1);
    saveWatchlist(list);
    showToast(`Removed ${movie.title} from watchlist`, 'info');
    return false;
  }
  list.unshift({ ...slim(movie), addedAt: new Date().toISOString() });
  saveWatchlist(list);
  showToast(`Added ${movie.title} to watchlist`, 'success');
  return true;
}

// Make every heart button / modal button on the page reflect the real state
export function syncWatchlistButtons(root = document) {
  root.querySelectorAll('.watchlist-toggle').forEach((btn) => {
    const on = isInWatchlist(btn.dataset.movieId);
    btn.textContent = on ? '❤️' : '🤍';
    btn.classList.toggle('active', on);
    btn.title = on ? 'Remove from watchlist' : 'Add to watchlist';
    btn.setAttribute('aria-pressed', String(on));
  });
  root.querySelectorAll('.watchlist-toggle-modal').forEach((btn) => {
    const on = isInWatchlist(btn.dataset.movieId);
    btn.textContent = on ? '✓ In Watchlist' : '❤ Add to Watchlist';
    btn.classList.toggle('btn-secondary', on);
    btn.classList.toggle('btn-primary', !on);
  });
}

export function renderWatchlist(sectionEl) {
  const list = getWatchlist();
  const container = sectionEl.querySelector('#watchlist-grid');
  const empty = sectionEl.querySelector('#watchlist-empty');
  const count = sectionEl.querySelector('#watchlist-count');

  if (count) count.textContent = `${list.length} saved`;
  empty?.classList.toggle('hidden', list.length > 0);
  if (!container) return;

  container.innerHTML = list
    .map((movie) => buildMovieCard(movie, { showAddToWatchlist: true }))
    .join('');
  syncWatchlistButtons(container);
}
