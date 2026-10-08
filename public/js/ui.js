// public/js/ui.js — Shared UI building blocks

// ── Escaping (every piece of API/user text must go through this before innerHTML)
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow http(s) image URLs
const safeUrl = (url) => (/^https?:\/\//i.test(url || '') ? esc(url) : '');

const STAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

// ── Toast notifications ───────────────────────────────────────────────────────
let toastContainer = null;

export function showToast(message, type = 'info', duration = 3000) {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('role', 'status');
    toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastContainer);
  }

  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = document.createElement('span');
  icon.style.fontSize = '1rem';
  icon.textContent = icons[type] || icons.info;
  toast.append(icon, ' ', document.createTextNode(message)); // text node: no HTML injection

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove());
    setTimeout(() => toast.remove(), 600); // fallback if animations are disabled
  }, duration);
}

// ── Skeleton loaders ──────────────────────────────────────────────────────────
export function createMovieCardSkeleton() {
  return '<div class="skeleton skeleton-card"></div>';
}

export function createRecCardSkeleton() {
  return `
    <div class="rec-card" style="pointer-events:none">
      <div class="skeleton" style="width:140px;aspect-ratio:2/3"></div>
      <div class="rec-card__body">
        <div class="skeleton skeleton-line" style="width:60%"></div>
        <div class="skeleton skeleton-line short"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
    </div>`;
}

export function showSkeletons(container, count, type = 'card') {
  container.innerHTML = Array(count)
    .fill(type === 'rec' ? createRecCardSkeleton() : createMovieCardSkeleton())
    .join('');
}

// ── Movie data helpers ────────────────────────────────────────────────────────
// Compact movie payload stored on card elements (read back by the delegated handlers)
const cardData = (m) => esc(JSON.stringify({
  id: m.id,
  title: m.title,
  poster: m.poster || null,
  rating: m.rating ?? 0,
  releaseYear: m.releaseYear || m.year || '',
  genres: m.genres || [],
}));

export function readCardMovie(el) {
  try {
    return JSON.parse(el.dataset.movie);
  } catch {
    return null;
  }
}

const formatRating = (r) => (typeof r === 'number' && r > 0 ? r.toFixed(1) : '—');

// ── Movie card builder ────────────────────────────────────────────────────────
export function buildMovieCard(movie, options = {}) {
  const { showAddToWatchlist = true } = options;
  const poster = safeUrl(movie.poster);
  const title = esc(movie.title);
  const year = esc(movie.releaseYear || movie.year || '—');
  const id = esc(movie.id ?? '');

  return `
    <div class="movie-card" data-movie-id="${id}" data-movie="${cardData(movie)}"
         tabindex="0" role="button" aria-label="${title}">
      ${poster
        ? `<img class="movie-card__poster" src="${poster}" alt="${title}" loading="lazy">`
        : ''}
      <div class="movie-card__placeholder" style="${poster ? 'display:none' : ''}">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="20" height="20" rx="3"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M17 7h5M2 17h5M17 17h5"/>
        </svg>
        <span>${title}</span>
      </div>
      <div class="movie-card__overlay"></div>
      <div class="movie-card__info">
        <div class="movie-card__title">${title}</div>
        <div class="movie-card__meta">
          <span class="movie-card__rating">${STAR_SVG} ${formatRating(movie.rating)}</span>
          <span>${year}</span>
        </div>
      </div>
      ${showAddToWatchlist && movie.id != null ? `
        <div class="movie-card__actions">
          <button class="btn-icon watchlist-toggle" data-movie-id="${id}" aria-label="Toggle watchlist">🤍</button>
          <button class="btn-icon movie-info-btn" data-movie-id="${id}" aria-label="More info" title="More info">ℹ</button>
        </div>` : ''}
    </div>`;
}

// ── Recommendation card builder ───────────────────────────────────────────────
export function buildRecCard(rec, index = 0) {
  const poster = safeUrl(rec.poster);
  const title = esc(rec.title);
  const genres = (rec.genres || []).slice(0, 3);
  const themes = (rec.themes || []).slice(0, 3);
  const reasons = (rec.matchReasons || []).slice(0, 2);
  const confidence = Math.max(0, Math.min(100, Math.round(Number(rec.confidenceScore) || 85)));
  const year = rec.year || rec.releaseYear;
  const hasId = rec.id != null;

  return `
    <div class="rec-card animate-slide-up ${hasId ? 'rec-card--clickable' : ''}"
         style="animation-delay:${index * 0.08}s"
         data-movie-id="${esc(rec.id ?? '')}" data-title="${title}"
         ${hasId ? `data-movie="${cardData(rec)}"` : ''}>
      ${poster
        ? `<img class="rec-card__poster" src="${poster}" alt="${title}" loading="lazy">`
        : `<div class="rec-card__poster" style="background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.75rem;padding:8px;text-align:center">${title}</div>`}
      <div class="rec-card__body">
        ${hasId ? `<button class="btn-icon watchlist-toggle rec-card__heart" data-movie-id="${esc(rec.id)}" aria-label="Toggle watchlist">🤍</button>` : ''}
        <div>
          <div class="rec-card__title">${title} ${year ? `<span style="font-weight:400;color:var(--text-muted);font-size:0.875rem">(${esc(year)})</span>` : ''}</div>
          <div class="rec-card__meta">
            ${rec.rating ? `<span class="rating">${STAR_SVG.replace('<svg', '<svg style="width:13px;height:13px;fill:currentColor"')}${formatRating(rec.rating)}</span>` : ''}
            ${genres.map((g) => `<span class="tag">${esc(g)}</span>`).join('')}
          </div>
        </div>
        <p class="rec-card__explanation">${esc(rec.explanation || rec.whyWatch || '')}</p>
        ${reasons.length ? `<ul class="rec-card__reasons">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        ${themes.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${themes.map((t) => `<span class="tag tag-red">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="rec-card__score">
          <span class="rec-card__ai-badge">✦ AI Match</span>
          <div class="rec-card__score-bar">
            <div class="rec-card__score-fill" style="width:0%" data-target="${confidence}"></div>
          </div>
          <span>${confidence}%</span>
        </div>
      </div>
    </div>`;
}

export function animateScoreBars(container) {
  requestAnimationFrame(() => setTimeout(() => {
    container.querySelectorAll('.rec-card__score-fill').forEach((bar) => {
      bar.style.width = `${bar.dataset.target}%`;
    });
  }, 150));
}

// ── Modal ─────────────────────────────────────────────────────────────────────
let lastFocus = null;

export function openModal(title, contentHtml) {
  let backdrop = document.getElementById('global-modal');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'global-modal';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-header">
          <h2 class="heading-lg" id="modal-title"></h2>
          <button class="btn-icon" id="modal-close" aria-label="Close">✕</button>
        </div>
        <div class="modal-body" id="modal-body"></div>
      </div>`;
    document.body.appendChild(backdrop);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  }

  if (!backdrop.classList.contains('open')) lastFocus = document.activeElement;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = contentHtml;
  document.querySelector('#global-modal .modal').scrollTop = 0;
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('modal-close').focus();
}

export function closeModal() {
  const backdrop = document.getElementById('global-modal');
  if (!backdrop?.classList.contains('open')) return;
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
  lastFocus?.focus?.();
}

// ── Movie detail modal body ───────────────────────────────────────────────────
export function buildMovieModal(movie) {
  const genres = (movie.genres || []).join(', ') || 'Unknown';
  const poster = safeUrl(movie.poster);
  const backdrop = safeUrl(movie.backdrop);
  const title = esc(movie.title);
  const facts = [
    movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : '',
    movie.director ? `Directed by ${esc(movie.director)}` : '',
  ].filter(Boolean);

  return `
    ${backdrop ? `<img src="${backdrop}" alt="" class="modal-backdrop-img">` : ''}
    <div class="modal-movie">
      ${poster
        ? `<img src="${poster}" alt="${title}" class="modal-movie__poster">`
        : '<div class="modal-movie__poster" style="background:var(--bg-elevated)"></div>'}
      <div>
        <h2 style="font-size:1.5rem;margin-bottom:4px">${title}</h2>
        ${movie.tagline ? `<p class="text-muted body-sm" style="font-style:italic;margin-bottom:8px">${esc(movie.tagline)}</p>` : ''}
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
          <span class="rating">${STAR_SVG.replace('<svg', '<svg style="width:14px;height:14px;fill:currentColor"')}${formatRating(movie.rating)}</span>
          <span class="tag">${esc(movie.releaseYear || '—')}</span>
          <span class="text-secondary">${esc(genres)}</span>
        </div>
        ${facts.length ? `<p class="text-muted body-sm" style="margin-bottom:12px">${facts.join(' · ')}</p>` : ''}
        <p style="color:var(--text-secondary);font-size:0.9375rem;line-height:1.7">${esc(movie.overview || 'No overview available.')}</p>
        ${movie.cast?.length ? `<p class="text-muted body-sm" style="margin-top:12px"><strong>Cast:</strong> ${movie.cast.map(esc).join(', ')}</p>` : ''}
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm watchlist-toggle-modal"
                  data-movie-id="${esc(movie.id)}" data-movie="${cardData(movie)}">❤ Add to Watchlist</button>
          ${movie.trailerUrl && /^https:\/\/www\.youtube\.com\//.test(movie.trailerUrl)
            ? `<a class="btn btn-secondary btn-sm" href="${esc(movie.trailerUrl)}" target="_blank" rel="noopener noreferrer">▶ Trailer</a>`
            : ''}
        </div>
      </div>
    </div>`;
}

// ── Loading state helper ──────────────────────────────────────────────────────
export function setLoading(button, isLoading, originalText = '') {
  if (isLoading) {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.innerHTML = '<span class="spinner"></span> Processing...';
  } else {
    button.disabled = false;
    button.textContent = originalText || button.dataset.originalText || 'Submit';
  }
}

// ── Tag input component ───────────────────────────────────────────────────────
export function initTagInput(containerId, onChange) {
  const container = document.getElementById(containerId);
  const input = container?.querySelector('input');
  if (!container || !input) return null;

  const tags = new Map(); // value -> element
  const emit = () => onChange([...tags.keys()]);

  function removeTag(value) {
    tags.get(value)?.remove();
    tags.delete(value);
    emit();
  }

  function addTag(raw) {
    const value = raw.trim().replace(/,$/, '').trim().slice(0, 80);
    input.value = '';
    if (!value || tags.has(value) || tags.size >= 10) return;

    const el = document.createElement('span');
    el.className = 'tag-item';
    el.append(document.createTextNode(`${value} `));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Remove ${value}`);
    btn.textContent = '×';
    btn.addEventListener('click', () => removeTag(value));
    el.appendChild(btn);

    container.insertBefore(el, input);
    tags.set(value, el);
    emit();
  }

  input.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
      e.preventDefault();
      addTag(input.value);
    } else if (e.key === 'Backspace' && !input.value && tags.size) {
      removeTag([...tags.keys()].pop());
    }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) addTag(input.value); });

  return {
    getTags: () => [...tags.keys()],
    clear() {
      tags.forEach((el) => el.remove());
      tags.clear();
      emit();
    },
  };
}

// ── Chat text: escape first, then apply a tiny safe subset of markdown ───────
export function formatChatText(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}
