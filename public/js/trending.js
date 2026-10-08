// public/js/trending.js — Trending / Top Rated / Browse by genre
import { moviesApi } from './api.js';
import { buildMovieCard, esc } from './ui.js';
import { syncWatchlistButtons } from './watchlist.js';

// TMDB genre ids → label (matches the backend GENRE_MAP)
const GENRES = [
  [28, 'Action'], [12, 'Adventure'], [16, 'Animation'], [35, 'Comedy'], [80, 'Crime'],
  [18, 'Drama'], [14, 'Fantasy'], [27, 'Horror'], [9648, 'Mystery'], [10749, 'Romance'],
  [878, 'Sci-Fi'], [53, 'Thriller'], [10752, 'War'],
];

const skeletons = (n) => Array(n).fill('<div class="skeleton skeleton-card"></div>').join('');

function renderGrid(grid, movies) {
  if (!movies?.length) {
    grid.innerHTML = '<p class="text-muted" style="grid-column:1/-1">No movies found.</p>';
    return;
  }
  grid.innerHTML = movies.slice(0, 12).map((m) => buildMovieCard(m)).join('');
  syncWatchlistButtons(grid);
}

function renderError(grid, message, retry) {
  grid.innerHTML = `<p class="text-muted" style="grid-column:1/-1">Failed to load: ${esc(message)}
    <button class="btn btn-ghost btn-sm" data-retry>Retry</button></p>`;
  grid.querySelector('[data-retry]')?.addEventListener('click', retry);
}

export function initTrending(sectionEl) {
  const trendingGrid = sectionEl.querySelector('#trending-grid');
  const topRatedGrid = sectionEl.querySelector('#top-rated-grid');
  const dayBtn = sectionEl.querySelector('#trending-day-btn');
  const weekBtn = sectionEl.querySelector('#trending-week-btn');
  const chips = sectionEl.querySelector('#genre-chips');
  const heading = sectionEl.querySelector('#trending-heading');

  let activeGenre = null;
  let activeWindow = 'week';
  let requestId = 0;

  async function loadMain() {
    if (!trendingGrid) return;
    const myRequest = ++requestId;
    trendingGrid.innerHTML = skeletons(12);
    try {
      const data = activeGenre
        ? await moviesApi.byGenre(activeGenre)
        : await moviesApi.trending(activeWindow);
      if (myRequest === requestId) renderGrid(trendingGrid, data.movies); // { movies } shape
    } catch (err) {
      if (myRequest === requestId) renderError(trendingGrid, err.message, loadMain);
    }
  }

  function updateChrome() {
    const genreName = GENRES.find(([id]) => id === activeGenre)?.[1];
    if (heading) heading.textContent = genreName ? `Popular in ${genreName}` : 'Trending';
    dayBtn?.toggleAttribute('disabled', Boolean(activeGenre));
    weekBtn?.toggleAttribute('disabled', Boolean(activeGenre));
    const setTab = (btn, on) => {
      btn?.classList.toggle('btn-primary', on && !activeGenre);
      btn?.classList.toggle('btn-secondary', !(on && !activeGenre));
    };
    setTab(dayBtn, activeWindow === 'day');
    setTab(weekBtn, activeWindow === 'week');
    chips?.querySelectorAll('.chip').forEach((chip) => {
      chip.classList.toggle('active', Number(chip.dataset.genre) === activeGenre);
    });
  }

  dayBtn?.addEventListener('click', () => { activeWindow = 'day'; updateChrome(); loadMain(); });
  weekBtn?.addEventListener('click', () => { activeWindow = 'week'; updateChrome(); loadMain(); });

  if (chips) {
    chips.innerHTML = GENRES.map(([id, name]) =>
      `<button class="chip" data-genre="${id}">${esc(name)}</button>`).join('');
    chips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const id = Number(chip.dataset.genre);
      activeGenre = activeGenre === id ? null : id; // click again to clear
      updateChrome();
      loadMain();
    });
  }

  async function loadTopRated() {
    if (!topRatedGrid) return;
    topRatedGrid.innerHTML = skeletons(12);
    try {
      const { movies } = await moviesApi.topRated();
      renderGrid(topRatedGrid, movies);
    } catch (err) {
      renderError(topRatedGrid, err.message, loadTopRated);
    }
  }

  updateChrome();
  loadMain();
  loadTopRated();
}
