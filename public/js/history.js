// public/js/history.js — Activity history stored in localStorage
import { buildMovieCard, esc } from './ui.js';
import { syncWatchlistButtons } from './watchlist.js';

const STORAGE_KEY = 'cinemind_history';
const MAX_ENTRIES = 20;

export function getHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch { /* storage full/blocked — history is non-critical */ }
}

// Only store what the cards need — full AI payloads quickly fill localStorage
const slim = (m) => ({
  id: m.id ?? null,
  title: m.title,
  poster: m.poster || null,
  rating: m.rating ?? 0,
  releaseYear: m.releaseYear || m.year || '',
  genres: m.genres || [],
});

export function addHistoryEntry(entry) {
  const { recommendations, movies, ...rest } = entry;
  const list = getHistory();
  list.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    ...rest,
    ...(recommendations && { recommendations: recommendations.map(slim) }),
    ...(movies && { movies: movies.slice(0, 12).map(slim) }),
  });
  saveHistory(list);
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
}

export function renderHistory(sectionEl) {
  const list = getHistory();
  const container = sectionEl.querySelector('#history-list');
  const empty = sectionEl.querySelector('#history-empty');
  const clearBtn = sectionEl.querySelector('#clear-history-btn');

  empty?.classList.toggle('hidden', list.length > 0);
  clearBtn?.classList.toggle('hidden', list.length === 0);
  if (!container) return;

  container.innerHTML = list.map(buildHistoryItem).join('');
  syncWatchlistButtons(container);

  container.querySelectorAll('.history-item-header').forEach((header) => {
    header.addEventListener('click', () => {
      header.nextElementSibling?.classList.toggle('hidden');
    });
  });

  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = '1';
    clearBtn.addEventListener('click', () => {
      if (confirm('Clear all history? This cannot be undone.')) {
        clearHistory();
        renderHistory(sectionEl);
      }
    });
  }
}

function buildHistoryItem(entry) {
  const timeStr = new Date(entry.timestamp).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const badge = { ai: 'ai', mood: 'mood', search: 'search' }[entry.type] || 'ai';
  const label = {
    ai: 'AI Recs',
    mood: `Mood: ${entry.mood || ''}`,
    search: `Search: "${entry.query || ''}"`,
  }[entry.type] || 'Recommendations';

  const movies = entry.recommendations || entry.movies || [];

  return `
    <div class="history-item">
      <div class="history-item-header" role="button" tabindex="0">
        <div class="history-item-meta">
          <span class="history-type-badge ${badge}">${esc(label)}</span>
          <span class="text-secondary body-sm">${movies.length} movies</span>
        </div>
        <span class="text-muted body-sm">${esc(timeStr)} ▾</span>
      </div>
      <div class="history-item-movies ${movies.length ? '' : 'hidden'}">
        ${movies.slice(0, 6).map((m) => buildMovieCard(m)).join('')}
      </div>
    </div>`;
}
