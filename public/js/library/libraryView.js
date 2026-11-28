// public/js/library/libraryView.js — The Library screen: queues, diary and backup
import { esc, showToast } from '../ui.js';
import { getLibraryStore } from './instance.js';
import {
  LibraryError, TIMES_OF_DAY, addToQueue, removeFromQueue, moveInQueue, getQueue, logViewing, deleteDiaryEntry,
  diaryByMonth, suggestRewatch, stats, exportLibrary, parseImport, localDate, formatRating, sanitizeTitle,
  toggleEpisode, markUpTo, setSeasonInfo, watchingShows, showProgress, seasonProgress, updateDiaryEntry,
} from './libraryCore.js';

const imgUrl = (url) => (/^https:\/\/image\.tmdb\.org\//.test(url || '') ? esc(url) : '');
const tmdbLink = (item) => `https://www.themoviedb.org/${item.mediaType}/${item.id}`;
const thumb = (item) =>
  imgUrl(item.poster)
    ? `<img class="lib-thumb" src="${imgUrl(item.poster)}" alt="" loading="lazy">`
    : '<div class="lib-thumb lib-thumb--empty" aria-hidden="true">🎬</div>';
const ratingChip = (tenths) => (formatRating(tenths) ? `<span class="lib-rating">★ ${formatRating(tenths)}</span>` : '');

// ── Markup builders (pure, tested) ────────────────────────────────────────────
export function monthLabel(month, locale = 'en-US') {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function buildQueueRow(entry, index, total) {
  const { item } = entry;
  const title = esc(item.title);
  return `
    <li class="lib-row" draggable="true" data-ref="${esc(item.ref)}">
      <span class="lib-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
      <span class="lib-rank" aria-label="Position ${index + 1}">${index + 1}</span>
      ${thumb(item)}
      <div class="lib-row__main">
        <div class="lib-row__title">${title}${item.year ? ` <span class="lib-muted">(${esc(item.year)})</span>` : ''} ${ratingChip(item.rating)}</div>
        ${entry.note ? `<div class="lib-row__note">${esc(entry.note)}</div>` : ''}
      </div>
      <div class="lib-row__actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="up" aria-label="Move ${title} up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="down" aria-label="Move ${title} down" ${index === total - 1 ? 'disabled' : ''}>↓</button>
        ${item.mediaType === 'tv' ? '<button type="button" class="btn btn-secondary btn-sm" data-action="episodes">Episodes</button>' : ''}
        <button type="button" class="btn btn-secondary btn-sm" data-action="log">Log</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="remove" aria-label="Remove ${title} from queue">✕</button>
      </div>
    </li>`;
}

export function buildDiaryEntry(entry) {
  const { item, extras } = entry;
  const title = esc(item?.title || entry.ref);
  const bits = [extras.withWhom && `With ${esc(extras.withWhom)}`, extras.where && esc(extras.where), extras.timeOfDay && esc(extras.timeOfDay), extras.mood && `Mood: ${esc(extras.mood)}`].filter(Boolean);
  const day = entry.watchedOn.slice(8, 10);
  return `
    <li class="lib-row lib-row--diary" data-id="${esc(entry.id)}">
      <span class="lib-day" aria-label="${esc(entry.watchedOn)}">${esc(day)}</span>
      ${item ? thumb(item) : ''}
      <div class="lib-row__main">
        <div class="lib-row__title">${title}${item?.year ? ` <span class="lib-muted">(${esc(item.year)})</span>` : ''}
          ${ratingChip(entry.rating)} ${entry.rewatch ? '<span class="lib-badge">Rewatch</span>' : ''}</div>
        ${entry.review ? `<p class="lib-review">${esc(entry.review)}</p>` : ''}
        ${bits.length ? `<div class="lib-row__note">${bits.join(' · ')}</div>` : ''}
        ${extras.notes ? `<details class="lib-notes"><summary>Private notes</summary><p>${esc(extras.notes)}</p></details>` : ''}
      </div>
      <div class="lib-row__actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="edit-entry" aria-label="Edit this diary entry for ${title}">Edit</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="delete-entry" aria-label="Delete this diary entry for ${title}">✕</button>
      </div>
    </li>`;
}

export function buildSearchResult(info, inQueue) {
  return `
    <li class="lib-result" data-ref="${esc(info.ref)}">
      ${thumb(info)}
      <div class="lib-row__main"><div class="lib-row__title">${esc(info.title)}${info.year ? ` <span class="lib-muted">(${esc(info.year)})</span>` : ''}</div></div>
      <div class="lib-row__actions">
        <button type="button" class="btn btn-secondary btn-sm" data-action="queue" ${inQueue ? 'disabled' : ''}>${inQueue ? 'In queue' : '+ Queue'}</button>
        ${info.mediaType === 'tv' ? '<button type="button" class="btn btn-secondary btn-sm" data-action="episodes">Episodes</button>' : ''}
        <button type="button" class="btn btn-primary btn-sm" data-action="log">Log</button>
      </div>
    </li>`;
}

// The log / edit form. With `entry` it is prefilled for editing.
export function buildLogForm({ info, entry = null, rewatch = false, today, tomorrow }) {
  const e = entry;
  const x = e?.extras || {};
  const rating = e && e.rating ? (e.rating / 10).toFixed(1) : '';
  const hasExtras = Boolean(x.withWhom || x.where || x.mood || x.timeOfDay || x.notes);
  return `
      <form class="lib-form" id="lib-log-form" novalidate>
        <h3 class="lib-h3">${e ? 'Edit' : 'Log'}: ${esc(info.title)}${info.year ? ` (${esc(info.year)})` : ''}</h3>
        <div class="lib-form__grid">
          <label class="lib-field"><span>Date watched</span>
            <input type="date" class="input-field" name="watchedOn" value="${esc(e ? e.watchedOn : today)}" max="${esc(tomorrow)}"></label>
          <div class="lib-field"><span>Rating <output id="lib-rating-out">${rating || 'no rating'}</output></span>
            <div class="lib-rating-row">
              <input type="range" name="ratingRange" min="0.1" max="10" step="0.1" value="${rating || '5'}" aria-label="Rating out of 10">
              <input type="number" class="input-field" name="rating" min="0.1" max="10" step="0.1" value="${rating}" placeholder="–" aria-label="Rating number">
              <button type="button" class="btn btn-ghost btn-sm" data-action="clear-rating">Clear</button>
            </div></div>
        </div>
        <label class="lib-check"><input type="checkbox" name="rewatch" ${(e ? e.rewatch : rewatch) ? 'checked' : ''}> Rewatch</label>
        <label class="lib-field"><span>Review <span class="lib-muted">(optional)</span></span>
          <textarea class="input-field" name="review" rows="3" maxlength="4000" placeholder="A few words, or a lot">${esc(e?.review || '')}</textarea></label>
        <details class="lib-details" ${hasExtras ? 'open' : ''}><summary>More details (private)</summary>
          <div class="lib-form__grid">
            <label class="lib-field"><span>Who with</span><input class="input-field" name="withWhom" maxlength="80" value="${esc(x.withWhom || '')}"></label>
            <label class="lib-field"><span>Where</span><input class="input-field" name="where" maxlength="80" value="${esc(x.where || '')}"></label>
            <label class="lib-field"><span>Mood</span><input class="input-field" name="mood" maxlength="40" value="${esc(x.mood || '')}"></label>
            <label class="lib-field"><span>Time of day</span>
              <select class="input-field" name="timeOfDay"><option value="">–</option>${TIMES_OF_DAY.map((t) => `<option ${x.timeOfDay === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          </div>
          <label class="lib-field"><span>Notes</span><textarea class="input-field" name="notes" rows="2" maxlength="1000">${esc(x.notes || '')}</textarea></label>
        </details>
        <div class="lib-form__actions">
          <button type="submit" class="btn btn-primary">${e ? 'Save changes' : 'Save to diary'}</button>
          <button type="button" class="btn btn-ghost" data-action="cancel-log">Cancel</button>
        </div>
      </form>`;
}

export function progressText(progress) {
  if (!progress.watched) return 'Not started';
  const base = progress.total ? `${progress.watched} of ${progress.total} watched` : `${progress.watched} watched`;
  return progress.next ? `${base} · Next: S${progress.next.season}E${progress.next.episode}` : base;
}

// A show you are currently watching
export function buildShelfRow({ item, progress }) {
  const title = esc(item.title);
  return `
    <li class="lib-row" data-ref="${esc(item.ref)}">
      ${thumb(item)}
      <div class="lib-row__main">
        <div class="lib-row__title">${title}${item.year ? ` <span class="lib-muted">(${esc(item.year)})</span>` : ''} ${ratingChip(item.rating)}</div>
        <div class="lib-row__note">${esc(progressText(progress))}</div>
      </div>
      <div class="lib-row__actions">
        <button type="button" class="btn btn-secondary btn-sm" data-action="episodes">Episodes</button>
        <button type="button" class="btn btn-secondary btn-sm" data-action="log">Log</button>
      </div>
    </li>`;
}

// Spoiler Shield: titles and summaries of unwatched episodes stay hidden until watched or revealed
export function buildEpisodeRow(ep, { watched = false, revealed = false, isNext = false } = {}) {
  const shown = watched || revealed;
  const n = Number(ep.episodeNumber);
  const meta = [ep.airDate && esc(ep.airDate), ep.runtime && `${esc(ep.runtime)} min`].filter(Boolean).join(' · ');
  return `
    <li class="lib-ep ${watched ? 'lib-ep--watched' : ''} ${isNext ? 'lib-ep--next' : ''}" data-episode="${n}">
      <label class="lib-ep__check">
        <input type="checkbox" data-action="toggle-episode" ${watched ? 'checked' : ''} aria-label="Mark episode ${n} as watched">
        <span class="lib-ep__num">E${n}</span>
      </label>
      <div class="lib-row__main">
        <div class="lib-row__title">${shown && ep.name ? esc(ep.name) : `Episode ${n}`} ${isNext ? '<span class="lib-badge">Next up</span>' : ''}</div>
        ${meta ? `<div class="lib-row__note">${meta}</div>` : ''}
        ${shown && ep.overview ? `<p class="lib-ep__overview">${esc(ep.overview)}</p>` : ''}
      </div>
      <div class="lib-row__actions">
        ${shown ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-action="reveal-episode">Show title</button>'}
        <button type="button" class="btn btn-ghost btn-sm" data-action="up-to" aria-label="Mark everything up to episode ${n} as watched">Up to here</button>
      </div>
    </li>`;
}

export function buildStats(s) {
  const max = Math.max(1, ...s.distribution);
  return `
    <div class="lib-stats">
      <div class="lib-stat"><strong>${s.watched}</strong><span>watched</span></div>
      <div class="lib-stat"><strong>${s.averageRating === null ? '–' : s.averageRating.toFixed(1)}</strong><span>average rating</span></div>
      <div class="lib-stat"><strong>${s.logsThisYear}</strong><span>logged this year</span></div>
      <div class="lib-stat"><strong>${s.queueSizes.movie + s.queueSizes.tv}</strong><span>in queues</span></div>
    </div>
    <h3 class="lib-h3">Your ratings</h3>
    <div class="lib-bars" role="img" aria-label="Rating distribution">
      ${s.distribution.map((c, i) => `<div class="lib-bar"><div class="lib-bar__fill" style="height:${Math.round((c / max) * 100)}%"></div><span>${i + 1}</span></div>`).join('')}
    </div>`;
}

// ── Screen ────────────────────────────────────────────────────────────────────
export function initLibrary(root) {
  const $ = (sel) => root.querySelector(sel);
  const tabsEl = $('#lib-tabs');
  const panel = $('#lib-panel');
  const logEl = $('#lib-log');
  const resultsEl = $('#lib-results');
  const searchEl = $('#lib-search');
  const searchTypeEl = $('#lib-search-type');
  const statusEl = $('#lib-status');
  if (!tabsEl || !panel || !logEl || !resultsEl || !searchEl || !searchTypeEl) return;

  const store = getLibraryStore();
  const state = { tab: 'movie', searchType: 'movie', results: new Map(), logging: null, editing: null, episodes: null };

  const fail = (err) => showToast(err instanceof LibraryError ? err.message : 'Something went wrong. Please try again.', 'error');
  const act = (fn) => {
    try {
      return store.update(fn);
    } catch (err) {
      fail(err);
      return null;
    }
  };

  // Tabs
  const TABS = [['movie', 'Films'], ['tv', 'TV'], ['diary', 'Diary'], ['backup', 'Backup']];
  function renderTabs() {
    const lib = store.get();
    const counts = { movie: lib.queue.movie.length, tv: lib.queue.tv.length, diary: lib.diary.length };
    tabsEl.innerHTML = TABS.map(([id, label]) =>
      `<button type="button" role="tab" class="lib-tab" data-tab="${id}" aria-selected="${state.tab === id}">${label}${id in counts ? ` <span class="lib-count">${counts[id]}</span>` : ''}</button>`
    ).join('');
  }
  tabsEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.lib-tab');
    if (!tab) return;
    state.tab = tab.dataset.tab;
    render();
  });

  // Search-in toggle
  searchTypeEl.innerHTML = [['movie', 'Films'], ['tv', 'TV']]
    .map(([v, l]) => `<button type="button" role="radio" class="lib-seg" data-type="${v}" aria-checked="${v === state.searchType}">${l}</button>`)
    .join('');
  searchTypeEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.lib-seg');
    if (!btn) return;
    state.searchType = btn.dataset.type;
    searchTypeEl.querySelectorAll('.lib-seg').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
    runSearch();
  });

  // Search
  let searchTimer = null;
  let searchController = null;
  async function runSearch() {
    const q = searchEl.value.trim();
    if (searchController) searchController.abort();
    if (q.length < 2) {
      resultsEl.innerHTML = '';
      return;
    }
    searchController = new AbortController();
    const type = state.searchType;
    resultsEl.innerHTML = '<p class="lib-muted">Searching…</p>';
    try {
      const res = await fetch(`${type === 'tv' ? '/api/tv/search' : '/api/movies/search'}?q=${encodeURIComponent(q)}`, { signal: searchController.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      const list = (type === 'tv' ? data.shows : data.movies) || [];
      state.results = new Map();
      const infos = [];
      for (const raw of list.slice(0, 8)) {
        try {
          const info = sanitizeTitle({ ...raw, mediaType: type });
          state.results.set(info.ref, info);
          infos.push(info);
        } catch { /* skip malformed results */ }
      }
      renderResults(infos);
    } catch (err) {
      if (err.name === 'AbortError') return;
      resultsEl.innerHTML = `<p class="lib-muted">${esc(err.message || 'Search failed')}</p>`;
    }
  }
  function renderResults(infos = [...state.results.values()]) {
    if (!infos.length) {
      resultsEl.innerHTML = searchEl.value.trim().length >= 2 ? '<p class="lib-muted">No matches.</p>' : '';
      return;
    }
    const queued = new Set([...store.get().queue.movie, ...store.get().queue.tv].map((q) => q.ref));
    resultsEl.innerHTML = `<ul class="lib-list">${infos.map((i) => buildSearchResult(i, queued.has(i.ref))).join('')}</ul>`;
  }
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 350);
  });
  resultsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    const info = state.results.get(btn?.closest('.lib-result')?.dataset.ref);
    if (!btn || !info) return;
    if (btn.dataset.action === 'queue') {
      if (act((lib) => addToQueue(lib, info))) showToast(`Added ${info.title} to your ${info.mediaType === 'tv' ? 'TV' : 'film'} queue`, 'success');
    } else if (btn.dataset.action === 'episodes') {
      openEpisodes(info);
    } else {
      openLogForm(info);
    }
  });

  // Log form
  function openLogForm(info, entry = null) {
    state.logging = info;
    state.editing = entry ? entry.id : null;
    logEl.classList.remove('hidden');
    logEl.innerHTML = buildLogForm({
      info,
      entry,
      rewatch: suggestRewatch(store.get(), info.ref),
      today: localDate(),
      tomorrow: localDate(new Date(Date.now() + 86400000)),
    });
    logEl.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    logEl.querySelector('[name="watchedOn"]')?.focus();
  }
  const closeLogForm = () => {
    state.logging = null;
    state.editing = null;
    logEl.classList.add('hidden');
    logEl.innerHTML = '';
  };
  logEl.addEventListener('input', (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    const out = form.querySelector('#lib-rating-out');
    if (e.target.name === 'ratingRange') {
      form.rating.value = Number(e.target.value).toFixed(1);
    } else if (e.target.name === 'rating' && e.target.value !== '') {
      form.ratingRange.value = e.target.value;
    }
    out.textContent = form.rating.value === '' ? 'no rating' : Number(form.rating.value).toFixed(1);
  });
  logEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'cancel-log') closeLogForm();
    if (btn.dataset.action === 'clear-rating') {
      const form = btn.closest('form');
      form.rating.value = '';
      form.querySelector('#lib-rating-out').textContent = 'no rating';
    }
  });
  logEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const info = state.logging;
    if (!info) return;
    const entry = {
      watchedOn: f.watchedOn.value,
      rating: f.rating.value,
      rewatch: f.rewatch.checked,
      review: f.review.value,
      extras: { withWhom: f.withWhom.value, where: f.where.value, mood: f.mood.value, timeOfDay: f.timeOfDay.value, notes: f.notes.value },
    };
    const editingId = state.editing;
    const saved = editingId ? act((lib) => updateDiaryEntry(lib, editingId, entry)) : act((lib) => logViewing(lib, info, entry));
    if (saved) {
      showToast(`${editingId ? 'Updated' : 'Logged'} ${info.title}`, 'success');
      closeLogForm();
    }
  });

  // Queue and diary actions (delegated)
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const row = btn.closest('[data-ref], [data-id]');
    const lib = store.get();
    switch (btn.dataset.action) {
      case 'up':
      case 'down': {
        const ref = row.dataset.ref;
        const list = lib.queue[state.tab];
        const i = list.findIndex((q) => q.ref === ref);
        act((l) => moveInQueue(l, state.tab, ref, btn.dataset.action === 'up' ? i - 1 : i + 1));
        break;
      }
      case 'remove':
        act((l) => removeFromQueue(l, row.dataset.ref));
        break;
      case 'log': {
        const item = lib.items[row.dataset.ref];
        if (item) openLogForm(item);
        break;
      }
      case 'edit-entry': {
        const entry = lib.diary.find((x) => x.id === row.dataset.id);
        const item = entry && lib.items[entry.ref];
        if (entry && item) openLogForm(item, entry);
        break;
      }
      case 'delete-entry':
        if (window.confirm('Delete this diary entry? The title stays in your library.')) act((l) => deleteDiaryEntry(l, row.dataset.id));
        break;
      case 'episodes': {
        const item = lib.items[row.dataset.ref];
        if (item) openEpisodes(item);
        break;
      }
      case 'close-episodes':
        state.episodes = null;
        render();
        break;
      case 'reveal-episode': {
        const li = btn.closest('[data-episode]');
        if (state.episodes && li) {
          state.episodes.revealed.add(`${state.episodes.seasonNumber}:${li.dataset.episode}`);
          render();
        }
        break;
      }
      case 'up-to': {
        const li = btn.closest('[data-episode]');
        const ep = state.episodes;
        if (ep && li) act((l) => markUpTo(l, ep.info, ep.seasonNumber, Number(li.dataset.episode), { seasons: seasonCounts() }));
        break;
      }
      case 'export': {
        const blob = new Blob([exportLibrary(lib)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `cinemind-library-${localDate()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        break;
      }
      default:
        break;
    }
  });

  // Drag to reorder (the arrow buttons cover keyboards and touch)
  let dragRef = null;
  panel.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('.lib-row[data-ref]');
    if (!row) return;
    dragRef = row.dataset.ref;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragRef);
    row.classList.add('lib-row--dragging');
  });
  panel.addEventListener('dragover', (e) => {
    if (dragRef && e.target.closest('.lib-row[data-ref]')) e.preventDefault();
  });
  panel.addEventListener('drop', (e) => {
    const row = e.target.closest('.lib-row[data-ref]');
    if (!dragRef || !row) return;
    e.preventDefault();
    const list = store.get().queue[state.tab];
    const to = list.findIndex((q) => q.ref === row.dataset.ref);
    const ref = dragRef;
    dragRef = null;
    if (to !== -1) act((l) => moveInQueue(l, state.tab, ref, to));
  });
  panel.addEventListener('dragend', () => {
    dragRef = null;
    panel.querySelectorAll('.lib-row--dragging').forEach((r) => r.classList.remove('lib-row--dragging'));
  });

  // TV episodes
  const seasonCounts = () =>
    (state.episodes?.show?.seasons || []).map((x) => ({ seasonNumber: x.seasonNumber, episodeCount: x.episodeCount }));

  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not load episodes');
    return data;
  }

  async function openEpisodes(info) {
    state.tab = 'tv';
    const ep = { info, show: null, seasonNumber: null, season: null, loading: true, error: '', revealed: new Set() };
    state.episodes = ep;
    render();
    try {
      const show = await getJson(`/api/tv/${encodeURIComponent(info.id)}`);
      if (state.episodes !== ep) return;
      ep.show = { seasons: (show.seasons || []).filter((x) => x.seasonNumber >= 1 && x.episodeCount > 0) };
      if (!ep.show.seasons.length) throw new Error('There is no episode data for this show yet.');
      const synced = setSeasonInfo(store.get(), info.ref, seasonCounts());
      if (synced !== store.get()) store.replace(synced);
      const next = showProgress(store.get(), info.ref).next;
      const start = next && ep.show.seasons.some((x) => x.seasonNumber === next.season) ? next.season : ep.show.seasons[0].seasonNumber;
      await loadSeason(start);
    } catch (err) {
      if (state.episodes !== ep) return;
      ep.error = err.message || 'Could not load episodes';
      ep.loading = false;
      render();
    }
  }

  async function loadSeason(number) {
    const ep = state.episodes;
    if (!ep) return;
    ep.seasonNumber = number;
    ep.loading = true;
    ep.error = '';
    ep.season = null;
    render();
    try {
      const season = await getJson(`/api/tv/${encodeURIComponent(ep.info.id)}/seasons/${number}`);
      if (state.episodes !== ep || ep.seasonNumber !== number) return;
      ep.season = season;
    } catch (err) {
      if (state.episodes !== ep) return;
      ep.error = err.message || 'Could not load this season';
    }
    ep.loading = false;
    render();
  }

  panel.addEventListener('change', (e) => {
    const ep = state.episodes;
    if (!ep) return;
    if (e.target.id === 'lib-season-select') {
      loadSeason(Number(e.target.value));
    } else if (e.target.matches('input[data-action="toggle-episode"]')) {
      const li = e.target.closest('[data-episode]');
      const ok = act((l) => toggleEpisode(l, ep.info, ep.seasonNumber, Number(li.dataset.episode), e.target.checked, { seasons: seasonCounts() }));
      if (!ok) e.target.checked = !e.target.checked;
    }
  });

  function renderEpisodes() {
    const ep = state.episodes;
    if (!ep) return '';
    const head = `<div class="lib-episodes__head"><h3 class="lib-h3">${esc(ep.info.title)}: episodes</h3>
      <button type="button" class="btn btn-ghost btn-sm" data-action="close-episodes">Close</button></div>`;
    if (ep.error) return `<section class="lib-episodes">${head}<p class="lib-muted">${esc(ep.error)}</p></section>`;
    if (!ep.show) return `<section class="lib-episodes">${head}<p class="lib-muted">Loading…</p></section>`;
    const lib = store.get();
    const progress = showProgress(lib, ep.info.ref);
    const sp = seasonProgress(lib, ep.info.ref, ep.seasonNumber);
    const options = ep.show.seasons
      .map((x) => `<option value="${x.seasonNumber}" ${x.seasonNumber === ep.seasonNumber ? 'selected' : ''}>${esc(x.name || `Season ${x.seasonNumber}`)} (${x.episodeCount})</option>`)
      .join('');
    const watched = new Set(lib.episodes[ep.info.ref]?.seasons[ep.seasonNumber]?.watched || []);
    const list = ep.loading || !ep.season
      ? '<p class="lib-muted">Loading episodes…</p>'
      : `<ul class="lib-list">${ep.season.episodes
          .map((e) => buildEpisodeRow(e, {
            watched: watched.has(e.episodeNumber),
            revealed: ep.revealed.has(`${ep.seasonNumber}:${e.episodeNumber}`),
            isNext: progress.next?.season === ep.seasonNumber && progress.next?.episode === e.episodeNumber,
          }))
          .join('')}</ul>`;
    return `<section class="lib-episodes" aria-label="Episodes of ${esc(ep.info.title)}">${head}
      <div class="lib-episodes__controls">
        <label class="lib-field"><span>Season</span><select class="input-field" id="lib-season-select">${options}</select></label>
        <span class="lib-muted">${esc(progressText(progress))} · This season: ${sp.watched}${sp.count ? ` of ${sp.count}` : ''}</span>
      </div>
      <p class="lib-muted body-sm">Spoiler Shield: titles and summaries of unwatched episodes are hidden. Tap "Show title" to reveal one.</p>
      ${list}</section>`;
  }

  // Backup: import
  panel.addEventListener('change', async (e) => {
    if (e.target.id !== 'lib-import-file') return;
    const file = e.target.files?.[0];
    const msg = panel.querySelector('#lib-import-msg');
    if (!file) return;
    try {
      const { library, dropped } = parseImport(await file.text());
      const replace = panel.querySelector('input[name="import-mode"]:checked')?.value === 'replace';
      if (replace && !window.confirm('Replace your whole library with this file? Your current library will be lost. Export it first if unsure.')) {
        e.target.value = '';
        return;
      }
      if (replace) store.replace(library);
      else store.merge(library);
      msg.textContent = `Imported ${Object.keys(library.items).length} titles and ${library.diary.length} diary entries${dropped ? ` (${dropped} invalid records skipped)` : ''}.`;
    } catch (err) {
      msg.textContent = err instanceof LibraryError ? err.message : 'Could not read that file.';
    }
    e.target.value = '';
  });

  // Rendering
  function renderPanel() {
    const lib = store.get();
    if (state.tab === 'movie' || state.tab === 'tv') {
      const queue = getQueue(lib, state.tab);
      const label = state.tab === 'tv' ? 'TV' : 'film';
      const shelf = state.tab === 'tv' ? watchingShows(lib) : [];
      const shelfHtml = shelf.length
        ? `<h3 class="lib-h3">Watching</h3><ul class="lib-list">${shelf.map(buildShelfRow).join('')}</ul><h3 class="lib-h3">Queue</h3>`
        : '';
      const queueHtml = queue.length
        ? `<p class="lib-muted lib-hint">Your ${label} queue, in the order you intend to watch. Drag rows, or use the arrows.</p>
           <ol class="lib-list">${queue.map((q, i) => buildQueueRow(q, i, queue.length)).join('')}</ol>`
        : `<div class="lib-empty"><p>Your ${label} queue is empty.</p><p class="lib-muted">Search above, or let Tonight suggest something.</p>
           <button type="button" class="btn btn-secondary btn-sm" data-goto="tonight">Open Tonight</button></div>`;
      panel.innerHTML = (state.tab === 'tv' ? renderEpisodes() : '') + shelfHtml + queueHtml;
    } else if (state.tab === 'diary') {
      const groups = diaryByMonth(lib);
      panel.innerHTML = groups.length
        ? groups.map((g) => `<h3 class="lib-h3">${esc(monthLabel(g.month, navigator.language))}</h3><ul class="lib-list">${g.entries.map(buildDiaryEntry).join('')}</ul>`).join('')
        : '<div class="lib-empty"><p>Your diary is empty.</p><p class="lib-muted">Search for a title above and tap Log.</p></div>';
    } else {
      panel.innerHTML = `
        ${buildStats(stats(lib))}
        <h3 class="lib-h3">Backup</h3>
        <p class="lib-muted">Your library lives in this browser only. Export it regularly: clearing browser data deletes it.</p>
        <button type="button" class="btn btn-secondary" data-action="export">Export JSON</button>
        <div class="lib-import">
          <label class="lib-field"><span>Import a Cinemind export</span><input type="file" id="lib-import-file" accept="application/json,.json"></label>
          <label class="lib-check"><input type="radio" name="import-mode" value="merge" checked> Merge with my library</label>
          <label class="lib-check"><input type="radio" name="import-mode" value="replace"> Replace my library</label>
          <p class="lib-muted" id="lib-import-msg" role="status"></p>
        </div>`;
    }
  }
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-goto="tonight"]')) document.querySelector('[data-section="tonight"]')?.click();
  });

  function renderStatus() {
    const s = store.status();
    statusEl.textContent = s.error || (s.recoveredFromCorruption ? 'Some saved library data was unreadable. A copy was kept in browser storage under "cinemind_library_v1_corrupt_backup".' : '');
  }

  function render() {
    renderTabs();
    renderPanel();
    renderResults();
    renderStatus();
  }
  store.subscribe(render);
  render();
}

