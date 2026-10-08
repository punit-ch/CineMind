// controllers/aiController.js
const geminiService = require('../services/geminiService');
const tmdbService = require('../services/tmdbService');
const { HttpError, cleanText, cleanList, toInt } = require('../utils/validate');

// Merge AI suggestions with TMDB data (aligned by index, so no fuzzy title matching)
async function enrichRecommendations(aiRecs) {
  const items = aiRecs
    .filter((r) => r && r.title)
    .map((r) => ({ title: String(r.title), year: toInt(r.year, undefined, { min: 1880, max: 2100 }) }));
  const valid = aiRecs.filter((r) => r && r.title);
  const tmdbData = await tmdbService.enrichMovieTitles(items);

  return valid.map((aiRec, i) => {
    const tmdb = tmdbData[i] || {};
    return {
      ...aiRec,
      ...tmdb,
      title: aiRec.title,
      year: aiRec.year || tmdb.releaseYear,
      matched: Boolean(tmdbData[i]),
    };
  });
}

const aiController = {
  // POST /api/ai/recommend
  async recommend(req, res) {
    const favoriteMovies = cleanList(req.body.favoriteMovies);
    const genres = cleanList(req.body.genres);
    const directors = cleanList(req.body.directors);
    const actors = cleanList(req.body.actors);
    const mood = cleanText(req.body.mood, 60);

    if (!favoriteMovies.length && !genres.length && !mood) {
      throw new HttpError(400, 'Please provide at least one preference (movies, genres, or mood)');
    }

    const aiRecs = await geminiService.getRecommendations({
      favoriteMovies, genres, directors, actors, mood,
    });
    const recommendations = await enrichRecommendations(aiRecs);
    res.json({ recommendations, count: recommendations.length });
  },

  // POST /api/ai/mood
  async moodRecommend(req, res) {
    const mood = cleanText(req.body.mood, 60);
    if (!mood) throw new HttpError(400, 'Mood is required');

    const aiRecs = await geminiService.getMoodRecommendations(mood);
    const recommendations = await enrichRecommendations(aiRecs);
    res.json({ mood, recommendations, count: recommendations.length });
  },

  // POST /api/ai/critic
  async critic(req, res) {
    const title = cleanText(req.body.title, 100);
    if (!title) throw new HttpError(400, 'Movie title is required');

    const [analysis, tmdbResults] = await Promise.allSettled([
      geminiService.analyzeMovie(title),
      tmdbService.searchMovies(title, 1),
    ]);

    if (analysis.status === 'rejected') throw analysis.reason;
    const result = analysis.value;

    if (tmdbResults.status === 'fulfilled' && tmdbResults.value.movies.length) {
      const tmdb = tmdbResults.value.movies[0];
      Object.assign(result, {
        poster: tmdb.poster,
        backdrop: tmdb.backdrop,
        tmdbRating: tmdb.rating,
        releaseYear: tmdb.releaseYear,
        genres: tmdb.genres,
        tmdbId: tmdb.id,
      });
    }

    res.json(result);
  },

  // POST /api/ai/plan
  async planNight(req, res) {
    const people = toInt(req.body.people, 0, { min: 0, max: 50 });
    if (people < 1) throw new HttpError(400, 'Number of people is required');

    const plan = await geminiService.planMovieNight({
      people,
      genres: cleanList(req.body.genres),
      mood: cleanText(req.body.mood, 60),
    });

    if (plan.mainPick?.title) {
      try {
        const [match] = await tmdbService.enrichMovieTitles([
          { title: plan.mainPick.title, year: plan.mainPick.year },
        ]);
        if (match) {
          plan.mainPick = { ...plan.mainPick, ...match, title: plan.mainPick.title };
        }
      } catch { /* poster is a nice-to-have */ }
    }

    res.json(plan);
  },

  // POST /api/ai/chat
  async chat(req, res) {
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length) {
      throw new HttpError(400, 'Messages are required');
    }
    if (messages.length > 40) throw new HttpError(400, 'Too many messages in history');

    const clean = messages
      .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content }));

    if (!clean.length || clean[clean.length - 1].role !== 'user') {
      throw new HttpError(400, 'The last message must come from the user');
    }

    const reply = await geminiService.chat(clean);
    res.json({ reply, role: 'assistant' });
  },

  // POST /api/ai/profile   body: { titles: string[] }
  async tasteProfile(req, res) {
    const profile = await geminiService.analyzeTasteProfile(req.body.titles);
    res.json(profile);
  },

  // POST /api/ai/compare
  async compareMovies(req, res) {
    const movie1 = cleanText(req.body.movie1, 100);
    const movie2 = cleanText(req.body.movie2, 100);
    if (!movie1 || !movie2) throw new HttpError(400, 'Two movie titles are required');

    const [comparison, tmdb1, tmdb2] = await Promise.allSettled([
      geminiService.compareMovies(movie1, movie2),
      tmdbService.searchMovies(movie1, 1),
      tmdbService.searchMovies(movie2, 1),
    ]);

    if (comparison.status === 'rejected') throw comparison.reason;
    const result = comparison.value;

    const first = (r) => (r.status === 'fulfilled' ? r.value.movies[0] : null);
    const m1 = first(tmdb1);
    const m2 = first(tmdb2);
    if (m1) Object.assign(result, { movie1Poster: m1.poster, movie1Year: m1.releaseYear });
    if (m2) Object.assign(result, { movie2Poster: m2.poster, movie2Year: m2.releaseYear });

    res.json(result);
  },
};

module.exports = aiController;
