-- CineMind Supabase Schema
-- Run this in the Supabase SQL Editor to create all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Profiles ────────────────────────────────────────────────────────────────
-- Extended user profile data (linked to auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  email TEXT,
  avatar_url TEXT,
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: Users can only see/edit their own profile
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email, created_at, updated_at)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'username', NEW.email, NOW(), NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── Library Items ───────────────────────────────────────────────────────────
-- Personal movie/TV library (watchlist, watching, watched, dropped)
CREATE TABLE IF NOT EXISTS library_items (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  title TEXT NOT NULL,
  poster TEXT,
  release_year TEXT,
  genres TEXT[] DEFAULT '{}',
  rating NUMERIC(3,1) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'watchlist' CHECK (status IN ('watchlist', 'watching', 'watched', 'dropped')),
  user_rating INTEGER CHECK (user_rating >= 0 AND user_rating <= 10),
  user_notes TEXT,
  progress INTEGER DEFAULT 0,
  total_episodes INTEGER,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tmdb_id, media_type)
);

CREATE INDEX idx_library_user_id ON library_items(user_id);
CREATE INDEX idx_library_status ON library_items(user_id, status);
CREATE INDEX idx_library_media_type ON library_items(user_id, media_type);
CREATE INDEX idx_library_tmdb ON library_items(tmdb_id, media_type);

ALTER TABLE library_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own library" ON library_items
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own library items" ON library_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own library items" ON library_items
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own library items" ON library_items
  FOR DELETE USING (auth.uid() = user_id);

-- ─── Diary Entries ───────────────────────────────────────────────────────────
-- Viewing log with ratings, notes, rewatch tracking
CREATE TABLE IF NOT EXISTS diary_entries (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  title TEXT NOT NULL,
  poster TEXT,
  release_year TEXT,
  user_rating INTEGER CHECK (user_rating >= 0 AND user_rating <= 10),
  user_notes TEXT,
  watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rewatch BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_diary_user_id ON diary_entries(user_id);
CREATE INDEX idx_diary_watched_at ON diary_entries(user_id, watched_at DESC);
CREATE INDEX idx_diary_media_type ON diary_entries(user_id, media_type);
CREATE INDEX idx_diary_tmdb ON diary_entries(user_id, tmdb_id, media_type);

ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own diary" ON diary_entries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own diary entries" ON diary_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own diary entries" ON diary_entries
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own diary entries" ON diary_entries
  FOR DELETE USING (auth.uid() = user_id);

-- ─── Ratings History ─────────────────────────────────────────────────────────
-- Dedicated ratings table for quick stats and history
CREATE TABLE IF NOT EXISTS ratings_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  title TEXT NOT NULL,
  poster TEXT,
  release_year TEXT,
  user_rating INTEGER NOT NULL CHECK (user_rating >= 0 AND user_rating <= 10),
  rated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, tmdb_id, media_type)
);

CREATE INDEX idx_ratings_user_id ON ratings_history(user_id);
CREATE INDEX idx_ratings_rated_at ON ratings_history(user_id, rated_at DESC);

ALTER TABLE ratings_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ratings" ON ratings_history
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ratings" ON ratings_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ratings" ON ratings_history
  FOR UPDATE USING (auth.uid() = user_id);

-- ─── Queue (Up Next) ─────────────────────────────────────────────────────────
-- Ordered list of planned watches
CREATE TABLE IF NOT EXISTS queue_items (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  title TEXT NOT NULL,
  poster TEXT,
  release_year TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_queue_user_id ON queue_items(user_id);
CREATE INDEX idx_queue_position ON queue_items(user_id, position);

ALTER TABLE queue_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own queue" ON queue_items
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own queue items" ON queue_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own queue items" ON queue_items
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own queue items" ON queue_items
  FOR DELETE USING (auth.uid() = user_id);

-- ─── Helper Functions ────────────────────────────────────────────────────────

-- Function to get next queue position
CREATE OR REPLACE FUNCTION get_next_queue_position(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  max_pos INTEGER;
BEGIN
  SELECT COALESCE(MAX(position), 0) INTO max_pos
  FROM queue_items
  WHERE user_id = p_user_id;
  RETURN max_pos + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to reorder queue items (used by reorder API)
CREATE OR REPLACE FUNCTION reorder_queue_items(p_user_id UUID, p_items JSONB)
RETURNS VOID AS $$
DECLARE
  item JSONB;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE queue_items
    SET position = (item->>'position')::INTEGER,
        updated_at = NOW()
    WHERE id = (item->>'id')::BIGINT
    AND user_id = p_user_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Views for Stats ─────────────────────────────────────────────────────────

-- User stats view
CREATE OR REPLACE VIEW user_stats AS
SELECT
  u.id AS user_id,
  COUNT(DISTINCT CASE WHEN d.media_type = 'movie' THEN d.tmdb_id END) AS movies_watched,
  COUNT(DISTINCT CASE WHEN d.media_type = 'tv' THEN d.tmdb_id END) AS tv_shows_watched,
  COUNT(DISTINCT d.tmdb_id) AS total_watched,
  ROUND(AVG(r.user_rating)::NUMERIC, 1) AS average_rating,
  COUNT(DISTINCT CASE WHEN l.status = 'watchlist' THEN l.tmdb_id END) AS watchlist_count,
  COUNT(DISTINCT q.id) AS queue_count
FROM auth.users u
LEFT JOIN diary_entries d ON u.id = d.user_id
LEFT JOIN ratings_history r ON u.id = r.user_id
LEFT JOIN library_items l ON u.id = l.user_id
LEFT JOIN queue_items q ON u.id = q.user_id
GROUP BY u.id;

-- Top genres view
CREATE OR REPLACE VIEW user_top_genres AS
SELECT
  l.user_id,
  g AS genre,
  COUNT(*) AS count
FROM library_items l
CROSS JOIN LATERAL unnest(l.genres) AS g
WHERE l.status IN ('watched', 'watching')
GROUP BY l.user_id, g
ORDER BY l.user_id, count DESC;