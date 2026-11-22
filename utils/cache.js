// utils/cache.js — Simple TTL in-memory cache
const { cache: cacheConfig } = require('../config');

class TTLCache {
  constructor(ttl = cacheConfig.ttl) {
    this.store = new Map();
    this.ttl = ttl;
  }

  set(key, value, customTtl) {
    const expiry = Date.now() + (customTtl || this.ttl);
    this.store.set(key, { value, expiry });
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.store.delete(key);
  }

  // Cleanup expired entries every 5 minutes
  startCleanup() {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (now > entry.expiry) this.store.delete(key);
      }
    }, 5 * 60 * 1000);
    // Don't keep the process (or a test run) alive just for cleanup
    if (typeof timer.unref === 'function') timer.unref();
    return this;
  }
}

// Singleton cache instance
const cache = new TTLCache().startCleanup();
module.exports = cache;
