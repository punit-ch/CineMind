// public/js/import/import.js — Data Import section
import { showToast, esc } from '../ui.js';

let isImporting = false;

export async function initImport(sectionEl) {
  const resultsEl = sectionEl.querySelector('#import-results');

  // Letterboxd CSV import - imports library, diary, and ratings
  const letterboxdInput = sectionEl.querySelector('#import-letterboxd');
  const letterboxdBtn = sectionEl.querySelector('#import-letterboxd-btn');
  if (letterboxdBtn && letterboxdInput) {
    letterboxdBtn.addEventListener('click', () => letterboxdInput.click());
    letterboxdInput.addEventListener('change', (e) => handleFileSelect(e, 'letterboxd', letterboxdBtn, resultsEl));
  }

  // CineMind JSON import - imports library, diary, and ratings
  const jsonInput = sectionEl.querySelector('#import-json');
  const jsonBtn = sectionEl.querySelector('#import-json-btn');
  if (jsonBtn && jsonInput) {
    jsonBtn.addEventListener('click', () => jsonInput.click());
    jsonInput.addEventListener('change', (e) => handleFileSelect(e, 'cinemind', jsonBtn, resultsEl));
  }

  // Trakt JSON import - imports library, diary, and ratings
  const traktInput = sectionEl.querySelector('#import-trakt');
  const traktBtn = sectionEl.querySelector('#import-trakt-btn');
  if (traktBtn && traktInput) {
    traktBtn.addEventListener('click', () => traktInput.click());
    traktInput.addEventListener('change', (e) => handleFileSelect(e, 'trakt', traktBtn, resultsEl));
  }

  // Clear results
  const clearBtn = sectionEl.querySelector('#import-clear-results');
  clearBtn?.addEventListener('click', () => {
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
  });
}

function handleFileSelect(e, format, btn, resultsEl) {
  const file = e.target.files[0];
  if (!file) return;

  // Validate file type
  const validTypes = {
    letterboxd: ['.csv'],
    cinemind: ['.json'],
    trakt: ['.json']
  };

  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!validTypes[format].includes(ext)) {
    showToast(`Invalid file type for ${format}. Use ${validTypes[format].join(' or ')}.`, 'error');
    e.target.value = '';
    return;
  }

  // Show file info on button
  btn.textContent = `${file.name} (${formatBytes(file.size)})`;
  btn.dataset.file = file.name;

  // Auto-submit on file selection
  doImport(file, format, btn, resultsEl);
}

async function doImport(file, format, btn, resultsEl) {
  if (isImporting) return;

  isImporting = true;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Importing...';

  resultsEl.innerHTML = '<div class="text-muted" style="padding:16px">Processing import...</div>';
  resultsEl.classList.remove('hidden');

  try {
    // Read file content
    const fileContent = await readFileAsText(file);
    const fileData = parseImportFile(fileContent, format);

    if (!fileData || (!fileData.library?.length && !fileData.diary?.length && !fileData.ratings?.length)) {
      throw new Error('No valid data found in the file');
    }

    // Import using the /api/import/full endpoint for all data types
    const response = await fetch('/api/import/full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        library: fileData.library || [],
        diary: fileData.diary || [],
        ratings: fileData.ratings || [],
        format: format === 'letterboxd' ? 'letterboxd' : 'json'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Import failed');
    }

    displayImportResults(data, resultsEl);
    showToast(`Import complete! Library: ${data.library?.success || 0} ok, ${data.library?.failed || 0} failed. Diary: ${data.diary?.success || 0} ok, ${data.diary?.failed || 0} failed. Ratings: ${data.ratings?.success || 0} ok, ${data.ratings?.failed || 0} failed.`, 'success');

    // Clear file input
    const input = document.querySelector(`#import-${format === 'cinemind' ? 'json' : format}`);
    if (input) input.value = '';
    btn.textContent = originalText;
    delete btn.dataset.file;
  } catch (err) {
    resultsEl.innerHTML = `<div class="import-error" style="padding:16px;color:var(--red)">${esc(err.message)}</div>`;
    showToast(`Import failed: ${err.message}`, 'error');
    btn.textContent = originalText;
  } finally {
    isImporting = false;
    btn.disabled = false;
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function parseImportFile(content, format) {
  try {
    if (format === 'letterboxd') {
      // Letterboxd CSV - parse and map to library, diary, ratings
      const parsed = parseCSV(content);
      return {
        library: mapLetterboxdLibrary(parsed),
        diary: mapLetterboxdDiary(parsed),
        ratings: mapLetterboxdRatings(parsed)
      };
    } else {
      // JSON format (CineMind or Trakt)
      const parsed = JSON.parse(content);

      // If it's already structured with library/diary/ratings
      if (parsed.library || parsed.diary || parsed.ratings) {
        return {
          library: parsed.library || [],
          diary: parsed.diary || [],
          ratings: parsed.ratings || []
        };
      }

      // If it's a flat array, treat as library
      if (Array.isArray(parsed)) {
        return { library: parsed, diary: [], ratings: [] };
      }

      // Single object
      return { library: [parsed], diary: [], ratings: [] };
    }
  } catch (err) {
    throw new Error(`Failed to parse file: ${err.message}`);
  }
}

function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const results = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;

    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = values[idx].trim().replace(/^"|"$/g, '');
    });
    results.push(obj);
  }

  return results;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function mapLetterboxdLibrary(data) {
  return data.map(row => ({
    tmdbId: parseInt(row.TMDB_ID || row.tmdbId, 10) || null,
    mediaType: 'movie',
    title: (row.Title || row.title || '').slice(0, 200),
    poster: null,
    releaseYear: parseInt(row.Year || row.year, 10) || null,
    genres: [],
    rating: 0,
    status: (row.Status || row.status || 'watchlist').toLowerCase(),
    userRating: row.Rating || row.rating ? Math.min(10, Math.max(0, parseInt(row.Rating || row.rating, 10))) : null,
    userNotes: (row.Notes || row.notes || '').slice(0, 1000),
    progress: 0,
    addedAt: row.Date_Added || row.dateAdded || new Date().toISOString(),
  })).filter(item => item.tmdbId && item.title);
}

function mapLetterboxdDiary(data) {
  return data.map(row => ({
    tmdbId: parseInt(row.TMDB_ID || row.tmdbId, 10) || null,
    mediaType: 'movie',
    title: (row.Title || row.title || '').slice(0, 200),
    poster: null,
    releaseYear: parseInt(row.Year || row.year, 10) || null,
    userRating: row.Rating || row.rating ? Math.min(10, Math.max(0, parseInt(row.Rating || row.rating, 10))) : null,
    userNotes: (row.Review || row.review || row.notes || '').slice(0, 2000),
    watchedAt: row.Watched_Date || row.watchedDate || row.Date || new Date().toISOString(),
    rewatch: Boolean(row.Rewatch || row.rewatch),
  })).filter(item => item.tmdbId && item.title && item.watchedAt);
}

function mapLetterboxdRatings(data) {
  return data.map(row => ({
    tmdbId: parseInt(row.TMDB_ID || row.tmdbId, 10) || null,
    mediaType: 'movie',
    title: (row.Title || row.title || '').slice(0, 200),
    poster: null,
    releaseYear: parseInt(row.Year || row.year, 10) || null,
    userRating: row.Rating || row.rating ? Math.min(10, Math.max(0, parseInt(row.Rating || row.rating, 10))) : null,
    ratedAt: row.Rated_Date || row.ratedDate || row.Date || new Date().toISOString(),
  })).filter(item => item.tmdbId && item.title && item.userRating !== null);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function displayImportResults(data, container) {
  const { library, diary, ratings, message } = data;

  let html = `
    <div class="import-results">
      <div class="import-summary">
        <div class="import-stat success"><strong>${library?.success || 0}</strong><span>Library Imported</span></div>
        <div class="import-stat warning"><strong>${library?.failed || 0}</strong><span>Library Failed</span></div>
        <div class="import-stat success"><strong>${diary?.success || 0}</strong><span>Diary Imported</span></div>
        <div class="import-stat warning"><strong>${diary?.failed || 0}</strong><span>Diary Failed</span></div>
        <div class="import-stat success"><strong>${ratings?.success || 0}</strong><span>Ratings Imported</span></div>
        <div class="import-stat error"><strong>${ratings?.failed || 0}</strong><span>Ratings Failed</span></div>
      </div>
  `;

  if (message) {
    html += `<div class="import-message" style="padding:12px;background:var(--bg-elevated);border-radius:8px;margin-bottom:16px;font-size:0.9rem">${esc(message)}</div>`;
  }

  // Collect all errors
  const allErrors = [
    ...(library?.errors || []),
    ...(diary?.errors || []),
    ...(ratings?.errors || [])
  ];

  if (allErrors.length > 0) {
    html += `
      <details class="import-errors" open>
        <summary>Errors (${allErrors.length})</summary>
        <ul>
          ${allErrors.slice(0, 20).map(err => `<li>${esc(err)}</li>`).join('')}
          ${allErrors.length > 20 ? `<li class="text-muted">... and ${allErrors.length - 20} more</li>` : ''}
        </ul>
      </details>
    `;
  }

  html += '</div>';
  container.innerHTML = html;
}