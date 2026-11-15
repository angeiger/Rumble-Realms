/**
 * The player's deck and card levels (D-048). Saved in the browser (localStorage).
 * M3: the level can be chosen freely (test mode); M4 replaces this by the real collection.
 */
import { CARD_IDS, DECK_SIZE, MAX_LEVEL, type CardId } from '@rumble-realms/engine';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { START_DECK } from './config.ts';

export const DECK_STORAGE_KEY = 'rr.deck.v1';

export type CardLevels = Partial<Record<CardId, number>>;

export interface DeckData {
  /** Exactly `DECK_SIZE` different cards. */
  deck: CardId[];
  /** Levels 1..MAX_LEVEL; a missing card has level 1. */
  levels: CardLevels;
}

export interface DeckStore extends DeckData {
  /** Puts `card` into place `index`; if it already lies in another place, the two swap. */
  setSlot: (index: number, card: CardId) => void;
  /** Sets the level of `card` (rounded into 1..MAX_LEVEL). */
  setLevel: (card: CardId, level: number) => void;
}

const KNOWN = new Set<string>(CARD_IDS);

function isCard(value: unknown): value is CardId {
  return typeof value === 'string' && KNOWN.has(value);
}

function isLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_LEVEL;
}

/** Whatever was stored (possibly damaged or from another version) -> valid deck data. */
export function sanitizeDeckData(raw: unknown): DeckData {
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const deck = obj['deck'];
  const validDeck =
    Array.isArray(deck) &&
    deck.length === DECK_SIZE &&
    deck.every(isCard) &&
    new Set(deck).size === DECK_SIZE;
  const levels: CardLevels = {};
  const rawLevels = obj['levels'];
  if (rawLevels !== null && typeof rawLevels === 'object' && !Array.isArray(rawLevels)) {
    for (const [card, level] of Object.entries(rawLevels)) {
      if (isCard(card) && isLevel(level)) levels[card] = level;
    }
  }
  return { deck: validDeck ? [...(deck as CardId[])] : [...START_DECK], levels };
}

/** Level of `card`, 1 if none is set. */
export function levelOf(levels: CardLevels, card: CardId): number {
  return levels[card] ?? 1;
}

/** localStorage that never throws: missing (tests, SSR), blocked or full means "no storage". */
const safeStorage: StateStorage = {
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

export const useDeckStore = create<DeckStore>()(
  persist(
    (set) => ({
      deck: [...START_DECK],
      levels: {},
      setSlot(index, card) {
        if (!Number.isInteger(index) || index < 0 || index >= DECK_SIZE || !isCard(card)) return;
        set((state) => {
          const deck = [...state.deck];
          const from = deck.indexOf(card);
          if (from === index) return state;
          if (from >= 0) deck[from] = deck[index] as CardId;
          deck[index] = card;
          return { deck };
        });
      },
      setLevel(card, level) {
        if (!isCard(card) || !Number.isFinite(level)) return;
        const next = Math.min(MAX_LEVEL, Math.max(1, Math.round(level)));
        set((state) => ({ levels: { ...state.levels, [card]: next } }));
      },
    }),
    {
      name: DECK_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state): DeckData => ({ deck: state.deck, levels: state.levels }),
      merge: (persisted, current) => ({ ...current, ...sanitizeDeckData(persisted) }),
    },
  ),
);
