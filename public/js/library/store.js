// public/js/library/store.js — Persists the library in browser storage (storage is injected for testing).
import { emptyLibrary, exportLibrary, parseImport, mergeLibraries } from './libraryCore.js';

export const STORAGE_KEY = 'cinemind_library_v1';

export function createLibraryStore(storage, { key = STORAGE_KEY } = {}) {
  const listeners = new Set();
  const status = { error: null, recoveredFromCorruption: false };
  let lib = load();

  function load() {
    let raw = null;
    try {
      raw = storage.getItem(key);
    } catch {
      status.error = 'Browser storage is unavailable, so your library will not be saved.';
      return emptyLibrary();
    }
    if (raw === null || raw === undefined) return emptyLibrary();
    try {
      return parseImport(raw).library;
    } catch {
      // Keep the unreadable data so nothing is silently lost, then start fresh
      try {
        storage.setItem(`${key}_corrupt_backup`, raw);
      } catch { /* nothing more we can do */ }
      status.recoveredFromCorruption = true;
      return emptyLibrary();
    }
  }

  function persist(next) {
    try {
      storage.setItem(key, exportLibrary(next));
      status.error = null;
    } catch {
      status.error = 'Could not save your library (browser storage is full or blocked).';
    }
  }

  function commit(next) {
    lib = next;
    persist(next);
    for (const fn of listeners) {
      try {
        fn(lib);
      } catch { /* a broken listener must not break the others */ }
    }
  }

  return {
    get: () => lib,
    status: () => ({ ...status }),
    // fn(lib) returns a new library, or { lib, ...extra }. If fn throws, nothing changes. Returns fn's result.
    update(fn) {
      const result = fn(lib);
      commit(result && result.lib ? result.lib : result);
      return result;
    },
    replace: (next) => commit(next),
    merge: (incoming) => commit(mergeLibraries(lib, incoming)),
    reset: () => commit(emptyLibrary()),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
