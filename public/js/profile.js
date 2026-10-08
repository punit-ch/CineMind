// public/js/profile.js — Stats + AI taste profile
import { aiApi } from './api.js';
import { showToast, setLoading, esc } from './ui.js';
import { getHistory } from './history.js';
import { getWatchlist } from './watchlist.js';

const CACHE_KEY = 'cinemind_taste_cache';
let bound = false;

// Titles the user has engaged with: watchlist first (strongest signal), then AI picks
function collectTitles() {
  const titles = [
    ...getWatchlist().map((m) => m.title),
    ...getHistory().flatMap((h) => (h.recommendations || []).map((r) => r.title)),
  ].filter(Boolean);
  return [...new Set(titles)].slice(0, 50);
}

const signature = (titles) => titles.join('|');

function readCache(sig) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return c?.sig === sig ? c.profile : null;
  } catch {
    return null;
  }
}

function writeCache(sig, profile) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ sig, profile })); } catch { /* ignore */ }
}

// Called on first visit and on every revisit; the AI is only asked again when the data changed
export function initProfile(sectionEl) {
  renderStats(sectionEl);

  const refreshBtn = sectionEl.querySelector('#refresh-profile');
  if (refreshBtn && !bound) {
    bound = true;
    refreshBtn.addEventListener('click', async () => {
      setLoading(refreshBtn, true);
      await loadTasteProfile(sectionEl, { force: true });
      setLoading(refreshBtn, false, '↻ Refresh');
    });
  }
  loadTasteProfile(sectionEl);
}

function renderStats(sectionEl) {
  const history = getHistory();
  const counters = {
    '#stat-searches': history.filter((h) => h.type === 'search').length,
    '#stat-recs': history.reduce((n, h) => n + (h.type === 'search' ? 0 : (h.recommendations?.length || 0)), 0),
    '#stat-watchlist': getWatchlist().length,
    '#stat-sessions': history.length,
  };
  Object.entries(counters).forEach(([sel, val]) => {
    const el = sectionEl.querySelector(sel);
    if (el) animateCount(el, val);
  });
}

function animateCount(el, target) {
  if (!target) { el.textContent = '0'; return; }
  let current = 0;
  const step = Math.ceil(target / 25);
  const timer = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = current;
    if (current >= target) clearInterval(timer);
  }, 35);
}

async function loadTasteProfile(sectionEl, { force = false } = {}) {
  const container = sectionEl.querySelector('#taste-profile-content');
  if (!container) return;

  const titles = collectTitles();
  if (!titles.length) {
    container.innerHTML = `<div class="watchlist-empty"><div class="empty-icon">📊</div>
      <h3>No data yet</h3>
      <p class="text-muted">Get some recommendations or save movies to your watchlist to build your taste profile</p></div>`;
    return;
  }

  const sig = signature(titles);
  const cached = !force && readCache(sig);
  if (cached) {
    container.innerHTML = buildProfileContent(cached);
    animateGenreBars(container);
    return;
  }

  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div> Analyzing your taste...</div>';
  try {
    const profile = await aiApi.tasteProfile(titles);
    writeCache(sig, profile);
    container.innerHTML = buildProfileContent(profile);
    animateGenreBars(container);
  } catch (err) {
    container.innerHTML = `<p class="text-muted">Could not analyze profile: ${esc(err.message)}</p>`;
    if (force) showToast('Could not refresh profile', 'error');
  }
}

function buildProfileContent(profile) {
  const genres = profile.topGenres || [];
  const insights = profile.insights || [];
  const themes = profile.themes || [];
  const card = (title, body, style = '') => `
    <div class="analytics-card" style="${style}"><h3>${title}</h3>${body}</div>`;

  return `
    ${profile.cinephileType ? `<p style="margin-bottom:var(--space-md)"><span class="tag tag-red">${esc(profile.cinephileType)}</span></p>` : ''}
    <div class="analytics-grid">
      ${card('Top Genres', genres.map((g) => `
        <div class="genre-bar">
          <span class="genre-bar-name">${esc(g.genre)}</span>
          <div class="genre-bar-track"><div class="genre-bar-fill" style="width:0%" data-target="${Math.max(0, Math.min(100, Number(g.percentage) || 0))}"></div></div>
          <span class="genre-bar-pct">${Number(g.percentage) || 0}%</span>
        </div>`).join(''))}
      ${card('Taste Insights', insights.map((i) => `
        <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:10px;padding-left:12px;border-left:2px solid var(--red)">${esc(i)}</p>`).join(''))}
    </div>
    <div class="analytics-grid" style="margin-top:var(--space-md)">
      ${card('Favorite Era', `<p style="font-size:1.25rem;font-weight:700;color:var(--text-primary)">${esc(profile.favoriteEra || '—')}</p>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-top:6px">${esc(profile.eraReason)}</p>`)}
      ${card('Storytelling Style', `<p style="font-size:0.875rem;color:var(--text-secondary);line-height:1.6">${esc(profile.storytellingStyle || '—')}</p>`)}
    </div>
    ${themes.length ? card('Recurring Themes', `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
        ${themes.map((t) => `<span class="tag tag-red">${esc(t)}</span>`).join('')}</div>`, 'margin-top:var(--space-md)') : ''}
    ${(profile.directors || []).length ? card('Directors You Might Love', `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
        ${profile.directors.map((d) => `<span class="tag">${esc(d)}</span>`).join('')}</div>`, 'margin-top:var(--space-md)') : ''}
    ${profile.blindspot ? card('Your Blindspot 🎯', `<p style="font-size:0.875rem;color:var(--text-secondary)">${esc(profile.blindspot)}</p>`, 'margin-top:var(--space-md);border-color:var(--border-accent)') : ''}`;
}

function animateGenreBars(container) {
  requestAnimationFrame(() => setTimeout(() => {
    container.querySelectorAll('.genre-bar-fill').forEach((bar) => { bar.style.width = `${bar.dataset.target}%`; });
  }, 150));
}
