// services/supabaseService.js — Supabase client and database operations
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// Create Supabase client (uses anon key for client-side, service role for server-side admin)
let supabase = null;
let supabaseAdmin = null;

if (config.supabase.url && config.supabase.anonKey) {
  supabase = createClient(config.supabase.url, config.supabase.anonKey);
  if (config.supabase.serviceRoleKey) {
    supabaseAdmin = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
}

function isConfigured() {
  return !!supabase;
}

// ─── Auth Helpers ────────────────────────────────────────────────────────────────

// Get user from JWT token (Authorization header)
async function getUserFromToken(token) {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// Verify a user's session and return their ID
async function verifyAuth(req) {
  if (!supabase) return { userId: null, error: 'Supabase not configured' };

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { userId: null, error: 'Missing Authorization header' };
  }

  const token = authHeader.slice(7);
  const user = await getUserFromToken(token);
  if (!user) {
    return { userId: null, error: 'Invalid or expired token' };
  }

  return { userId: user.id, user };
}

// ─── User Profile ────────────────────────────────────────────────────────────────

async function getUserProfile(userId) {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}

async function upsertUserProfile(userId, profile) {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .upsert({ id: userId, ...profile, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Library (Movies/TV in personal collection) ──────────────────────────────────

const LIBRARY_TABLE = 'library_items';

async function getLibrary(userId, options = {}) {
  if (!supabaseAdmin) return [];
  let query = supabaseAdmin
    .from(LIBRARY_TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (options.status) query = query.eq('status', options.status);
  if (options.mediaType) query = query.eq('media_type', options.mediaType);
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function addToLibrary(userId, item) {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from(LIBRARY_TABLE)
    .upsert({
      user_id: userId,
      tmdb_id: item.tmdbId,
      media_type: item.mediaType || 'movie',
      title: item.title,
      poster: item.poster,
      release_year: item.releaseYear,
      genres: item.genres || [],
      rating: item.rating || 0,
      status: item.status || 'watchlist', // watchlist, watching, watched, dropped
      user_rating: item.userRating,
      user_notes: item.userNotes,
      progress: item.progress || 0, // for TV: episodes watched; for movies: 0 or 1
      total_episodes: item.totalEpisodes,
      added_at: item.addedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,tmdb_id,media_type' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateLibraryItem(userId, tmdbId, mediaType, updates) {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from(LIBRARY_TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('tmdb_id', tmdbId)
    .eq('media_type', mediaType)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function removeFromLibrary(userId, tmdbId, mediaType) {
  if (!supabaseAdmin) return false;
  const { error } = await supabaseAdmin
    .from(LIBRARY_TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('tmdb_id', tmdbId)
    .eq('media_type', mediaType);
  if (error) throw error;
  return true;
}

// ─── Diary (Viewing Log) ─────────────────────────────────────────────────────────

const DIARY_TABLE = 'diary_entries';

async function getDiary(userId, options = {}) {
  if (!supabaseAdmin) return [];
  let query = supabaseAdmin
    .from(DIARY_TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('watched_at', { ascending: false });

  if (options.limit) query = query.limit(options.limit);
  if (options.mediaType) query = query.eq('media_type', options.mediaType);
  if (options.fromDate) query = query.gte('watched_at', options.fromDate);
  if (options.toDate) query = query.lte('watched_at', options.toDate);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function addDiaryEntry(userId, entry) {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from(DIARY_TABLE)
    .insert({
      user_id: userId,
      tmdb_id: entry.tmdbId,
      media_type: entry.mediaType || 'movie',
      title: entry.title,
      poster: entry.poster,
      release_year: entry.releaseYear,
      user_rating: entry.userRating,
      user_notes: entry.userNotes,
      watched_at: entry.watchedAt || new Date().toISOString(),
      rewatch: entry.rewatch || false,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateDiaryEntry(userId, entryId, updates) {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from(DIARY_TABLE)
    .update(updates)
    .eq('id', entryId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteDiaryEntry(userId, entryId) {
  if (!supabaseAdmin) return false;
  const { error } = await supabaseAdmin
    .from(DIARY_TABLE)
    .delete()
    .eq('id', entryId)
    .eq('user_id', userId);
  if (error) throw error;
  return true;
}

// ─── Ratings History ──────────────────────────────────────────────────────────────

const RATINGS_TABLE = 'ratings_history';

async function getRatingsHistory(userId, options = {}) {
  if (!supabaseAdmin) return [];
  let query = supabaseAdmin
    .from(RATINGS_TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('rated_at', { ascending: false });

  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function addRating(userId, rating) {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from(RATINGS_TABLE)
    .upsert({
      user_id: userId,
      tmdb_id: rating.tmdbId,
      media_type: rating.mediaType || 'movie',
      title: rating.title,
      poster: rating.poster,
      release_year: rating.releaseYear,
      user_rating: rating.userRating,
      rated_at: rating.ratedAt || new Date().toISOString(),
    }, { onConflict: 'user_id,tmdb_id,media_type' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Queue (Up Next / Planned) ───────────────────────────────────────────────────

const QUEUE_TABLE = 'queue_items';

async function getQueue(userId, options = {}) {
  if (!supabaseAdmin) return [];
  let query = supabaseAdmin
    .from(QUEUE_TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('position', { ascending: true });

  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function addToQueue(userId, item) {
  if (!supabaseAdmin) return null;
  // Get max position
  const { data: maxPos } = await supabaseAdmin
    .from(QUEUE_TABLE)
    .select('position')
    .eq('user_id', userId)
    .order('position', { ascending: false })
    .limit(1);

  const nextPosition = (maxPos?.[0]?.position || 0) + 1;

  const { data, error } = await supabaseAdmin
    .from(QUEUE_TABLE)
    .insert({
      user_id: userId,
      tmdb_id: item.tmdbId,
      media_type: item.mediaType || 'movie',
      title: item.title,
      poster: item.poster,
      release_year: item.releaseYear,
      position: nextPosition,
      notes: item.notes,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function reorderQueue(userId, items) {
  if (!supabaseAdmin) return false;
  // items: [{ id, position }]
  const updates = items.map(({ id, position }) =>
    supabaseAdmin.from(QUEUE_TABLE).update({ position }).eq('id', id).eq('user_id', userId)
  );
  await Promise.all(updates);
  return true;
}

async function removeFromQueue(userId, queueId) {
  if (!supabaseAdmin) return false;
  const { error } = await supabaseAdmin
    .from(QUEUE_TABLE)
    .delete()
    .eq('id', queueId)
    .eq('user_id', userId);
  if (error) throw error;
  return true;
}

// ─── Stats / Aggregates ──────────────────────────────────────────────────────────

async function getUserStats(userId) {
  if (!supabaseAdmin) return {};

  const [
    { count: moviesWatched },
    { count: tvWatched },
    { data: ratings },
    { count: watchlistCount },
    { count: queueCount },
  ] = await Promise.all([
    supabaseAdmin.from(DIARY_TABLE).select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('media_type', 'movie'),
    supabaseAdmin.from(DIARY_TABLE).select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('media_type', 'tv'),
    supabaseAdmin.from(RATINGS_TABLE).select('user_rating').eq('user_id', userId),
    supabaseAdmin.from(LIBRARY_TABLE).select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'watchlist'),
    supabaseAdmin.from(QUEUE_TABLE).select('*', { count: 'exact', head: true }).eq('user_id', userId),
  ]);

  const avgRating = ratings?.length
    ? (ratings.reduce((sum, r) => sum + r.user_rating, 0) / ratings.length).toFixed(1)
    : 0;

  // Genre breakdown
  const { data: library } = await supabaseAdmin
    .from(LIBRARY_TABLE)
    .select('genres, status')
    .eq('user_id', userId)
    .in('status', ['watched', 'watching']);

  const genreCounts = {};
  library?.forEach(item => {
    (item.genres || []).forEach(g => {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
  });

  const topGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, count]) => ({ genre, count }));

  return {
    moviesWatched: moviesWatched || 0,
    tvShowsWatched: tvWatched || 0,
    totalWatched: (moviesWatched || 0) + (tvWatched || 0),
    averageRating: Number(avgRating),
    watchlistCount: watchlistCount || 0,
    queueCount: queueCount || 0,
    topGenres,
  };
}

// ─── Data Import (from JSON/CSV) ─────────────────────────────────────────────────

async function importLibrary(userId, items) {
  if (!supabaseAdmin) return { success: 0, failed: 0 };

  let success = 0;
  let failed = 0;

  for (const item of items) {
    try {
      await addToLibrary(userId, item);
      success++;
    } catch {
      failed++;
    }
  }

  return { success, failed };
}

async function importDiary(userId, entries) {
  if (!supabaseAdmin) return { success: 0, failed: 0 };

  let success = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      await addDiaryEntry(userId, entry);
      success++;
    } catch {
      failed++;
    }
  }

  return { success, failed };
}

async function importRatings(userId, ratings) {
  if (!supabaseAdmin) return { success: 0, failed: 0 };

  let success = 0;
  let failed = 0;

  for (const rating of ratings) {
    try {
      await addRating(userId, rating);
      success++;
    } catch {
      failed++;
    }
  }

  return { success, failed };
}

module.exports = {
  isConfigured,
  verifyAuth,
  getUserProfile,
  upsertUserProfile,
  // Library
  getLibrary,
  addToLibrary,
  updateLibraryItem,
  removeFromLibrary,
  // Diary
  getDiary,
  addDiaryEntry,
  updateDiaryEntry,
  deleteDiaryEntry,
  // Ratings
  getRatingsHistory,
  addRating,
  // Queue
  getQueue,
  addToQueue,
  reorderQueue,
  removeFromQueue,
  // Stats
  getUserStats,
  // Import
  importLibrary,
  importDiary,
  importRatings,
};