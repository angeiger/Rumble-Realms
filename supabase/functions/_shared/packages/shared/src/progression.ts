/**
 * Pure rules of the meta game (SPEC 7): arenas, level-ups, upgrades, jokers, deck check,
 * Elo and reward packs. All numbers come from the engine data. Used by client (preview,
 * buttons) and server (authoritative check). Runs in browser, Node and Deno.
 */
import {
  ARENAS,
  CARD_IDS,
  CARDS,
  DECK_SIZE,
  ELO,
  JOKERS_PER_COPY,
  LEVEL_UP_COSTS,
  MAX_LEVEL,
  PACK,
  UPGRADE_UNLOCK_GOLD,
  UPGRADE_UNLOCK_LEVELS,
  WELCOME_PACK,
} from '../../engine/src/index.ts';
import type { CardId, Rarity, UpgradeIndex } from '../../engine/src/index.ts';
import type { ApiErrorCode, PackReward } from './protocol.ts';

/** A card in the player's collection. */
export interface OwnedCard {
  level: number;
  copies: number;
  /** Bit mask, bit i = upgrade i. */
  unlockedUpgrades: number;
}

const BPS = 10000;
const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic'];

function isCardId(value: unknown): value is CardId {
  return typeof value === 'string' && Object.hasOwn(CARDS, value);
}

// ---------------------------------------------------------------------------
// Arenas
// ---------------------------------------------------------------------------

/** Highest arena whose Elo threshold is reached (at least arena 1). */
export function arenaForElo(elo: number): number {
  let arena = ARENAS[0]?.id ?? 1;
  for (const a of ARENAS) if (elo >= a.minElo) arena = a.id;
  return arena;
}

export function isInPool(card: CardId, highestArena: number): boolean {
  return CARDS[card].arena <= highestArena;
}

/** All cards of the arenas up to `highestArena`, in the order of CARD_IDS. */
export function cardPool(highestArena: number): CardId[] {
  return CARD_IDS.filter((id) => isInPool(id, highestArena));
}

/** Gold multiplier of the arena in basis points (unknown arenas are clamped). */
function goldMultiplierBps(highestArena: number): number {
  const first = ARENAS[0];
  let bps = first ? first.goldMultiplierBps : BPS;
  for (const a of ARENAS) if (a.id <= highestArena) bps = a.goldMultiplierBps;
  return bps;
}

// ---------------------------------------------------------------------------
// Level-up and upgrades
// ---------------------------------------------------------------------------

/** Cost of the step from `level` to `level + 1`; null at MAX_LEVEL or for invalid levels. */
export function levelUpCost(card: CardId, level: number): { copies: number; gold: number } | null {
  if (!Number.isInteger(level) || level < 1 || level >= MAX_LEVEL) return null;
  const cost = LEVEL_UP_COSTS[level - 1];
  if (!cost) return null;
  return { copies: cost.copies[CARDS[card].rarity], gold: cost.gold };
}

export function checkLevelUp(
  card: CardId,
  owned: OwnedCard | undefined,
  gold: number,
): ApiErrorCode | null {
  if (!owned) return 'card_not_owned';
  const cost = levelUpCost(card, owned.level);
  if (!cost) return 'max_level';
  if (owned.copies < cost.copies) return 'not_enough_copies';
  if (gold < cost.gold) return 'not_enough_gold';
  return null;
}

export function upgradeUnlockCost(upgrade: UpgradeIndex): { level: number; gold: number } {
  return {
    level: UPGRADE_UNLOCK_LEVELS[upgrade],
    gold: UPGRADE_UNLOCK_GOLD[upgrade],
  };
}

export function checkUnlockUpgrade(
  owned: OwnedCard | undefined,
  upgrade: UpgradeIndex,
  gold: number,
): ApiErrorCode | null {
  if (!owned) return 'card_not_owned';
  if ((owned.unlockedUpgrades & (1 << upgrade)) !== 0) return 'upgrade_already_unlocked';
  const cost = upgradeUnlockCost(upgrade);
  if (owned.level < cost.level) return 'level_too_low';
  if (gold < cost.gold) return 'not_enough_gold';
  return null;
}

// ---------------------------------------------------------------------------
// Jokers and deck
// ---------------------------------------------------------------------------

/** Most copies one `spend_jokers` call may buy. */
export const MAX_JOKER_COPIES = 999;

export function jokerCost(card: CardId, copies: number): number {
  return copies * JOKERS_PER_COPY[CARDS[card].rarity];
}

export function checkSpendJokers(
  card: CardId,
  copies: number,
  jokers: number,
  highestArena: number,
): ApiErrorCode | null {
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_JOKER_COPIES) return 'bad_request';
  if (!isCardId(card) || !isInPool(card, highestArena)) return 'card_not_in_pool';
  if (jokers < jokerCost(card, copies)) return 'not_enough_jokers';
  return null;
}

/** Exactly DECK_SIZE different, known, owned cards. */
export function checkDeck(cards: unknown, owned: ReadonlySet<string>): ApiErrorCode | null {
  if (!Array.isArray(cards) || cards.length !== DECK_SIZE) return 'deck_invalid';
  const seen = new Set<string>();
  for (const c of cards as unknown[]) {
    if (!isCardId(c) || !owned.has(c) || seen.has(c)) return 'deck_invalid';
    seen.add(c);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Elo
// ---------------------------------------------------------------------------

/**
 * Elo change of one player after a match (SPEC 7.5): round(K * (score - E)), with
 * K = kProvisional in the first provisionalGames games (gamesPlayed < provisionalGames),
 * else k; against bots K / botKDivisor. Never takes the Elo below 0.
 */
export function eloChange(a: {
  elo: number;
  opponentElo: number;
  score: 0 | 0.5 | 1;
  gamesPlayed: number;
  vsBot: boolean;
}): number {
  let k = a.gamesPlayed < ELO.provisionalGames ? ELO.kProvisional : ELO.k;
  if (a.vsBot) k /= ELO.botKDivisor;
  const expected = 1 / (1 + 10 ** ((a.opponentElo - a.elo) / 400));
  const delta = Math.max(Math.round(k * (a.score - expected)), -a.elo);
  return delta === 0 ? 0 : delta; // normalizes -0
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

type RandInt = (n: number) => number;

/** Index of the entry hit by `randInt(sum of weights)` (one call). */
function pickWeighted<K extends string>(
  randInt: RandInt,
  weights: Readonly<Record<K, number>>,
  order: readonly K[],
): K {
  let total = 0;
  for (const k of order) total += weights[k];
  let r = randInt(total);
  for (const k of order) {
    if (r < weights[k]) return k;
    r -= weights[k];
  }
  return order[order.length - 1] as K;
}

/** Uniform integer in [min, max] (one call). */
function randRange(randInt: RandInt, range: { min: number; max: number }): number {
  return range.min + randInt(range.max - range.min + 1);
}

/**
 * Rolls one reward pack (SPEC 7.4). `randInt(n)` returns a uniform integer 0..n-1.
 * Fixed order of calls:
 *   1. kind (weights cards / gold / jokers)
 *   2. cards:  rarity (weights), card (uniform among the pool cards of that rarity),
 *              copies (uniform in the range of the card's rarity)
 *      gold:   base amount 50..150 (floored after the arena multiplier)
 *      jokers: amount 1..3
 * If the pool has no card of the rolled rarity (arena 1 has no epic), the next lower rarity
 * that exists is used.
 */
export function rollPack(randInt: RandInt, highestArena: number): PackReward {
  const kind = pickWeighted(randInt, PACK.kindWeights, ['cards', 'gold', 'jokers']);
  if (kind === 'gold') {
    const base = randRange(randInt, PACK.gold);
    return { kind: 'gold', gold: Math.floor((base * goldMultiplierBps(highestArena)) / BPS) };
  }
  if (kind === 'jokers') {
    return { kind: 'jokers', jokers: randRange(randInt, PACK.jokers) };
  }
  const pool = cardPool(highestArena);
  let rarity = pickWeighted(randInt, PACK.rarityWeights, RARITIES);
  let candidates = pool.filter((id) => CARDS[id].rarity === rarity);
  for (let i = RARITIES.indexOf(rarity); candidates.length === 0 && i > 0;) {
    i--;
    rarity = RARITIES[i] as Rarity;
    candidates = pool.filter((id) => CARDS[id].rarity === rarity);
  }
  const card = candidates[randInt(candidates.length)] as CardId;
  return { kind: 'cards', card, copies: randRange(randInt, PACK.copies[CARDS[card].rarity]) };
}

/** The guaranteed onboarding pack (SPEC 9.5). */
export function welcomeReward(): PackReward {
  return { kind: 'cards', card: WELCOME_PACK.card, copies: WELCOME_PACK.copies };
}

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/** Strict check of a stored reward (data from the database). */
export function packRewardValid(value: unknown): value is PackReward {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v).sort().join(',');
  switch (v.kind) {
    case 'cards':
      return (
        keys === 'card,copies,kind' &&
        isCardId(v.card) &&
        isIntIn(
          v.copies,
          PACK.copies[CARDS[v.card].rarity].min,
          PACK.copies[CARDS[v.card].rarity].max,
        )
      );
    case 'gold': {
      const top = Math.max(...ARENAS.map((a) => a.goldMultiplierBps));
      const max = Math.floor((PACK.gold.max * top) / BPS);
      return keys === 'gold,kind' && isIntIn(v.gold, PACK.gold.min, max);
    }
    case 'jokers':
      return keys === 'jokers,kind' && isIntIn(v.jokers, PACK.jokers.min, PACK.jokers.max);
    default:
      return false;
  }
}
