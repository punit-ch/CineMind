// public/js/tools.js — AI Critic, Movie Night Planner, Film Comparison
import { aiApi } from './api.js';
import { showToast, setLoading, esc } from './ui.js';

const spinner = (text) =>
  `<div class="loading-spinner"><div class="spinner"></div> ${esc(text)}</div>`;
const failed = (prefix, err) => `<p class="text-muted">${esc(prefix)}: ${esc(err.message)}</p>`;
const img = (url, style) => (/^https?:\/\//.test(url || '') ? `<img src="${esc(url)}" alt="" style="${style}">` : '');
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clampPct = (v) => Math.max(0, Math.min(100, num(v)));

// Run a tool on button click and on Enter in its inputs
function bindTool({ button, inputs, run }) {
  if (!button) return;
  button.addEventListener('click', run);
  inputs.forEach((el) => el?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && el.tagName === 'INPUT') {
      e.preventDefault();
      run();
    }
  }));
}

// ── Movie Comparison ──────────────────────────────────────────────────────────
export function initComparison(sectionEl) {
  const btn = sectionEl.querySelector('#compare-btn');
  const resultEl = sectionEl.querySelector('#compare-result');
  const in1 = sectionEl.querySelector('#compare-movie1');
  const in2 = sectionEl.querySelector('#compare-movie2');
  if (!btn || !resultEl) return;

  async function run() {
    const m1 = in1?.value.trim();
    const m2 = in2?.value.trim();
    if (!m1 || !m2) return showToast('Enter two movie titles to compare', 'warning');
    if (m1.toLowerCase() === m2.toLowerCase()) return showToast('Pick two different movies', 'warning');

    setLoading(btn, true);
    resultEl.innerHTML = spinner('Comparing movies...');
    try {
      resultEl.innerHTML = buildComparisonResult(await aiApi.compareMovies(m1, m2));
      requestAnimationFrame(() => setTimeout(() => {
        resultEl.querySelectorAll('[data-target]').forEach((bar) => { bar.style.width = bar.dataset.target; });
      }, 100));
    } catch (err) {
      resultEl.innerHTML = failed('Comparison failed', err);
      showToast('Comparison failed', 'error');
    } finally {
      setLoading(btn, false, '⚡ Compare');
    }
  }
  bindTool({ button: btn, inputs: [in1, in2], run });
}

function buildComparisonResult(data) {
  const dims = Array.isArray(data.dimensions) ? data.dimensions : [];
  const side = (title, poster, year) => `
    <div style="text-align:center">
      ${img(poster, 'width:120px;border-radius:8px;margin:0 auto 12px;display:block')}
      <h3>${esc(title)}</h3>
      ${year ? `<span class="tag">${esc(year)}</span>` : ''}
    </div>`;

  return `
    <div class="comparison-grid" style="margin-bottom:var(--space-lg)">
      ${side(data.movie1, data.movie1Poster, data.movie1Year)}
      <div style="text-align:center"><div class="vs-badge">VS</div></div>
      ${side(data.movie2, data.movie2Poster, data.movie2Year)}
    </div>
    <div class="analytics-card" style="margin-bottom:var(--space-md)">
      <h3>Verdict</h3>
      <p style="color:var(--text-secondary);font-size:0.9375rem;line-height:1.65">${esc(data.verdict)}</p>
      ${data.watchFirst ? `<p style="margin-top:12px;font-size:0.875rem"><strong>Watch first:</strong>
        <span class="tag tag-red">${esc(data.watchFirst)}</span> — ${esc(data.watchFirstReason)}</p>` : ''}
    </div>
    <div class="analytics-card">
      <h3>Head-to-Head</h3>
      ${dims.map((d) => `
        <div class="dimension-bar">
          <div style="margin-bottom:6px"><span style="font-size:0.8rem;font-weight:600">${esc(d.category)}</span></div>
          <div class="dimension-row">
            <div style="text-align:right"><div class="dim-bar-1" style="width:0%;margin-left:auto" data-target="${clampPct(d.movie1Score)}%"></div></div>
            <div style="text-align:center;font-size:0.75rem;color:var(--text-muted)">${num(d.movie1Score)} · ${num(d.movie2Score)}</div>
            <div><div class="dim-bar-2" style="width:0%" data-target="${clampPct(d.movie2Score)}%"></div></div>
          </div>
          <p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">${esc(d.analysis)}</p>
        </div>`).join('')}
    </div>`;
}

// ── AI Critic ─────────────────────────────────────────────────────────────────
export function initCritic(sectionEl) {
  const btn = sectionEl.querySelector('#critic-btn');
  const resultEl = sectionEl.querySelector('#critic-result');
  const input = sectionEl.querySelector('#critic-input');
  if (!btn || !resultEl) return;

  async function run() {
    const title = input?.value.trim();
    if (!title) return showToast('Enter a movie title to analyze', 'warning');

    setLoading(btn, true);
    resultEl.innerHTML = spinner(`Analyzing "${title}"...`);
    try {
      resultEl.innerHTML = buildCriticResult(await aiApi.critic(title));
    } catch (err) {
      resultEl.innerHTML = failed('Analysis failed', err);
      showToast('Critic analysis failed', 'error');
    } finally {
      setLoading(btn, false, '🎭 Analyze');
    }
  }
  bindTool({ button: btn, inputs: [input], run });
}

function buildCriticResult(d) {
  const items = (list, cls) => (Array.isArray(list) ? list : [])
    .map((s) => `<div class="${cls}"><strong>${esc(s.aspect)}:</strong> ${esc(s.detail)}</div>`).join('');
  const text = (label, value, extra = '') => value ? `
    <div class="critic-section">
      <h3>${label}</h3>
      <p style="font-size:0.875rem;color:var(--text-secondary);line-height:1.6;${extra}">${value}</p>
    </div>` : '';
  const rating = Number(d.rating);
  const tmdbRating = Number(d.tmdbRating);

  return `
    <div class="critic-result">
      <div class="critic-header">
        ${img(d.poster, 'border-radius:8px;width:160px;aspect-ratio:2/3;object-fit:cover')
          || '<div style="width:160px;aspect-ratio:2/3;background:var(--bg-elevated);border-radius:8px"></div>'}
        <div>
          <h2 style="font-size:1.5rem;margin-bottom:8px">${esc(d.title)}</h2>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
            ${d.releaseYear ? `<span class="tag">${esc(d.releaseYear)}</span>` : ''}
            ${(d.genres || []).slice(0, 3).map((g) => `<span class="tag">${esc(g)}</span>`).join('')}
          </div>
          <p style="font-size:1rem;font-style:italic;color:var(--text-secondary);margin-bottom:16px;line-height:1.6">"${esc(d.overallVerdict)}"</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${(d.themes || []).map((t) => `<span class="tag tag-red">${esc(t)}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="critic-scores">
        <div class="score-card"><div class="score-big">${Number.isFinite(rating) ? rating.toFixed(1) : '—'}</div><div class="text-muted body-sm">AI Score</div></div>
        <div class="score-card"><div class="score-big">${tmdbRating > 0 ? tmdbRating.toFixed(1) : '—'}</div><div class="text-muted body-sm">TMDB Rating</div></div>
        <div class="score-card" style="background:var(--red-glow);border-color:var(--border-accent)"><div class="score-big" style="color:#ff9999">✦</div><div class="text-muted body-sm">CineMind Pick</div></div>
      </div>
      <div class="critic-sections">
        <div class="critic-section"><h3>Strengths</h3>${items(d.strengths, 'strength-item')}</div>
        <div class="critic-section"><h3>Weaknesses</h3>${items(d.weaknesses, 'weakness-item')}</div>
        ${text('Storytelling', esc(d.storytelling))}
        ${text('Cinematography', esc(d.cinematography))}
        ${text('Performances', esc(d.performances))}
        ${text('Who Should Watch', d.whoShouldWatch ? `✓ ${esc(d.whoShouldWatch)}` : '')}
        ${text('Who Might Skip It', d.whoShouldSkip ? `✕ ${esc(d.whoShouldSkip)}` : '')}
        ${text('Best Moment', d.bestMoment ? `"${esc(d.bestMoment)}"` : '', 'font-style:italic')}
        ${text('Hidden Detail', esc(d.hiddenDetails))}
      </div>
      ${(d.similarMovies || []).length ? `
        <div class="analytics-card" style="margin-top:var(--space-md)">
          <h3>If You Liked This</h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
            ${d.similarMovies.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}
          </div>
        </div>` : ''}
    </div>`;
}

// ── Movie Night Planner ───────────────────────────────────────────────────────
export function initPlanner(sectionEl) {
  const btn = sectionEl.querySelector('#planner-btn');
  const resultEl = sectionEl.querySelector('#planner-result');
  if (!btn || !resultEl) return;

  async function run() {
    const people = parseInt(sectionEl.querySelector('#planner-people')?.value, 10);
    const mood = sectionEl.querySelector('#planner-mood')?.value.trim();
    const genres = [...sectionEl.querySelectorAll('#planner-genres input:checked')].map((cb) => cb.value);

    if (!people || people < 1 || people > 50) return showToast('Enter a valid number of people (1–50)', 'warning');

    setLoading(btn, true);
    resultEl.innerHTML = spinner('Planning the perfect movie night...');
    try {
      resultEl.innerHTML = buildPlannerResult(await aiApi.planNight({ people, genres, mood }));
    } catch (err) {
      resultEl.innerHTML = failed('Planning failed', err);
      showToast(`Planner error: ${err.message}`, 'error');
    } finally {
      setLoading(btn, false, '🎉 Plan Movie Night');
    }
  }
  bindTool({ button: btn, inputs: [sectionEl.querySelector('#planner-mood')], run });
}

function buildPlannerResult(data) {
  const pick = data.mainPick || {};
  const backups = Array.isArray(data.backups) ? data.backups : [];
  const year = pick.releaseYear || pick.year;
  const label = (t) => `<p style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">${t}</p>`;

  return `
    <div class="planner-result">
      <div class="planner-result-header">🎬 Tonight's Pick</div>
      <div class="planner-main">
        <div>
          ${img(pick.poster, 'width:200px;max-width:100%;border-radius:10px;aspect-ratio:2/3;object-fit:cover')
            || `<div style="width:200px;aspect-ratio:2/3;background:var(--bg-elevated);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.8rem;text-align:center;padding:12px">${esc(pick.title)}</div>`}
        </div>
        <div>
          <h2 style="font-size:1.5rem;margin-bottom:8px">${esc(pick.title)} ${year ? `<span style="color:var(--text-muted);font-size:1rem">(${esc(year)})</span>` : ''}</h2>
          <p style="color:var(--text-secondary);margin-bottom:16px;line-height:1.65">${esc(pick.whyPerfect)}</p>
          <p style="font-size:0.875rem;color:var(--text-muted);margin-bottom:16px">${esc(pick.groupAppeal)}</p>
          ${pick.snackPairing ? `<p style="font-size:0.875rem;background:var(--bg-elevated);padding:10px 14px;border-radius:8px;margin-bottom:16px">🍿 <strong>Snack pairing:</strong> ${esc(pick.snackPairing)}</p>` : ''}
          ${(pick.conversationStarters || []).length ? `<div>${label('Discussion Starters')}
            ${pick.conversationStarters.map((s) => `<p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:6px;padding-left:12px;border-left:2px solid var(--red)">💬 ${esc(s)}</p>`).join('')}
          </div>` : ''}
        </div>
      </div>
      ${backups.length ? `
        <div style="padding:0 var(--space-xl) var(--space-xl)">
          ${label('Backup Picks')}
          <div class="planner-backups">
            ${backups.map((b) => `<div class="backup-card"><strong>${esc(b.title)}</strong><p>${esc(b.reason)}</p></div>`).join('')}
          </div>
        </div>` : ''}
    </div>`;
}
