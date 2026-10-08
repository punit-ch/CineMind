// public/js/recommendations.js
import { aiApi } from './api.js';
import {
  showToast, buildRecCard, animateScoreBars, showSkeletons, setLoading, initTagInput, esc,
} from './ui.js';
import { addHistoryEntry } from './history.js';
import { syncWatchlistButtons } from './watchlist.js';

const MOODS = [
  { label: 'Mind-bending', icon: '🌀' }, { label: 'Emotional', icon: '💔' },
  { label: 'Romantic', icon: '💕' }, { label: 'Dark', icon: '🖤' },
  { label: 'Sci-Fi', icon: '🚀' }, { label: 'Family', icon: '👨‍👩‍👧' },
  { label: 'Motivational', icon: '🔥' }, { label: 'Horror', icon: '👻' },
  { label: 'Action', icon: '💥' }, { label: 'Comedy', icon: '😂' },
  { label: 'Mystery', icon: '🔍' }, { label: 'Nostalgic', icon: '📺' },
];

export function initRecommendations(sectionEl) {
  const state = { mood: '', movies: [], genres: [], directors: [], actors: [] };
  const resultsEl = sectionEl.querySelector('#rec-results');
  const submitBtn = sectionEl.querySelector('#rec-submit');
  const moodBtn = sectionEl.querySelector('#mood-submit');
  const grid = sectionEl.querySelector('#mood-grid');
  if (!resultsEl) return;

  // Mood picker (click again to deselect)
  if (grid) {
    grid.innerHTML = MOODS.map((m) => `
      <button type="button" class="mood-btn" data-mood="${esc(m.label)}" aria-pressed="false">
        <span class="mood-icon">${m.icon}</span><span>${esc(m.label)}</span>
      </button>`).join('');

    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.mood-btn');
      if (!btn) return;
      const wasActive = btn.classList.contains('active');
      grid.querySelectorAll('.mood-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      state.mood = wasActive ? '' : btn.dataset.mood;
      if (!wasActive) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      }
    });
  }

  initTagInput('fav-movies-input', (t) => { state.movies = t; });
  initTagInput('genre-input', (t) => { state.genres = t; });
  initTagInput('director-input', (t) => { state.directors = t; });
  initTagInput('actor-input', (t) => { state.actors = t; });

  async function run(button, restoreLabel, request, historyEntry, doneMessage) {
    showSkeletons(resultsEl, 6, 'rec');
    setLoading(button, true);
    try {
      const data = await request();
      renderRecommendations(resultsEl, data.recommendations);
      addHistoryEntry({ ...historyEntry, recommendations: data.recommendations });
      showToast(doneMessage(data), 'success');
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      resultsEl.innerHTML = errorState(err.message);
      showToast(`Recommendation failed: ${err.message}`, 'error');
    } finally {
      setLoading(button, false, restoreLabel);
    }
  }

  submitBtn?.addEventListener('click', () => {
    if (!state.movies.length && !state.genres.length && !state.mood) {
      return showToast('Add at least one movie, genre, or select a mood', 'warning');
    }
    run(
      submitBtn, '✦ Get Recommendations',
      () => aiApi.recommend({
        favoriteMovies: state.movies, genres: state.genres,
        directors: state.directors, actors: state.actors, mood: state.mood,
      }),
      { type: 'ai', preferences: { movies: state.movies, genres: state.genres, mood: state.mood } },
      (d) => `${d.count} personalized recommendations ready`
    );
  });

  moodBtn?.addEventListener('click', () => {
    if (!state.mood) return showToast('Select a mood first', 'warning');
    const mood = state.mood;
    run(
      moodBtn, '🎬 Find by Mood',
      () => aiApi.moodRecommend(mood),
      { type: 'mood', mood },
      () => `${mood} picks are ready`
    );
  });
}

function renderRecommendations(container, recs) {
  if (!recs?.length) {
    container.innerHTML = `<div class="watchlist-empty"><div class="empty-icon">🎬</div>
      <h3>No recommendations found</h3><p>Try different preferences</p></div>`;
    return;
  }
  container.innerHTML = recs.map((rec, i) => buildRecCard(rec, i)).join('');
  animateScoreBars(container);
  syncWatchlistButtons(container);
}

function errorState(msg) {
  return `<div class="watchlist-empty">
    <div class="empty-icon">⚠️</div>
    <h3>Something went wrong</h3>
    <p class="text-muted">${esc(msg)}</p>
  </div>`;
}
