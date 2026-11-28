// public/js/queue/queue.js — Up Next Queue section
import { queueApi } from '../api.js';
import { buildMovieCard, showToast, esc, openModal, buildMovieModal, buildTvModal } from '../ui.js';
import { moviesApi, tvApi } from '../api.js';
import { syncWatchlistButtons } from '../watchlist.js';

let isLoading = false;

export async function initQueue(sectionEl) {
  const list = sectionEl.querySelector('#queue-list');
  const empty = sectionEl.querySelector('#queue-empty');
  const addBtn = sectionEl.querySelector('#queue-add-btn');

  // Load initial data
  await loadQueue(list, empty);

  // Event listeners
  addBtn?.addEventListener('click', () => openQueueModal());
}

async function loadQueue(list, empty) {
  if (isLoading) return;
  isLoading = true;

  list.innerHTML = Array(5).fill('<div class="skeleton skeleton-card"></div>').join('');

  try {
    const data = await queueApi.get();
    const items = data.items || [];

    list.innerHTML = '';

    if (items.length === 0) {
      empty?.classList.remove('hidden');
      return;
    }

    empty?.classList.add('hidden');

    items.forEach(item => {
      const queueItem = createQueueItem(item);
      list.appendChild(queueItem);
    });

    syncWatchlistButtons(list);
    makeSortable(list);
  } catch (err) {
    list.innerHTML = `<p class="text-muted" style="grid-column:1/-1">Couldn't load queue: ${esc(err.message)}</p>`;
    showToast(`Failed to load queue: ${err.message}`, 'error');
  } finally {
    isLoading = false;
  }
}

function createQueueItem(item) {
  const queueItem = document.createElement('div');
  queueItem.className = 'queue-item';
  queueItem.dataset.itemId = item.id;
  queueItem.dataset.position = item.position;

  const posterUrl = item.poster
    ? `https://image.tmdb.org/t/p/w154${item.poster}`
    : '';

  queueItem.innerHTML = `
    <div class="queue-item__position">${item.position}</div>
    <div class="queue-item__poster">
      ${posterUrl
        ? `<img src="${posterUrl}" alt="${esc(item.title)}" loading="lazy">`
        : `<div class="movie-card__poster-placeholder">🎬</div>`
      }
    </div>
    <div class="queue-item__content">
      <div class="queue-item__header">
        <h3 class="queue-item__title">${esc(item.title)}</h3>
        <div class="queue-item__meta">
          <span class="queue-item__year">${item.release_year ? esc(item.release_year) : ''}</span>
          <span class="queue-item__type">${item.media_type === 'tv' ? 'TV' : 'Movie'}</span>
        </div>
      </div>
      ${item.notes ? `<p class="queue-item__notes">${esc(item.notes)}</p>` : ''}
      <div class="queue-item__actions">
        <button class="btn btn-ghost btn-sm queue-move-up" data-id="${item.id}" title="Move up">↑</button>
        <button class="btn btn-ghost btn-sm queue-move-down" data-id="${item.id}" title="Move down">↓</button>
        <button class="btn btn-ghost btn-sm queue-delete-btn" data-id="${item.id}" style="color:var(--red)">🗑️ Remove</button>
      </div>
    </div>
  `;

  // Add click handlers for move up/down and delete
  queueItem.querySelector('.queue-move-up')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await moveQueueItem(item.id, item.position - 1, list);
  });

  queueItem.querySelector('.queue-move-down')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await moveQueueItem(item.id, item.position + 1, list);
  });

  queueItem.querySelector('.queue-delete-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm('Remove from queue?')) {
      await deleteQueueItem(item.id, queueItem);
    }
  });

  // Click on poster/title opens movie details
  queueItem.querySelector('.queue-item__poster')?.addEventListener('click', () => openDetails(item));
  queueItem.querySelector('.queue-item__title')?.addEventListener('click', () => openDetails(item));

  return queueItem;
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

async function deleteQueueItem(id, itemEl) {
  try {
    await queueApi.remove(id);
    itemEl.remove();
    showToast('Removed from queue', 'success');
    // Reload to update positions
    const list = document.querySelector('#queue-list');
    const empty = document.querySelector('#queue-empty');
    await loadQueue(list, empty);
  } catch (err) {
    showToast(`Failed to remove: ${err.message}`, 'error');
  }
}

async function moveQueueItem(id, newPosition, list) {
  try {
    // Get all current items to reorder
    const items = Array.from(list.querySelectorAll('.queue-item')).map(el => ({
      id: Number(el.dataset.itemId),
      position: Number(el.dataset.position)
    }));

    // Find the item being moved
    const itemIndex = items.findIndex(i => i.id === id);
    if (itemIndex === -1) return;

    // Swap positions
    const targetIndex = items.findIndex(i => i.position === newPosition);
    if (targetIndex === -1) return;

    [items[itemIndex].position, items[targetIndex].position] = [items[targetIndex].position, items[itemIndex].position];

    // Send reorder to API
    await queueApi.reorder(items);

    // Reload queue to reflect new order
    const empty = document.querySelector('#queue-empty');
    await loadQueue(list, empty);
  } catch (err) {
    showToast(`Failed to reorder: ${err.message}`, 'error');
  }
}

// Simple drag-and-drop for queue reordering
function makeSortable(list) {
  let draggedItem = null;

  list.querySelectorAll('.queue-item').forEach(item => {
    item.draggable = true;

    item.addEventListener('dragstart', (e) => {
      draggedItem = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      draggedItem = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedItem && draggedItem !== item) {
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          list.insertBefore(draggedItem, item);
        } else {
          list.insertBefore(draggedItem, item.nextSibling);
        }
      }
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!draggedItem) return;

      // Get new order from DOM
      const items = Array.from(list.querySelectorAll('.queue-item')).map((el, index) => ({
        id: Number(el.dataset.itemId),
        position: index + 1
      }));

      try {
        await queueApi.reorder(items);
        // Reload to update position numbers
        const empty = document.querySelector('#queue-empty');
        await loadQueue(list, empty);
      } catch (err) {
        showToast(`Failed to reorder: ${err.message}`, 'error');
        // Reload to restore correct order
        const empty = document.querySelector('#queue-empty');
        await loadQueue(list, empty);
      }
    });
  });
}

// Queue modal for adding items
function openQueueModal() {
  const title = 'Add to Queue';

  const modalHtml = `
    <form id="queue-form" class="queue-form">
      <div class="queue-form__search">
        <label class="input-label">Search for movie/show</label>
        <div class="search-row">
          <input type="text" id="queue-search-input" class="input-field" placeholder="Type to search..." autocomplete="off">
          <select id="queue-media-type" class="input-field" style="width:120px">
            <option value="movie">Movies</option>
            <option value="tv">TV Shows</option>
          </select>
        </div>
        <div id="queue-search-results" class="queue-search-results hidden"></div>
      </div>

      <div id="queue-selected" class="queue-selected hidden">
        <div class="selected-item">
          <img id="queue-selected-poster" src="" alt="" style="width:60px;height:90px;object-fit:cover;border-radius:4px">
          <div>
            <strong id="queue-selected-title"></strong>
            <div class="text-muted body-sm" id="queue-selected-meta"></div>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="queue-change-selection">Change</button>
      </div>

      <div class="queue-form__fields">
        <div class="input-group">
          <label class="input-label">Notes <span class="text-muted">(optional)</span></label>
          <textarea id="queue-notes" class="input-field" rows="3" placeholder="Any notes about this..."></textarea>
        </div>
      </div>

      <div class="queue-form__actions">
        <button type="button" class="btn btn-secondary" id="queue-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Add to Queue</button>
      </div>
    </form>
  `;

  openModal(title, modalHtml);

  // Initialize form
  const form = document.getElementById('queue-form');
  const searchInput = document.getElementById('queue-search-input');
  const mediaTypeSelect = document.getElementById('queue-media-type');
  const searchResults = document.getElementById('queue-search-results');
  const selectedDiv = document.getElementById('queue-selected');
  const selectedPoster = document.getElementById('queue-selected-poster');
  const selectedTitle = document.getElementById('queue-selected-title');
  const selectedMeta = document.getElementById('queue-selected-meta');
  const changeBtn = document.getElementById('queue-change-selection');
  const cancelBtn = document.getElementById('queue-cancel');

  let selectedItem = null;
  let searchDebounce = null;

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
        <button type="button" class="queue-search-result" data-id="${item.id}" data-media="${mediaTypeSelect.value}" data-title="${esc(item.title)}" data-poster="${item.poster || ''}" data-year="${item.release_year || item.first_air_date?.split('-')[0] || ''}" data-genres="${JSON.stringify(item.genres || [])}">
          <img src="${item.poster ? `https://image.tmdb.org/t/p/w92${item.poster}` : ''}" alt="" style="width:40px;height:60px;object-fit:cover;border-radius:4px;background:var(--bg-elevated)">
          <div>
            <strong>${esc(item.title)}</strong>
            <div class="text-muted body-sm">${item.release_year || item.first_air_date?.split('-')[0] || ''} · ${(item.genres || []).slice(0, 2).join(', ')}</div>
          </div>
        </button>
      `).join('');

      searchResults.querySelectorAll('.queue-search-result').forEach(btn => {
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

    if (!selectedItem) {
      showToast('Please select a movie or show', 'error');
      return;
    }

    const notes = document.getElementById('queue-notes').value.trim() || null;

    const payload = {
      tmdb_id: selectedItem.id,
      media_type: selectedItem.media_type,
      title: selectedItem.title,
      poster: selectedItem.poster,
      release_year: selectedItem.release_year,
      notes,
    };

    try {
      await queueApi.add(payload);
      showToast('Added to queue', 'success');
      closeModal();
      // Reload queue
      const list = document.querySelector('#queue-list');
      const empty = document.querySelector('#queue-empty');
      await loadQueue(list, empty);
    } catch (err) {
      showToast(`Failed to add: ${err.message}`, 'error');
    }
  });
}