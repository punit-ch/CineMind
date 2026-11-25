// public/js/tonight.js — "What should I watch tonight?" screen
import { aiApi } from './api.js';
import { esc, showToast, setLoading } from './ui.js';
import { syncWatchlistButtons } from './watchlist.js';
import { getLibraryStore } from './library/instance.js';
import { addToQueue, LibraryError } from './library/libraryCore.js';
import {
  TYPES, TIMES, MOODS, buildRequest, nextPage, refOf, sourceLabel, tmdbUrl, movieData, loadPrefs, savePrefs,
} from './tonightLogic.js';

// Only allow http(s) image URLs
const safeImg = (url) => (/^https?:\/\//i.test(url || '') ? esc(url) : '');

const STAR = '★';

// ── Card ──────────────────────────────────────────────────────────────────────
export function buildTonightCard(pick, index = 0, queued = false) {
  const title = esc(pick.title);
  const poster = safeImg(pick.poster);
  const isTv = pick.mediaType === 'tv';
  const genres = (pick.genres || []).slice(0, 3);
  const year = pick.releaseYear && pick.releaseYear !== 'N/A' ? esc(pick.releaseYear) : '';
  const rating = typeof pick.rating === 'number' && pick.rating > 0 ? pick.rating.toFixed(1) : '';
  const movieJson = isTv ? '' : esc(JSON.stringify(movieData(pick)));

  return `
    <article class="tonight-card animate-slide-up" style="animation-delay:${index * 0.08}s"
             data-ref="${esc(refOf(pick))}" ${isTv ? '' : `data-movie="${movieJson}"`}>
      ${poster
        ? `<img class="tonight-card__poster" src="${poster}" alt="${title}" loading="lazy">`
        : `<div class="tonight-card__poster tonight-card__poster--empty">${title}</div>`}
      <div class="tonight-card__body">
        <div>
          <h3 class="tonight-card__title">${title}${year ? ` <span class="tonight-card__year">(${year})</span>` : ''}</h3>
          <div class="tonight-card__meta">
            <span class="tag">${isTv ? 'TV' : 'Movie'}</span>
            ${rating ? `<span class="tonight-card__rating">${STAR} ${rating}</span>` : ''}
            ${genres.map((g) => `<span class="tag">${esc(g)}</span>`).join('')}
          </div>
        </div>
        <p class="tonight-card__reason">${esc(pick.reason)}</p>
        <div class="tonight-card__foot">
          ${pick.tonightFit ? `<span class="tonight-card__fit">${esc(pick.tonightFit)}</span>` : ''}
          <span class="tonight-card__source tonight-card__source--${pick.source === 'ai' ? 'ai' : 'top'}">${esc(sourceLabel(pick.source))}</span>
        </div>
        <div class="tonight-card__actions">
          <button type="button" class="btn btn-primary btn-sm" data-queue-ref="${esc(refOf(pick))}" ${queued ? 'disabled' : ''}>${queued ? 'In queue' : '+ Queue'}</button>
          ${isTv
            ? `<a class="btn btn-secondary btn-sm" href="${esc(tmdbUrl(pick))}" target="_blank" rel="noopener noreferrer">View on TMDB ↗</a>`
            : `<button type="button" class="btn btn-secondary btn-sm movie-info-btn" data-movie-id="${esc(pick.id)}">Details</button>
               <button type="button" class="btn-icon watchlist-toggle" data-movie-id="${esc(pick.id)}" aria-label="Toggle watchlist">🤍</button>`}
        </div>
      </div>
    </article>`;
}

const skeletons = () =>
  Array(3).fill('<div class="tonight-card tonight-card--loading"><div class="skeleton tonight-skeleton"></div></div>').join('');

// ── Screen ────────────────────────────────────────────────────────────────────
export function initTonight(root) {
  const $ = (sel) => root.querySelector(sel);
  const typeEl = $('#tonight-type');
  const timeEl = $('#tonight-time');
  const moodsEl = $('#tonight-moods');
  const moodInput = $('#tonight-mood-input');
  const goBtn = $('#tonight-go');
  const againBtn = $('#tonight-again');
  const moreEl = $('#tonight-more');
  const results = $('#tonight-results');
  if (!typeEl || !timeEl || !moodsEl || !moodInput || !goBtn || !againBtn || !results) return;

  const prefs = loadPrefs(window.localStorage);
  const state = { page: 1, shown: [], loading: false, request: 0, picks: new Map() };
  const store = getLibraryStore();
  const queuedRefs = () => new Set([...store.get().queue.movie, ...store.get().queue.tv].map((q) => q.ref));

  // Segmented controls (radio behaviour)
  const renderSegment = (el, options, isSelected, onSelect) => {
    el.innerHTML = options
      .map((o, i) => `<button type="button" role="radio" class="tonight-seg" data-i="${i}"
          aria-checked="${isSelected(o)}">${esc(o.label)}</button>`)
      .join('');
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('.tonight-seg');
      if (!btn) return;
      onSelect(options[Number(btn.dataset.i)]);
      el.querySelectorAll('.tonight-seg').forEach((b) => {
        b.setAttribute('aria-checked', String(b === btn));
      });
    });
  };
  renderSegment(typeEl, TYPES, (o) => o.value === prefs.type, (o) => { prefs.type = o.value; });
  renderSegment(timeEl, TIMES, (o) => o.minutes === prefs.minutes, (o) => { prefs.minutes = o.minutes; });

  // Mood chips: one tap fills the text box, which stays the source of truth
  moodsEl.innerHTML = MOODS
    .map((m) => `<button type="button" class="tonight-chip" aria-pressed="false" data-mood="${esc(m)}">${esc(m)}</button>`)
    .join('');
  const syncChips = () => {
    const current = moodInput.value.trim().toLowerCase();
    moodsEl.querySelectorAll('.tonight-chip').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.mood.toLowerCase() === current));
    });
  };
  moodInput.value = prefs.mood;
  syncChips();
  moodsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.tonight-chip');
    if (!chip) return;
    const same = moodInput.value.trim().toLowerCase() === chip.dataset.mood.toLowerCase();
    moodInput.value = same ? '' : chip.dataset.mood;
    syncChips();
  });
  moodInput.addEventListener('input', syncChips);
  moodInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') goBtn.click(); });

  const showError = (message) => {
    results.innerHTML = `
      <div class="tonight-empty">
        <p>${esc(message)}</p>
        <button type="button" class="btn btn-ghost btn-sm" id="tonight-retry">Try again</button>
      </div>`;
    results.querySelector('#tonight-retry')?.addEventListener('click', () => run(false));
    moreEl.classList.add('hidden');
  };

  async function run(fresh) {
    if (state.loading) return;
    state.loading = true;
    const requestId = ++state.request;

    prefs.mood = moodInput.value.trim().slice(0, 60);
    savePrefs(window.localStorage, prefs);
    if (fresh) {
      state.page = 1;
      state.shown = [];
    }

    const activeBtn = fresh ? goBtn : againBtn;
    const label = fresh ? '🌙 Pick for tonight' : '↻ Different picks';
    setLoading(activeBtn, true);
    goBtn.disabled = true;
    againBtn.disabled = true;
    results.innerHTML = skeletons();

    try {
      const data = await aiApi.tonight(buildRequest({ ...prefs, page: state.page, shown: state.shown }));
      if (requestId !== state.request) return; // a newer request replaced this one

      if (!data.picks?.length) {
        showError('Nothing matched those filters. Try "Any length" or a different mood.');
        return;
      }
      state.shown.push(...data.picks.map(refOf));
      state.picks = new Map(data.picks.map((p) => [refOf(p), p]));
      const queued = queuedRefs();
      results.innerHTML = data.picks.map((p, i) => buildTonightCard(p, i, queued.has(refOf(p)))).join('');
      syncWatchlistButtons(results);
      moreEl.classList.remove('hidden');
      if (data.source === 'fallback') {
        showToast('The AI is busy, so these are top-rated matches for your filters.', 'info', 4500);
      }
    } catch (err) {
      if (requestId !== state.request) return;
      state.page = fresh ? 1 : Math.max(1, state.page - 1); // let "Different picks" retry the same page
      showError(err.message || 'Something went wrong. Please try again.');
      showToast(err.message || 'Could not get picks', 'error');
    } finally {
      state.loading = false;
      setLoading(activeBtn, false, label);
      goBtn.disabled = false;
      againBtn.disabled = false;
    }
  }

  // "+ Queue": send a pick straight into the Library queue
  results.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-queue-ref]');
    const pick = btn && !btn.disabled ? state.picks.get(btn.dataset.queueRef) : null;
    if (!pick) return;
    try {
      store.update((lib) => addToQueue(lib, pick));
      btn.textContent = 'In queue';
      btn.disabled = true;
      showToast(`Added ${pick.title} to your ${pick.mediaType === 'tv' ? 'TV' : 'film'} queue`, 'success');
    } catch (err) {
      showToast(err instanceof LibraryError ? err.message : 'Could not add to the queue', 'error');
    }
  });

  goBtn.addEventListener('click', () => run(true));
  againBtn.addEventListener('click', () => {
    state.page = nextPage(state.page);
    run(false);
  });
}
