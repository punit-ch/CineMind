// public/js/search.js
import { moviesApi } from './api.js';
import { buildMovieCard, showToast, esc } from './ui.js';
import { syncWatchlistButtons } from './watchlist.js';
import { addHistoryEntry } from './history.js';

export function initSearch(sectionEl) {
  const input = sectionEl.querySelector('#search-input');
  const resultsGrid = sectionEl.querySelector('#search-results');
  const resultsLabel = sectionEl.querySelector('#search-results-label');
  const loadMoreBtn = sectionEl.querySelector('#search-load-more');
  if (!input || !resultsGrid) return;

  let currentQuery = '';
  let currentPage = 1;
  let shown = 0;
  let debounceTimer = null;
  let requestId = 0; // only the newest request may update the screen

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();

    if (!q) {
      requestId++; // cancel anything in flight
      currentQuery = '';
      resultsGrid.innerHTML = '';
      if (resultsLabel) resultsLabel.textContent = '';
      loadMoreBtn?.classList.add('hidden');
      return;
    }
    debounceTimer = setTimeout(() => performSearch(q, 1), 400);
  });

  // Enter searches immediately
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      clearTimeout(debounceTimer);
      performSearch(input.value.trim(), 1);
    }
  });

  loadMoreBtn?.addEventListener('click', () => {
    if (currentQuery) performSearch(currentQuery, currentPage + 1, true);
  });

  async function performSearch(query, page = 1, append = false) {
    const myRequest = ++requestId;
    currentQuery = query;

    if (!append) {
      resultsGrid.innerHTML = Array(12).fill('<div class="skeleton skeleton-card"></div>').join('');
      loadMoreBtn?.classList.add('hidden');
    } else if (loadMoreBtn) {
      loadMoreBtn.disabled = true;
    }

    try {
      const data = await moviesApi.search(query, page);
      if (myRequest !== requestId) return; // user typed something newer

      currentPage = page;
      if (!append) {
        resultsGrid.innerHTML = '';
        shown = 0;
      }

      if (!data.movies.length && !append) {
        resultsGrid.innerHTML = `<div style="grid-column:1/-1" class="watchlist-empty">
          <div class="empty-icon">🔍</div>
          <h3>No results for "${esc(query)}"</h3>
          <p class="text-muted">Try a different title or spelling</p>
        </div>`;
        if (resultsLabel) resultsLabel.textContent = '';
        return;
      }

      resultsGrid.insertAdjacentHTML('beforeend', data.movies.map((m) => buildMovieCard(m)).join(''));
      shown += data.movies.length;
      syncWatchlistButtons(resultsGrid);

      if (resultsLabel) resultsLabel.textContent = `${shown} results for "${query}"`;
      loadMoreBtn?.classList.toggle('hidden', !(data.totalPages > page));

      if (!append) addHistoryEntry({ type: 'search', query, movies: data.movies });
    } catch (err) {
      if (myRequest !== requestId) return;
      if (!append) {
        resultsGrid.innerHTML = `<div style="grid-column:1/-1" class="watchlist-empty">
          <div class="empty-icon">⚠️</div>
          <h3>Search failed</h3>
          <p class="text-muted">${esc(err.message)}</p>
        </div>`;
      }
      showToast(`Search error: ${err.message}`, 'error');
    } finally {
      if (loadMoreBtn) loadMoreBtn.disabled = false;
    }
  }
}
