// public/js/library/library.js — My Library section (watchlist, watching, watched, dropped)
import { libraryApi } from '../api.js';
import { buildMovieCard, showToast, esc } from '../ui.js';
import { syncWatchlistButtons } from '../watchlist.js';

const ITEMS_PER_PAGE = 24;
let currentPage = 1;
let currentFilters = { status: '', type: '', search: '' };
let isLoading = false;

export async function initLibrary(sectionEl) {
  const grid = sectionEl.querySelector('#library-grid');
  const empty = sectionEl.querySelector('#library-empty');
  const loadMoreBtn = sectionEl.querySelector('#library-load-more');
  const statusFilter = sectionEl.querySelector('#library-status-filter');
  const typeFilter = sectionEl.querySelector('#library-type-filter');
  const searchInput = sectionEl.querySelector('#library-search');

  // Load initial data
  await loadLibrary(grid, empty, loadMoreBtn);

  // Event listeners
  statusFilter?.addEventListener('change', () => {
    currentFilters.status = statusFilter.value;
    resetAndLoad(grid, empty, loadMoreBtn);
  });

  typeFilter?.addEventListener('change', () => {
    currentFilters.type = typeFilter.value;
    resetAndLoad(grid, empty, loadMoreBtn);
  });

  searchInput?.addEventListener('input', debounce(() => {
    currentFilters.search = searchInput.value.trim();
    resetAndLoad(grid, empty, loadMoreBtn);
  }, 300));

  loadMoreBtn?.addEventListener('click', () => {
    currentPage++;
    loadLibrary(grid, empty, loadMoreBtn, true);
  });
}

async function loadLibrary(grid, empty, loadMoreBtn, append = false) {
  if (isLoading) return;
  isLoading = true;

  if (!append) {
    grid.innerHTML = Array(6).fill('<div class="skeleton skeleton-card"></div>').join('');
    loadMoreBtn?.classList.add('hidden');
  } else {
    loadMoreBtn?.textContent = 'Loading...';
    loadMoreBtn?.disabled = true;
  }

  try {
    const params = {
      page: currentPage,
      limit: ITEMS_PER_PAGE,
      ...currentFilters
    };

    const data = await libraryApi.get(params);
    const items = data.items || [];
    const stats = data.stats;

    // Update stats
    updateStats(stats);

    if (!append) grid.innerHTML = '';

    if (items.length === 0 && currentPage === 1) {
      grid.innerHTML = '';
      empty?.classList.remove('hidden');
      loadMoreBtn?.classList.add('hidden');
      return;
    }

    empty?.classList.add('hidden');

    items.forEach(item => {
      const card = createLibraryCard(item);
      grid.appendChild(card);
    });

    syncWatchlistButtons(grid);

    // Show load more if there are more items
    if (items.length >= ITEMS_PER_PAGE) {
      loadMoreBtn?.classList.remove('hidden');
      loadMoreBtn.textContent = 'Load More';
      loadMoreBtn.disabled = false;
    } else {
      loadMoreBtn?.classList.add('hidden');
    }
  } catch (err) {
    if (!append) {
      grid.innerHTML = `<p class="text-muted" style="grid-column:1/-1">Couldn't load library: ${esc(err.message)}</p>`;
    }
    showToast(`Failed to load library: ${err.message}`, 'error');
  } finally {
    isLoading = false;
  }
}

function resetAndLoad(grid, empty, loadMoreBtn) {
  currentPage = 1;
  loadLibrary(grid, empty, loadMoreBtn, false);
}

function updateStats(stats) {
  const statsEl = document.getElementById('library-stats');
  if (!statsEl || !stats) return;

  statsEl.innerHTML = `
    <div class="lib-stat"><strong>${stats.watchlist_count || 0}</strong><span>Watchlist</span></div>
    <div class="lib-stat"><strong>${stats.watching_count || 0}</strong><span>Watching</span></div>
    <div class="lib-stat"><strong>${stats.watched_count || 0}</strong><span>Watched</span></div>
    <div class="lib-stat"><strong>${stats.dropped_count || 0}</strong><span>Dropped</span></div>
    <div class="lib-stat"><strong>${stats.total || 0}</strong><span>Total</span></div>
  `;
}

function createLibraryCard(item) {
  const card = document.createElement('div');
  card.className = 'movie-card';
  card.dataset.movieId = item.tmdb_id;
  card.dataset.mediaType = item.media_type;

  const statusBadge = getStatusBadge(item.status);
  const userRating = item.user_rating ? `★ ${item.user_rating}` : '';
  const progress = item.total_episodes ? `Ep ${item.progress}/${item.total_episodes}` : '';

  const posterUrl = item.poster
    ? `https://image.tmdb.org/t/p/w342${item.poster}`
    : '';

  card.innerHTML = `
    <div class="movie-card__poster-wrap">
      ${posterUrl
        ? `<img class="movie-card__poster" src="${posterUrl}" alt="${esc(item.title)}" loading="lazy">`
        : `<div class="movie-card__poster-placeholder">🎬</div>`
      }
      <div class="movie-card__poster-fallback" style="display:none">🎬</div>
      <div class="movie-card__badge movie-card__badge--status">${statusBadge}</div>
      ${userRating ? `<div class="movie-card__badge movie-card__badge--rating">${userRating}</div>` : ''}
      <div class="movie-card__actions">
        <button class="movie-card__btn watchlist-toggle" data-movie-id="${item.tmdb_id}" title="Add to watchlist">🤍</button>
        <button class="movie-card__btn movie-info-btn" data-movie-id="${item.tmdb_id}" title="Details">ℹ️</button>
      </div>
    </div>
    <div class="movie-card__body">
      <h3 class="movie-card__title">${esc(item.title)}</h3>
      <p class="movie-card__meta">
        ${item.release_year ? esc(item.release_year) : ''}
        ${item.genres?.length ? ` · ${item.genres.slice(0, 3).map(esc).join(', ')}` : ''}
        ${progress ? ` · ${esc(progress)}` : ''}
      </p>
    </div>
  `;

  return card;
}

function getStatusBadge(status) {
  const badges = {
    watchlist: '<span class="badge badge-outline">❤️ Watchlist</span>',
    watching: '<span class="badge badge-primary">▶ Watching</span>',
    watched: '<span class="badge badge-success">✓ Watched</span>',
    dropped: '<span class="badge badge-muted">✕ Dropped</span>'
  };
  return badges[status] || status;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}