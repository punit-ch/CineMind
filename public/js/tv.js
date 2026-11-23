// public/js/tv.js — TV search and discovery
import { tvApi } from './api.js';
import { buildMovieCard, esc, showToast } from './ui.js';
import { syncWatchlistButtons } from './watchlist.js';

const skeletons = (n) => Array(n).fill('<div class="skeleton skeleton-card"></div>').join('');

function renderGrid(container, shows, emptyText = 'No TV shows found.') {
  if (!shows?.length) {
    container.innerHTML = `<p class="text-muted" style="grid-column:1/-1">${esc(emptyText)}</p>`;
    return;
  }
  container.innerHTML = shows.map((show) => buildMovieCard(show)).join('');
  syncWatchlistButtons(container);
}

export function initTv(sectionEl) {
  const input = sectionEl.querySelector('#tv-search-input');
  const searchGrid = sectionEl.querySelector('#tv-search-results');
  const trendingGrid = sectionEl.querySelector('#tv-trending-grid');
  const topGrid = sectionEl.querySelector('#tv-top-rated-grid');
  const searchLabel = sectionEl.querySelector('#tv-search-label');
  if (!input || !searchGrid) return;

  let debounceTimer = null;
  let requestId = 0;

  async function search(query) {
    const myRequest = ++requestId;
    searchGrid.innerHTML = skeletons(12);
    if (searchLabel) searchLabel.textContent = 'Searching...';
    try {
      const data = await tvApi.search(query);
      if (myRequest !== requestId) return;
      renderGrid(searchGrid, data.shows, `No TV shows found for "${query}".`);
      if (searchLabel) searchLabel.textContent = data.shows?.length
        ? `${data.shows.length} results for "${query}"`
        : '';
    } catch (err) {
      if (myRequest !== requestId) return;
      searchGrid.innerHTML = `<p class="text-muted" style="grid-column:1/-1">Search failed: ${esc(err.message)}</p>`;
      showToast(`TV search failed: ${err.message}`, 'error');
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (!query) {
      requestId++;
      searchGrid.innerHTML = '';
      if (searchLabel) searchLabel.textContent = '';
      return;
    }
    debounceTimer = setTimeout(() => search(query), 400);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && input.value.trim()) {
      clearTimeout(debounceTimer);
      search(input.value.trim());
    }
  });

  async function loadTrending() {
    trendingGrid.innerHTML = skeletons(12);
    try {
      const data = await tvApi.trending('week');
      renderGrid(trendingGrid, data.shows);
    } catch (err) {
      trendingGrid.innerHTML = `<p class="text-muted" style="grid-column:1/-1">Failed to load: ${esc(err.message)}</p>`;
    }
  }

  async function loadTopRated() {
    topGrid.innerHTML = skeletons(12);
    try {
      const data = await tvApi.topRated();
      renderGrid(topGrid, data.shows);
    } catch (err) {
      topGrid.innerHTML = `<p class="text-muted" style="grid-column:1/-1">Failed to load: ${esc(err.message)}</p>`;
    }
  }

  if (trendingGrid) loadTrending();
  if (topGrid) loadTopRated();
}
