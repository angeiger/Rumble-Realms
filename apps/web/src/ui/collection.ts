/**
 * Pure logic of the collection (deck tab, SPEC 7 and 10): what a card looks like for this
 * player, what a level-up or an upgrade costs and whether it can be paid, deck changes.
 * All numbers and checks come from `@rumble-realms/shared`.
 */
import {
  ARENAS,
  CARDS,
  DECK_SIZE,
  MAX_LEVEL,
  UPGRADES_PER_CARD,
  type CardId,
  type UpgradeIndex,
} from '@rumble-realms/engine';
import {
  checkLevelUp,
  checkSpendJokers,
  checkUnlockUpgrade,
  isInPool,
  jokerCost,
  levelUpCost,
  upgradeUnlockCost,
  type ApiErrorCode,
  type OwnedCard,
} from '@rumble-realms/shared';
import type { PlayerState } from '../backend/types.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { errorText, type UiErrorCode } from './accountText.ts';

/** owned = at least one copy; missing = arena reached but not found yet; locked = arena not reached. */
export type CardStatus = 'owned' | 'missing' | 'locked';

export function cardStatus(player: PlayerState, card: CardId): CardStatus {
  if (player.cards[card] !== undefined) return 'owned';
  return isInPool(card, player.highestArena) ? 'missing' : 'locked';
}

/** The arena a card comes from and the Elo needed to reach it. */
export function arenaOfCard(card: CardId): { arena: number; minElo: number } {
  const arena = CARDS[card].arena;
  const def = ARENAS.find((a) => a.id === arena);
  return { arena, minElo: def?.minElo ?? 0 };
}

export interface LevelProgress {
  level: number;
  copies: number;
  /** Copies needed for the next level; null at the highest level. */
  needed: number | null;
  /** 0..1 (1 at the highest level). */
  ratio: number;
  /** Copies and gold suffice for a level-up right now. */
  canLevel: boolean;
}

export function levelProgress(card: CardId, owned: OwnedCard, gold: number): LevelProgress {
  const cost = levelUpCost(card, owned.level);
  if (cost === null) {
    return { level: owned.level, copies: owned.copies, needed: null, ratio: 1, canLevel: false };
  }
  return {
    level: owned.level,
    copies: owned.copies,
    needed: cost.copies,
    ratio: Math.min(1, owned.copies / cost.copies),
    canLevel: checkLevelUp(card, owned, gold) === null,
  };
}

/** "3/5", or "MAX" at the highest level. */
export function progressText(p: LevelProgress): string {
  return p.needed === null ? t('collection.max') : `${p.copies}/${p.needed}`;
}

/**
 * The deck after tapping `card` for place `slot`: the card is put there; if it already lies in
 * another place, the two cards swap. Returns the same array if nothing changes.
 */
export function placeInDeck(deck: readonly CardId[], slot: number, card: CardId): CardId[] {
  const next = [...deck];
  if (slot < 0 || slot >= DECK_SIZE || next[slot] === card) return next;
  const other = next.indexOf(card);
  const old = next[slot];
  if (other >= 0 && old !== undefined) next[other] = old;
  next[slot] = card;
  return next;
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

export interface LevelUpInfo {
  /** Cost of the step to the next level. */
  copies: number;
  gold: number;
  haveCopies: number;
  haveGold: number;
  /** null = possible; else the reason (copies are checked before gold). */
  blocked: Extract<ApiErrorCode, 'not_enough_copies' | 'not_enough_gold'> | null;
}

/** null at the highest level or for a card that is not owned. */
export function levelUpInfo(
  card: CardId,
  owned: OwnedCard | undefined,
  gold: number,
): LevelUpInfo | null {
  if (owned === undefined) return null;
  const cost = levelUpCost(card, owned.level);
  if (cost === null) return null;
  const code = checkLevelUp(card, owned, gold);
  return {
    copies: cost.copies,
    gold: cost.gold,
    haveCopies: owned.copies,
    haveGold: gold,
    blocked: code === 'not_enough_copies' || code === 'not_enough_gold' ? code : null,
  };
}

export type UpgradeState =
  | { kind: 'unlocked' }
  /** Level is high enough and gold suffices. */
  | { kind: 'available'; gold: number }
  | { kind: 'no_gold'; gold: number }
  | { kind: 'level'; level: number };

export function upgradeState(owned: OwnedCard, upgrade: UpgradeIndex, gold: number): UpgradeState {
  const cost = upgradeUnlockCost(upgrade);
  switch (checkUnlockUpgrade(owned, upgrade, gold)) {
    case null:
      return { kind: 'available', gold: cost.gold };
    case 'upgrade_already_unlocked':
      return { kind: 'unlocked' };
    case 'level_too_low':
      return { kind: 'level', level: cost.level };
    default:
      return { kind: 'no_gold', gold: cost.gold };
  }
}

export function upgradeStates(owned: OwnedCard, gold: number): UpgradeState[] {
  const out: UpgradeState[] = [];
  for (let i = 0; i < UPGRADES_PER_CARD; i++)
    out.push(upgradeState(owned, i as UpgradeIndex, gold));
  return out;
}

export interface JokerOffer {
  /** Jokers for one copy of this card. */
  cost: number;
  have: number;
  enough: boolean;
}

/**
 * The "copy for jokers" offer: only for cards of reached arenas (owned or not) and not at the
 * highest level; otherwise null.
 */
export function jokerOffer(player: PlayerState, card: CardId): JokerOffer | null {
  if (!isInPool(card, player.highestArena)) return null;
  const owned = player.cards[card];
  if (owned !== undefined && owned.level >= MAX_LEVEL) return null;
  return {
    cost: jokerCost(card, 1),
    have: player.jokers,
    enough: checkSpendJokers(card, 1, player.jokers, player.highestArena) === null,
  };
}

/** Value of a stat on the current level and, if it grows, on the next level ("560 → 616"). */
export function previewText(now: string, next: string | null): string {
  return next === null || next === now ? now : `${now} → ${next}`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const COLLECTION_ERRORS: Partial<Record<UiErrorCode, MessageKey>> = {
  card_not_owned: 'error.card_not_owned',
  card_not_in_pool: 'error.card_not_in_pool',
  deck_invalid: 'error.deck_invalid',
  max_level: 'error.max_level',
  not_enough_copies: 'error.not_enough_copies',
  not_enough_gold: 'error.not_enough_gold',
  not_enough_jokers: 'error.not_enough_jokers',
  level_too_low: 'error.level_too_low',
  upgrade_already_unlocked: 'error.upgrade_already_unlocked',
  pack_not_found: 'error.pack_not_found',
  pack_already_opened: 'error.pack_already_opened',
};

/** Short plain-language text for a failed collection or pack action. */
export function collectionErrorText(code: UiErrorCode): string {
  const key = COLLECTION_ERRORS[code];
  return key === undefined ? errorText(code) : t(key);
}
