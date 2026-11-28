// public/js/diary/diary.js — Viewing Diary section
import { diaryApi } from '../api.js';
import { buildMovieCard, showToast, esc, openModal, buildMovieModal, buildTvModal } from '../ui.js';
import { moviesApi, tvApi } from '../api.js';
import { syncWatchlistButtons } from '../watchlist.js';

const ITEMS_PER_PAGE = 20;
let currentPage = 1;
let isLoading = false;

export async function initDiary(sectionEl) {
  const list = sectionEl.querySelector('#diary-list');
  const empty = sectionEl.querySelector('#diary-empty');
  const addBtn = sectionEl.querySelector('#diary-add-btn');

  // Load initial data
  await loadDiary(list, empty);

  // Event listeners
  addBtn?.addEventListener('click', () => openDiaryModal());

  // Load more on scroll (simple approach - could be enhanced with IntersectionObserver)
  window.addEventListener('scroll', debounce(() => {
    if (isNearBottom() && !isLoading) {
      currentPage++;
      loadDiary(list, empty, true);
    }
  }, 200));
}

async function loadDiary(list, empty, append = false) {
  if (isLoading) return;
  isLoading = true;

  if (!append) {
    list.innerHTML = Array(5).fill('<div class="skeleton skeleton-card"></div>').join('');
  }

  try {
    const params = {
      page: currentPage,
      limit: ITEMS_PER_PAGE,
    };

    const data = await diaryApi.get(params);
    const entries = data.entries || [];

    if (!append) list.innerHTML = '';

    if (entries.length === 0 && currentPage === 1) {
      list.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }

    empty?.classList.add('hidden');

    entries.forEach(entry => {
      const item = createDiaryItem(entry);
      list.appendChild(item);
    });

    syncWatchlistButtons(list);
  } catch (err) {
    if (!append) {
      list.innerHTML = `<p class="text-muted" style="grid-column:1/-1">Couldn't load diary: ${esc(err.message)}</p>`;
    }
    showToast(`Failed to load diary: ${err.message}`, 'error');
  } finally {
    isLoading = false;
  }
}

function createDiaryItem(entry) {
  const item = document.createElement('div');
  item.className = 'diary-item';
  item.dataset.entryId = entry.id;

  const date = new Date(entry.watched_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  });

  const ratingStars = entry.user_rating ? '★ '.repeat(Math.round(entry.user_rating / 2)) : '';
  const rewatchBadge = entry.rewatch ? '<span class="badge badge-outline">↻ Rewatch</span>' : '';

  const posterUrl = entry.poster
    ? `https://image.tmdb.org/t/p/w154${entry.poster}`
    : '';

  item.innerHTML = `
    <div class="diary-item__poster">
      ${posterUrl
        ? `<img src="${posterUrl}" alt="${esc(entry.title)}" loading="lazy">`
        : `<div class="movie-card__poster-placeholder">🎬</div>`
      }
    </div>
    <div class="diary-item__content">
      <div class="diary-item__header">
        <h3 class="diary-item__title">${esc(entry.title)}</h3>
        <div class="diary-item__meta">
          <span class="diary-item__date">${esc(date)}</span>
          ${rewatchBadge}
        </div>
      </div>
      ${entry.user_rating ? `
        <div class="diary-item__rating">${ratingStars} <span class="text-muted body-sm">(${entry.user_rating}/10)</span></div>
      ` : ''}
      ${entry.user_notes ? `
        <p class="diary-item__notes">${esc(entry.user_notes)}</p>
      ` : ''}
      <div class="diary-item__actions">
        <button class="btn btn-ghost btn-sm diary-edit-btn" data-entry-id="${entry.id}">✏️ Edit</button>
        <button class="btn btn-ghost btn-sm diary-delete-btn" data-entry-id="${entry.id}" style="color:var(--red)">🗑️ Delete</button>
      </div>
    </div>
  `;

  // Add click handlers for edit/delete
  item.querySelector('.diary-edit-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openDiaryModal(entry);
  });

  item.querySelector('.diary-delete-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm('Delete this diary entry?')) {
      await deleteDiaryEntry(entry.id, item);
    }
  });

  // Click on poster/title opens movie details
  item.querySelector('.diary-item__poster')?.addEventListener('click', () => openDetails(entry));
  item.querySelector('.diary-item__title')?.addEventListener('click', () => openDetails(entry));

  return item;
}

async function openDetails(entry) {
  try {
    if (entry.media_type === 'tv') {
      const show = await tvApi.details(entry.tmdb_id);
      openModal(show.title, buildTvModal(show));
    } else {
      const movie = await moviesApi.details(entry.tmdb_id);
      openModal(movie.title, buildMovieModal(movie));
    }
    syncWatchlistButtons(document.getElementById('modal-body'));
  } catch (err) {
    showToast(`Could not load details: ${err.message}`, 'error');
  }
}

async function deleteDiaryEntry(id, itemEl) {
  try {
    await diaryApi.remove(id);
    itemEl.remove();
    showToast('Diary entry deleted', 'success');
  } catch (err) {
    showToast(`Failed to delete: ${err.message}`, 'error');
  }
}

// Diary modal for adding/editing entries
let diaryModalResolve = null;

function openDiaryModal(existingEntry = null) {
  const isEdit = !!existingEntry;
  const title = isEdit ? 'Edit Diary Entry' : 'Add Diary Entry';

  const modalHtml = `
    <form id="diary-form" class="diary-form">
      <div class="diary-form__search">
        <label class="input-label">Search for movie/show</label>
        <div class="search-row">
          <input type="text" id="diary-search-input" class="input-field" placeholder="Type to search..." autocomplete="off">
          <select id="diary-media-type" class="input-field" style="width:120px">
            <option value="movie">Movies</option>
            <option value="tv">TV Shows</option>
          </select>
        </div>
        <div id="diary-search-results" class="diary-search-results hidden"></div>
      </div>

      <div id="diary-selected" class="diary-selected hidden">
        <div class="selected-item">
          <img id="diary-selected-poster" src="" alt="" style="width:60px;height:90px;object-fit:cover;border-radius:4px">
          <div>
            <strong id="diary-selected-title"></strong>
            <div class="text-muted body-sm" id="diary-selected-meta"></div>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="diary-change-selection">Change</button>
      </div>

      <div class="diary-form__fields">
        <div class="input-group">
          <label class="input-label">Date Watched <span class="text-muted">(required)</span></label>
          <input type="date" id="diary-watched-date" class="input-field" required max="${new Date().toISOString().split('T')[0]}">
        </div>

        <div class="input-group">
          <label class="input-label">Your Rating <span class="text-muted">(optional)</span></label>
          <div class="rating-row">
            <input type="range" id="diary-rating" min="0" max="10" step="1" value="${existingEntry?.user_rating || 0}">
            <output id="diary-rating-value" class="rating-value">${existingEntry?.user_rating || '—'}</output>
          </div>
        </div>

        <div class="input-group">
          <label class="input-label">Notes <span class="text-muted">(optional)</span></label>
          <textarea id="diary-notes" class="input-field" rows="4" placeholder="Your thoughts...">${esc(existingEntry?.user_notes || '')}</textarea>
        </div>

        <label class="input-check">
          <input type="checkbox" id="diary-rewatch" ${existingEntry?.rewatch ? 'checked' : ''}>
          <span>This is a rewatch</span>
        </label>
      </div>

      <div class="diary-form__actions">
        <button type="button" class="btn btn-secondary" id="diary-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Add Entry'}</button>
      </div>
    </form>
  `;

  openModal(title, modalHtml);

  // Initialize form
  const form = document.getElementById('diary-form');
  const searchInput = document.getElementById('diary-search-input');
  const mediaTypeSelect = document.getElementById('diary-media-type');
  const searchResults = document.getElementById('diary-search-results');
  const selectedDiv = document.getElementById('diary-selected');
  const selectedPoster = document.getElementById('diary-selected-poster');
  const selectedTitle = document.getElementById('diary-selected-title');
  const selectedMeta = document.getElementById('diary-selected-meta');
  const changeBtn = document.getElementById('diary-change-selection');
  const ratingInput = document.getElementById('diary-rating');
  const ratingValue = document.getElementById('diary-rating-value');
  const cancelBtn = document.getElementById('diary-cancel');

  let selectedItem = null;
  let searchDebounce = null;

  // Pre-fill if editing
  if (existingEntry) {
    selectedItem = {
      id: existingEntry.tmdb_id,
      media_type: existingEntry.media_type,
      title: existingEntry.title,
      poster: existingEntry.poster,
      release_year: existingEntry.release_year,
      genres: existingEntry.genres,
    };
    updateSelectedUI();
    searchInput.disabled = true;
    mediaTypeSelect.disabled = true;
  }

  // Set default date to today if new entry
  if (!existingEntry) {
    document.getElementById('diary-watched-date').value = new Date().toISOString().split('T')[0];
  }

  // Rating display
  ratingInput.addEventListener('input', () => {
    ratingValue.textContent = ratingInput.value === '0' ? '—' : `${ratingInput.value}/10`;
  });

  // Search
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => performSearch(searchInput.value.trim()), 300);
  });

  mediaTypeSelect.addEventListener('change', () => {
    if (searchInput.value.trim()) performSearch(searchInput.value.trim());
  });

  async function performSearch(query) {
    if (!query) {
      searchResults.classList.add('hidden');
      return;
    }

    searchResults.innerHTML = '<div class="text-muted body-sm" style="padding:12px">Searching...</div>';
    searchResults.classList.remove('hidden');

    try {
      const api = mediaTypeSelect.value === 'movie' ? moviesApi : tvApi;
      const data = await api.search(query);
      const items = data.movies || data.shows || [];

      if (items.length === 0) {
        searchResults.innerHTML = '<div class="text-muted body-sm" style="padding:12px">No results found</div>';
        return;
      }

      searchResults.innerHTML = items.slice(0, 8).map(item => `
        <button type="button" class="diary-search-result" data-id="${item.id}" data-media="${mediaTypeSelect.value}" data-title="${esc(item.title)}" data-poster="${item.poster || ''}" data-year="${item.release_year || item.first_air_date?.split('-')[0] || ''}" data-genres="${JSON.stringify(item.genres || [])}">
          <img src="${item.poster ? `https://image.tmdb.org/t/p/w92${item.poster}` : ''}" alt="" style="width:40px;height:60px;object-fit:cover;border-radius:4px;background:var(--bg-elevated)">
          <div>
            <strong>${esc(item.title)}</strong>
            <div class="text-muted body-sm">${item.release_year || item.first_air_date?.split('-')[0] || ''} · ${(item.genres || []).slice(0, 2).join(', ')}</div>
          </div>
        </button>
      `).join('');

      searchResults.querySelectorAll('.diary-search-result').forEach(btn => {
        btn.addEventListener('click', () => selectItem(btn.dataset));
      });
    } catch (err) {
      searchResults.innerHTML = `<div class="text-muted body-sm" style="padding:12px;color:var(--red)">Search failed: ${esc(err.message)}</div>`;
    }
  }

  function selectItem(data) {
    selectedItem = {
      id: Number(data.id),
      media_type: data.media,
      title: data.title,
      poster: data.poster,
      release_year: data.year,
      genres: JSON.parse(data.genres),
    };
    updateSelectedUI();
    searchResults.classList.add('hidden');
    searchInput.value = '';
  }

  function updateSelectedUI() {
    if (!selectedItem) return;
    selectedPoster.src = selectedItem.poster ? `https://image.tmdb.org/t/p/w154${selectedItem.poster}` : '';
    selectedPoster.style.display = selectedItem.poster ? 'block' : 'none';
    selectedTitle.textContent = selectedItem.title;
    selectedMeta.textContent = `${selectedItem.release_year || ''} · ${selectedItem.media_type}`;
    selectedDiv.classList.remove('hidden');
  }

  changeBtn.addEventListener('click', () => {
    selectedItem = null;
    selectedDiv.classList.add('hidden');
    searchInput.disabled = false;
    mediaTypeSelect.disabled = false;
    searchInput.focus();
  });

  cancelBtn.addEventListener('click', () => closeModal());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!selectedItem && !existingEntry) {
      showToast('Please select a movie or show', 'error');
      return;
    }

    const watchedDate = document.getElementById('diary-watched-date').value;
    if (!watchedDate) {
      showToast('Please select a date', 'error');
      return;
    }

    const rating = Number(ratingInput.value) || null;
    const notes = document.getElementById('diary-notes').value.trim() || null;
    const rewatch = document.getElementById('diary-rewatch').checked;

    const payload = {
      tmdb_id: existingEntry ? existingEntry.tmdb_id : selectedItem.id,
      media_type: existingEntry ? existingEntry.media_type : selectedItem.media_type,
      title: existingEntry ? existingEntry.title : selectedItem.title,
      poster: existingEntry ? existingEntry.poster : selectedItem.poster,
      release_year: existingEntry ? existingEntry.release_year : selectedItem.release_year,
      user_rating: rating,
      user_notes: notes,
      watched_at: new Date(watchedDate).toISOString(),
      rewatch,
    };

    try {
      if (existingEntry) {
        await diaryApi.update(existingEntry.id, payload);
        showToast('Diary entry updated', 'success');
      } else {
        await diaryApi.add(payload);
        showToast('Diary entry added', 'success');
      }
      closeModal();
      // Reload diary
      currentPage = 1;
      const list = document.querySelector('#diary-list');
      const empty = document.querySelector('#diary-empty');
      await loadDiary(list, empty, false);
    } catch (err) {
      showToast(`Failed to save: ${err.message}`, 'error');
    }
  });
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