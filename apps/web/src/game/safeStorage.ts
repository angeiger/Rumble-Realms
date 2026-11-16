import type { StateStorage } from 'zustand/middleware';

/** localStorage that never throws: missing (tests, SSR), blocked or full means "no storage". */
export const safeStorage: StateStorage = {
  getItem(name) {
    try {
      return globalThis.localStorage?.getItem(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      globalThis.localStorage?.setItem(name, value);
    } catch {
      // Private mode or quota: the deck then only lasts until the page is closed.
    }
  },
  removeItem(name) {
    try {
      globalThis.localStorage?.removeItem(name);
    } catch {
      // See setItem.
    }
  },
};
