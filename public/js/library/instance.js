// public/js/library/instance.js — The app-wide library store (one per page)
import { createLibraryStore } from './store.js';

let store = null;

export function getLibraryStore() {
  if (!store) {
    let storage;
    try {
      storage = window.localStorage;
    } catch {
      storage = { getItem: () => null, setItem: () => { throw new Error('storage unavailable'); } };
    }
    store = createLibraryStore(storage);
  }
  return store;
}
