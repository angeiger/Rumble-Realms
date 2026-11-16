/**
 * Progress of the collection (SPEC 7). M3b only needs the card levels that unlock the three
 * upgrades; level-up costs, packs and Elo follow with M4.
 */
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
