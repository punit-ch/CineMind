// controllers/importController.js — Data import handlers (from JSON/CSV, Letterboxd, Trakt, etc.)
const supabaseService = require('../services/supabaseService');
const { HttpError, cleanText, toInt, cleanList } = require('../utils/validate');

async function requireAuth(req, res, next) {
  const { userId, error } = await supabaseService.verifyAuth(req);
  if (error) {
    throw new HttpError(401, error);
  }
  req.userId = userId;
  next();
}

// Parse various import formats
function parseImportData(data, type) {
  // Try JSON first
  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) return parsed;
    if (parsed[type]) return parsed[type];
    return parsed;
  } catch {
    // Not JSON, try CSV
    if (type === 'library' || type === 'diary' || type === 'ratings') {
      return parseCSV(data);
    }
    throw new HttpError(400, 'Invalid data format. Expected JSON array or CSV.');
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

// Map Letterboxd export format
function mapLetterboxdLibrary(data) {
  return data.map(row => ({
    tmdbId: toInt(row.TMDB_ID || row.tmdbId, null),
    mediaType: 'movie',
    title: cleanText(row.Title || row.title, 200),
    poster: null,
    releaseYear: toInt(row.Year || row.year, null),
    genres: [],
    rating: 0,
    status: (row.Status || row.status || 'watchlist').toLowerCase(),
    userRating: toInt(row.Rating || row.rating, null, { min: 0, max: 10 }),
    userNotes: cleanText(row.Notes || row.notes, 1000),
    progress: 0,
    addedAt: row.Date_Added || row.dateAdded || new Date().toISOString(),
  })).filter(item => item.tmdbId && item.title);
}

function mapLetterboxdDiary(data) {
  return data.map(row => ({
    tmdbId: toInt(row.TMDB_ID || row.tmdbId, null),
    mediaType: 'movie',
    title: cleanText(row.Title || row.title, 200),
    poster: null,
    releaseYear: toInt(row.Year || row.year, null),
    userRating: toInt(row.Rating || row.rating, null, { min: 0, max: 10 }),
    userNotes: cleanText(row.Review || row.review || row.notes, 2000),
    watchedAt: row.Watched_Date || row.watchedDate || row.Date || new Date().toISOString(),
    rewatch: Boolean(row.Rewatch || row.rewatch),
  })).filter(item => item.tmdbId && item.title && item.watchedAt);
}

function mapLetterboxdRatings(data) {
  return data.map(row => ({
    tmdbId: toInt(row.TMDB_ID || row.tmdbId, null),
    mediaType: 'movie',
    title: cleanText(row.Title || row.title, 200),
    poster: null,
    releaseYear: toInt(row.Year || row.year, null),
    userRating: toInt(row.Rating || row.rating, null, { min: 0, max: 10 }),
    ratedAt: row.Rated_Date || row.ratedDate || row.Date || new Date().toISOString(),
  })).filter(item => item.tmdbId && item.title && item.userRating !== null);
}

const importController = {
  requireAuth,

  // POST /api/import/library
  // body: { data: [...], format?: 'json'|'csv'|'letterboxd' }
  async importLibrary(req, res) {
    const { data, format = 'json' } = req.body;

    if (!data) {
      throw new HttpError(400, 'Data is required');
    }

    let items;
    if (format === 'letterboxd') {
      items = mapLetterboxdLibrary(data);
    } else {
      items = parseImportData(data, 'library');
    }

    if (!items.length) {
      throw new HttpError(400, 'No valid items found in import data');
    }

    const result = await supabaseService.importLibrary(req.userId, items);
    res.json({ ...result, message: `Imported ${result.success} items, ${result.failed} failed` });
  },

  // POST /api/import/diary
  async importDiary(req, res) {
    const { data, format = 'json' } = req.body;

    if (!data) {
      throw new HttpError(400, 'Data is required');
    }

    let entries;
    if (format === 'letterboxd') {
      entries = mapLetterboxdDiary(data);
    } else {
      entries = parseImportData(data, 'diary');
    }

    if (!entries.length) {
      throw new HttpError(400, 'No valid entries found in import data');
    }

    const result = await supabaseService.importDiary(req.userId, entries);
    res.json({ ...result, message: `Imported ${result.success} entries, ${result.failed} failed` });
  },

  // POST /api/import/ratings
  async importRatings(req, res) {
    const { data, format = 'json' } = req.body;

    if (!data) {
      throw new HttpError(400, 'Data is required');
    }

    let ratings;
    if (format === 'letterboxd') {
      ratings = mapLetterboxdRatings(data);
    } else {
      ratings = parseImportData(data, 'ratings');
    }

    if (!ratings.length) {
      throw new HttpError(400, 'No valid ratings found in import data');
    }

    const result = await supabaseService.importRatings(req.userId, ratings);
    res.json({ ...result, message: `Imported ${result.success} ratings, ${result.failed} failed` });
  },

  // POST /api/import/full - Import all at once
  // body: { library: [...], diary: [...], ratings: [...], format?: 'json'|'letterboxd' }
  async importFull(req, res) {
    const { library, diary, ratings, format = 'json' } = req.body;

    const results = { library: { success: 0, failed: 0 }, diary: { success: 0, failed: 0 }, ratings: { success: 0, failed: 0 } };

    if (library?.length) {
      let items = library;
      if (format === 'letterboxd') items = mapLetterboxdLibrary(library);
      results.library = await supabaseService.importLibrary(req.userId, items);
    }

    if (diary?.length) {
      let entries = diary;
      if (format === 'letterboxd') entries = mapLetterboxdDiary(diary);
      results.diary = await supabaseService.importDiary(req.userId, entries);
    }

    if (ratings?.length) {
      let ratingEntries = ratings;
      if (format === 'letterboxd') ratingEntries = mapLetterboxdRatings(ratings);
      results.ratings = await supabaseService.importRatings(req.userId, ratingEntries);
    }

    res.json({
      ...results,
      message: `Library: ${results.library.success} ok, ${results.library.failed} failed. Diary: ${results.diary.success} ok, ${results.diary.failed} failed. Ratings: ${results.ratings.success} ok, ${results.ratings.failed} failed.`
    });
  },
};

module.exports = importController;