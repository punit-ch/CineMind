// public/js/app.js — Dashboard router + global (delegated) interactions
import { initRecommendations } from './recommendations.js';
import { initSearch } from './search.js';
import { initChat } from './chat.js';
import { initTrending } from './trending.js';
import { initProfile } from './profile.js';
import { initCritic, initPlanner, initComparison } from './tools.js';
import { renderWatchlist, toggleWatchlist, syncWatchlistButtons } from './watchlist.js';
import { renderHistory } from './history.js';
import {
  openModal, closeModal, buildMovieModal, buildMovieCard, readCardMovie, showToast, esc,
} from './ui.js';
import { moviesApi } from './api.js';

const TITLES = {
  home: 'Home',
  recommendations: 'Recommendations',
  search: 'Movie Search',
  trending: 'Trending & Top Rated',
  chat: 'AI Chat',
  critic: 'AI Critic',
  planner: 'Movie Night Planner',
  compare: 'Compare Films',
  watchlist: 'My Watchlist',
  history: 'History',
  profile: 'Taste Profile',
};
const sections = Object.keys(TITLES);
const initializedSections = new Set();

const getHash = () => window.location.hash.replace('#', '') || 'home';

let currentSection = null;

// Activate immediately (so callers can use the section's DOM/handlers right away),
// then update the URL hash for back/forward support.
function navigateTo(section) {
  activateSection(section);
  if (getHash() !== section) window.location.hash = section;
}

function activateSection(section) {
  if (!sections.includes(section)) section = 'home';
  if (section === currentSection) return; // hashchange fired after navigateTo
  currentSection = section;
  const firstVisit = !initializedSections.has(section);

  document.querySelectorAll('.nav-item').forEach((item) => {
    const active = item.dataset.section === section;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle) topbarTitle.textContent = TITLES[section];
  document.title = `${TITLES[section]} — CineMind AI`;

  document.querySelectorAll('.section-page').forEach((el) => el.classList.remove('active'));
  const target = document.getElementById(`section-${section}`);
  if (target) target.classList.add('active');
  window.scrollTo({ top: 0 });

  if (target && firstVisit) {
    initializedSections.add(section);
    initSection(section, target);
  }

  // Sections whose content depends on localStorage re-render on every visit
  if (target && section === 'watchlist') renderWatchlist(target);
  if (target && section === 'history') renderHistory(target);
  if (target && section === 'profile' && !firstVisit) initProfile(target);
  if (target) syncWatchlistButtons(target);

  closeMobileSidebar();
}

function initSection(section, el) {
  switch (section) {
    case 'home': initHome(el); break;
    case 'recommendations': initRecommendations(el); break;
    case 'search': initSearch(el); break;
    case 'trending': initTrending(el); break;
    case 'chat': initChat(el); break;
    case 'critic': initCritic(el); break;
    case 'planner': initPlanner(el); break;
    case 'compare': initComparison(el); break;
    case 'profile': initProfile(el); break;
    default: break; // watchlist / history render on every visit
  }
}

// ── Home ──────────────────────────────────────────────────────────────────────
async function initHome(el) {
  const grid = el.querySelector('#home-trending');
  if (!grid) return;

  grid.innerHTML = Array(6).fill('<div class="skeleton skeleton-card"></div>').join('');
  try {
    const { movies } = await moviesApi.trending('week'); // API returns { movies, timeWindow }
    grid.innerHTML = movies.slice(0, 6).map((m) => buildMovieCard(m)).join('');
    syncWatchlistButtons(grid);
  } catch (err) {
    grid.innerHTML = `
      <p class="text-muted" style="grid-column:1/-1">Couldn't load trending movies: ${esc(err.message)}
        <button class="btn btn-ghost btn-sm" id="home-retry">Retry</button></p>`;
    grid.querySelector('#home-retry')?.addEventListener('click', () => initHome(el));
  }
}

function setGreeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const el = document.getElementById('home-greeting');
  const name = localStorage.getItem('cinemind_name');
  if (el) el.textContent = `${part}${name ? `, ${name}` : ''} 🎬`;
  const nameEl = document.querySelector('.user-name');
  const avatar = document.querySelector('.user-avatar');
  if (nameEl) nameEl.textContent = name || 'Guest';
  if (avatar) avatar.textContent = (name || 'G').charAt(0).toUpperCase();
}

// ── Mobile sidebar ────────────────────────────────────────────────────────────
function openMobileSidebar() {
  document.getElementById('sidebar')?.classList.add('open');
  document.getElementById('sidebar-overlay')?.classList.add('visible');
}
function closeMobileSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('visible');
}

// ── Movie detail modal (single implementation for every screen) ──────────────
let detailRequest = 0;

export async function openMovieDetail(id) {
  if (!id) return;
  const requestId = ++detailRequest;
  try {
    const movie = await moviesApi.details(id);
    if (requestId !== detailRequest) return; // a newer click won
    openModal(movie.title, buildMovieModal(movie));
    syncWatchlistButtons(document.getElementById('modal-body'));
    loadSimilarMovies(id, requestId);
  } catch (err) {
    showToast(`Could not load movie details: ${err.message}`, 'error');
  }
}

async function loadSimilarMovies(movieId, requestId) {
  try {
    const { movies } = await moviesApi.similar(movieId);
    const body = document.getElementById('modal-body');
    if (!body || requestId !== detailRequest || !movies?.length) return;

    const section = document.createElement('div');
    section.style.marginTop = '24px';
    section.innerHTML = `
      <h3 style="font-size:1rem;font-weight:600;margin-bottom:12px;color:var(--text-secondary)">Similar Movies</h3>
      <div class="modal-similar">
        ${movies.slice(0, 8).map((m) => buildMovieCard(m, { showAddToWatchlist: false })).join('')}
      </div>`;
    body.appendChild(section);
  } catch { /* similar movies are optional */ }
}

// ── Global delegated clicks: one place handles cards on every screen ─────────
function bindGlobalHandlers() {
  document.addEventListener('click', (e) => {
    // Watchlist heart (cards, rec cards)
    const heart = e.target.closest('.watchlist-toggle');
    if (heart) {
      e.stopPropagation();
      const owner = heart.closest('[data-movie]');
      const movie = owner && readCardMovie(owner);
      if (!movie) return showToast('Could not update watchlist', 'error');
      toggleWatchlist(movie);
      syncWatchlistButtons();
      const wl = document.getElementById('section-watchlist');
      if (wl?.classList.contains('active')) renderWatchlist(wl);
      return;
    }

    // Watchlist button in modal
    const modalBtn = e.target.closest('.watchlist-toggle-modal');
    if (modalBtn) {
      const movie = readCardMovie(modalBtn);
      if (movie) {
        toggleWatchlist(movie);
        syncWatchlistButtons();
      }
      return;
    }

    // Open details: info button, movie card, or rec card
    const info = e.target.closest('.movie-info-btn');
    const card = info || e.target.closest('.movie-card, .rec-card');
    if (card) {
      const id = info ? info.dataset.movieId : card.dataset.movieId;
      if (id) openMovieDetail(id);
    }
  });

  // Keyboard: Enter/Space activates focused cards; Escape closes the modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return closeModal();
    const card = e.target.closest?.('.movie-card, .history-item-header, .sidebar-user');
    if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) {
      e.preventDefault();
      card.click();
    }
  });

  // <img> errors don't bubble, so listen in the capture phase.
  // Replaces the inline onerror handler (blocked by our CSP).
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.classList.contains('movie-card__poster')) {
      img.style.display = 'none';
      if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
    }
  }, true);
}

// ── Topbar search shortcut ────────────────────────────────────────────────────
function initTopbarSearch() {
  const searchInput = document.getElementById('topbar-search-input');
  if (!searchInput) return;

  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !searchInput.value.trim()) return;
    const q = searchInput.value.trim();
    searchInput.value = '';
    navigateTo('search');
    const sectionInput = document.querySelector('#section-search #search-input');
    if (sectionInput) {
      sectionInput.value = q;
      sectionInput.dispatchEvent(new Event('input')); // initSearch has already run at this point
    }
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-section]').forEach((item) => {
    item.addEventListener('click', () => navigateTo(item.dataset.section));
  });
  document.querySelectorAll('[data-navigate]').forEach((el) => {
    el.addEventListener('click', () => navigateTo(el.dataset.navigate));
  });

  document.getElementById('sidebar-toggle')?.addEventListener('click', openMobileSidebar);
  document.getElementById('sidebar-overlay')?.addEventListener('click', closeMobileSidebar);

  // Let people set a display name instead of a hard-coded one
  document.querySelector('.sidebar-user')?.addEventListener('click', () => {
    const name = prompt('What should we call you?', localStorage.getItem('cinemind_name') || '');
    if (name === null) return;
    const clean = name.trim().slice(0, 24);
    if (clean) localStorage.setItem('cinemind_name', clean);
    else localStorage.removeItem('cinemind_name');
    setGreeting();
  });

  setGreeting();
  bindGlobalHandlers();
  initTopbarSearch();

  window.addEventListener('hashchange', () => activateSection(getHash()));
  activateSection(getHash());
});
