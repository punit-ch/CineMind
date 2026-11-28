// controllers/authController.js — Authentication handlers
const supabaseService = require('../services/supabaseService');
const { HttpError } = require('../utils/validate');

const authController = {
  // POST /api/auth/signup
  async signup(req, res) {
    if (!supabaseService.isConfigured()) {
      throw new HttpError(503, 'Authentication not configured. Please set up Supabase.');
    }

    const { email, password, username } = req.body;

    if (!email || !password) {
      throw new HttpError(400, 'Email and password are required');
    }

    if (password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters');
    }

    const supabase = require('@supabase/supabase-js').createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: username || email.split('@')[0] } }
    });

    if (error) {
      if (error.message.includes('already registered')) {
        throw new HttpError(409, 'An account with this email already exists');
      }
      throw new HttpError(400, error.message);
    }

    // Create profile
    if (data.user) {
      await supabaseService.upsertUserProfile(data.user.id, {
        username: username || email.split('@')[0],
        email,
        created_at: new Date().toISOString(),
      });
    }

    res.status(201).json({
      user: data.user,
      session: data.session,
      message: data.session ? 'Account created successfully' : 'Please check your email to confirm your account',
    });
  },

  // POST /api/auth/login
  async login(req, res) {
    if (!supabaseService.isConfigured()) {
      throw new HttpError(503, 'Authentication not configured. Please set up Supabase.');
    }

    const { email, password } = req.body;

    if (!email || !password) {
      throw new HttpError(400, 'Email and password are required');
    }

    const supabase = require('@supabase/supabase-js').createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      throw new HttpError(401, 'Invalid email or password');
    }

    res.json({
      user: data.user,
      session: data.session,
    });
  },

  // POST /api/auth/logout
  async logout(req, res) {
    if (!supabaseService.isConfigured()) {
      throw new HttpError(503, 'Authentication not configured.');
    }

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const supabase = require('@supabase/supabase-js').createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
      );
      await supabase.auth.signOut();
    }

    res.json({ message: 'Logged out successfully' });
  },

  // POST /api/auth/refresh
  async refresh(req, res) {
    if (!supabaseService.isConfigured()) {
      throw new HttpError(503, 'Authentication not configured.');
    }

    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw new HttpError(400, 'Refresh token required');
    }

    const supabase = require('@supabase/supabase-js').createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

    if (error) {
      throw new HttpError(401, 'Invalid refresh token');
    }

    res.json({ session: data.session });
  },

  // GET /api/auth/me
  async getMe(req, res) {
    if (!supabaseService.isConfigured()) {
      throw new HttpError(503, 'Authentication not configured.');
    }

    const { userId, user, error } = await supabaseService.verifyAuth(req);
    if (error) {
      throw new HttpError(401, error);
    }

    const profile = await supabaseService.getUserProfile(userId);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: profile?.username || user.user_metadata?.username || user.email.split('@')[0],
        avatar_url: user.user_metadata?.avatar_url || profile?.avatar_url,
        created_at: user.created_at,
      },
      profile,
    });
  },

  // PUT /api/auth/profile
  async updateProfile(req, res) {
    if (!supabaseService.isConfigured()) {
      throw new HttpError(503, 'Authentication not configured.');
    }

    const { userId, error } = await supabaseService.verifyAuth(req);
    if (error) {
      throw new HttpError(401, error);
    }

    const { username, avatar_url, preferences } = req.body;
    const updates = {};
    if (username) updates.username = username;
    if (avatar_url) updates.avatar_url = avatar_url;
    if (preferences) updates.preferences = preferences;

    const profile = await supabaseService.upsertUserProfile(userId, updates);

    res.json({ profile });
  },

  // DELETE /api/auth/account
  async deleteAccount(req, res) {
    if (!supabaseService.isConfigured()) {
      throw new HttpError(503, 'Authentication not configured.');
    }

    const { userId, error } = await supabaseService.verifyAuth(req);
    if (error) {
      throw new HttpError(401, error);
    }

    // Use admin client to delete user
    const { createClient } = require('@supabase/supabase-js');
    const admin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      throw new HttpError(500, 'Failed to delete account');
    }

    res.json({ message: 'Account deleted successfully' });
  },
};

module.exports = authController;