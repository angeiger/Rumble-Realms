/**
 * The player's deck and card levels (D-048). Saved in the browser (localStorage).
 * M3: the level can be chosen freely (test mode); M4 replaces this by the real collection.
 */
import {
  ALL_UPGRADES_MASK,
  CARD_IDS,
  DECK_SIZE,
  MAX_LEVEL,
  UPGRADES_PER_CARD,
  type CardId,
} from '@rumble-realms/engine';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { START_DECK } from './config.ts';
import { safeStorage } from './safeStorage.ts';

export const DECK_STORAGE_KEY = 'rr.deck.v1';

export type CardLevels = Partial<Record<CardId, number>>;

/** Unlocked upgrades per card: bit mask 0..7, bit i = upgrade i. A missing card has all (D-073). */
export type CardUpgrades = Partial<Record<CardId, number>>;

export interface DeckData {
  /** Exactly `DECK_SIZE` different cards. */
  deck: CardId[];
  /** Levels 1..MAX_LEVEL; a missing card has level 1. */
  levels: CardLevels;
  /** Test mode (D-073): which upgrades are switched on; missing = all. */
  upgrades: CardUpgrades;
}

export interface DeckStore extends DeckData {
  /** Puts `card` into place `index`; if it already lies in another place, the two swap. */
  setSlot: (index: number, card: CardId) => void;
  /** Sets the level of `card` (rounded into 1..MAX_LEVEL). */
  setLevel: (card: CardId, level: number) => void;
  /** Switches upgrade `index` (0..2) of `card` on or off. */
  toggleUpgrade: (card: CardId, index: number) => void;
}

const KNOWN = new Set<string>(CARD_IDS);

function isCard(value: unknown): value is CardId {
  return typeof value === 'string' && KNOWN.has(value);
}

function isLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_LEVEL;
}

function isMask(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= ALL_UPGRADES_MASK
  );
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
  // Data saved before the upgrades existed has no such field: everything stays unlocked.
  const upgrades: CardUpgrades = {};
  const rawUpgrades = obj['upgrades'];
  if (rawUpgrades !== null && typeof rawUpgrades === 'object' && !Array.isArray(rawUpgrades)) {
    for (const [card, mask] of Object.entries(rawUpgrades)) {
      if (isCard(card) && isMask(mask)) upgrades[card] = mask;
    }
  }
  return { deck: validDeck ? [...(deck as CardId[])] : [...START_DECK], levels, upgrades };
}

/** Unlocked upgrade mask of `card`; all upgrades if none is stored. */
export function upgradesOf(upgrades: CardUpgrades, card: CardId): number {
  return upgrades[card] ?? ALL_UPGRADES_MASK;
}

/** Level of `card`, 1 if none is set. */
export function levelOf(levels: CardLevels, card: CardId): number {
  return levels[card] ?? 1;
}

export const useDeckStore = create<DeckStore>()(
  persist(
    (set) => ({
      deck: [...START_DECK],
      levels: {},
      upgrades: {},
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
      toggleUpgrade(card, index) {
        if (!isCard(card) || !Number.isInteger(index) || index < 0 || index >= UPGRADES_PER_CARD) {
          return;
        }
        set((state) => ({
          upgrades: { ...state.upgrades, [card]: upgradesOf(state.upgrades, card) ^ (1 << index) },
        }));
      },
    }),
    {
      name: DECK_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state): DeckData => ({
        deck: state.deck,
        levels: state.levels,
        upgrades: state.upgrades,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizeDeckData(persisted) }),
    },
  ),
);
