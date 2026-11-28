// public/js/ratings/ratings.js — Ratings History section
import { ratingsApi } from '../api.js';
import { buildMovieCard, showToast, esc, openModal, buildMovieModal, buildTvModal } from '../ui.js';
import { moviesApi, tvApi } from '../api.js';
import { syncWatchlistButtons } from '../watchlist.js';

const ITEMS_PER_PAGE = 20;
let currentPage = 1;
let currentSort = 'date_desc';
let isLoading = false;

export async function initRatings(sectionEl) {
  const list = sectionEl.querySelector('#ratings-list');
  const empty = sectionEl.querySelector('#ratings-empty');
  const sortSelect = sectionEl.querySelector('#ratings-sort');

  // Load initial data
  await loadRatings(list, empty);

  // Event listeners
  sortSelect?.addEventListener('change', () => {
    currentSort = sortSelect.value;
    resetAndLoad(list, empty);
  });

  // Load more on scroll
  window.addEventListener('scroll', debounce(() => {
    if (isNearBottom() && !isLoading) {
      currentPage++;
      loadRatings(list, empty, true);
    }
  }, 200));
}

async function loadRatings(list, empty, append = false) {
  if (isLoading) return;
  isLoading = true;

  if (!append) {
    list.innerHTML = Array(5).fill('<div class="skeleton skeleton-card"></div>').join('');
  }

  try {
    const params = {
      page: currentPage,
      limit: ITEMS_PER_PAGE,
      sort: currentSort
    };

    const data = await ratingsApi.get(params);
    const items = data.ratings || [];

    if (!append) list.innerHTML = '';

    if (items.length === 0 && currentPage === 1) {
      list.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }

    empty?.classList.add('hidden');

    items.forEach(item => {
      const ratingItem = createRatingItem(item);
      list.appendChild(ratingItem);
    });

    syncWatchlistButtons(list);
  } catch (err) {
    if (!append) {
      list.innerHTML = `<p class="text-muted" style="grid-column:1/-1">Couldn't load ratings: ${esc(err.message)}</p>`;
    }
    showToast(`Failed to load ratings: ${err.message}`, 'error');
  } finally {
    isLoading = false;
  }
}

function resetAndLoad(list, empty) {
  currentPage = 1;
  loadRatings(list, empty, false);
}

function createRatingItem(item) {
  const ratingItem = document.createElement('div');
  ratingItem.className = 'rating-item';
  ratingItem.dataset.ratingId = item.id;

  const date = new Date(item.rated_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  });

  const ratingStars = '★ '.repeat(Math.round(item.user_rating / 2));
  const posterUrl = item.poster
    ? `https://image.tmdb.org/t/p/w154${item.poster}`
    : '';

  ratingItem.innerHTML = `
    <div class="rating-item__poster">
      ${posterUrl
        ? `<img src="${posterUrl}" alt="${esc(item.title)}" loading="lazy">`
        : `<div class="movie-card__poster-placeholder">🎬</div>`
      }
    </div>
    <div class="rating-item__content">
      <div class="rating-item__header">
        <h3 class="rating-item__title">${esc(item.title)}</h3>
        <div class="rating-item__meta">
          <span class="rating-item__date">${esc(date)}</span>
          <span class="rating-item__type">${item.media_type === 'tv' ? 'TV' : 'Movie'}</span>
        </div>
      </div>
      <div class="rating-item__rating">
        <span class="rating-stars">${ratingStars}</span>
        <span class="rating-value">${item.user_rating}/10</span>
      </div>
      ${item.release_year ? `<div class="rating-item__year">${esc(item.release_year)}</div>` : ''}
    </div>
  `;

  // Click on poster/title opens movie details
  ratingItem.querySelector('.rating-item__poster')?.addEventListener('click', () => openDetails(item));
  ratingItem.querySelector('.rating-item__title')?.addEventListener('click', () => openDetails(item));

  return ratingItem;
}

async function openDetails(item) {
  try {
    if (item.media_type === 'tv') {
      const show = await tvApi.details(item.tmdb_id);
      openModal(show.title, buildTvModal(show));
    } else {
      const movie = await moviesApi.details(item.tmdb_id);
      openModal(movie.title, buildMovieModal(movie));
    }
    syncWatchlistButtons(document.getElementById('modal-body'));
  } catch (err) {
    showToast(`Could not load details: ${err.message}`, 'error');
  }
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function isNearBottom() {
  return window.innerHeight + window.scrollY >= document.body.offsetHeight - 500;
}