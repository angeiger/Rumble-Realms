/**
 * Progress of the collection (SPEC 7): level-up and upgrade costs, packs, Elo and the start
 * collection. Pure data without floating-point numbers: percentages are basis points
 * (1 % = 100). The logic that uses these values lives in `packages/shared`.
 */
import type { CardId, Rarity } from '../types.ts';
import { MAX_LEVEL } from './balance.ts';

/** Card level required to unlock upgrade 1, 2 and 3 of a card (SPEC 7.3). */
export const UPGRADE_UNLOCK_LEVELS: readonly [number, number, number] = [2, 3, MAX_LEVEL];

/**
 * Bit mask (bit i = upgrade i) of the upgrades a card of `level` can have unlocked
 * (SPEC 7.3). Used for bots, which own every upgrade their card level allows (D-073).
 */
export function upgradesForLevel(level: number): number {
  let mask = 0;
  for (let i = 0; i < UPGRADE_UNLOCK_LEVELS.length; i++) {
    if (level >= (UPGRADE_UNLOCK_LEVELS[i] as number)) mask |= 1 << i;
  }
  return mask;
}

/** Cost of one level-up (SPEC 7.2): copies of the card by rarity plus gold. */
export interface LevelUpCost {
  copies: Record<Rarity, number>;
  gold: number;
}

/** Index 0 = level 1 to 2, ..., index 3 = level 4 to 5 (SPEC 7.2). */
export const LEVEL_UP_COSTS: readonly LevelUpCost[] = [
  { copies: { common: 5, rare: 3, epic: 1 }, gold: 100 },
  { copies: { common: 10, rare: 6, epic: 3 }, gold: 300 },
  { copies: { common: 20, rare: 12, epic: 6 }, gold: 800 },
  { copies: { common: 40, rare: 24, epic: 12 }, gold: 2000 },
];

/** Gold to unlock upgrade 1, 2 and 3 (SPEC 7.3); the required levels are `UPGRADE_UNLOCK_LEVELS`. */
export const UPGRADE_UNLOCK_GOLD: readonly [number, number, number] = [200, 600, 1500];

/** Jokers needed for one copy of a card of the given rarity (SPEC 7.4). */
export const JOKERS_PER_COPY: Record<Rarity, number> = { common: 1, rare: 2, epic: 4 };

/** Inclusive integer range. */
export interface IntRange {
  min: number;
  max: number;
}

/** Reward pack (SPEC 7.4). Weights are in basis points and sum to 10000 per group. */
export const PACK = {
  kindWeights: { cards: 6000, gold: 3000, jokers: 1000 },
  rarityWeights: { common: 7000, rare: 2500, epic: 500 },
  copies: {
    common: { min: 3, max: 8 },
    rare: { min: 2, max: 4 },
    epic: { min: 1, max: 2 },
  },
  gold: { min: 50, max: 150 },
  jokers: { min: 1, max: 3 },
} as const satisfies {
  kindWeights: Record<'cards' | 'gold' | 'jokers', number>;
  rarityWeights: Record<Rarity, number>;
  copies: Record<Rarity, IntRange>;
  gold: IntRange;
  jokers: IntRange;
};

/** The onboarding pack (SPEC 9.5). Assumption: 2 copies = lower bound of "rare". Recorded in DECISIONS by the coordinator. */
export const WELCOME_PACK: { card: CardId; copies: number } = { card: 'musketeer', copies: 2 };

/** Consolation gold after a lost match (SPEC 7.4). */
export const LOSS_GOLD = 10;

/** Elo parameters (SPEC 7.5). */
export const ELO = {
  start: 1000,
  /** K factor during the first `provisionalGames` games. */
  kProvisional: 48,
  k: 32,
  provisionalGames: 20,
  /** Against bots K is divided by this. */
  botKDivisor: 2,
} as const;

/** Start collection of a new player, all at level 1 (SPEC 7.1). */
export const STARTER_CARDS: readonly CardId[] = [
  'archer',
  'knight',
  'skeleton',
  'bat',
  'tnt',
  'healer',
];
export const STARTER_DECK: readonly CardId[] = ['archer', 'knight', 'skeleton', 'healer'];
/** Copies a start card is owned with. */
export const STARTER_COPIES = 1;

/** Free username changes after the first choice (SPEC 9.3). */
export const FREE_RENAMES = 1;
