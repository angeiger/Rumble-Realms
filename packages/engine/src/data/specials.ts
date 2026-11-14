/**
 * Special cards on offer (SPEC 4.3, 4.5). Chances are per slot, in basis points.
 * Each slot draws one number below SPECIAL_ROLL_RANGE: below DOUBLE_CHANCE_BPS it becomes a
 * double pack, below DOUBLE_CHANCE_BPS + UPGRADE_CHANCE_BPS an upgrade card.
 */
export const DOUBLE_CHANCE_BPS = 1200; // 12 %
export const UPGRADE_CHANCE_BPS = 2000; // 20 %
/** At most this many special cards per offer (SPEC 4.3: start value 1). */
export const MAX_SPECIALS_PER_OFFER = 1;
/** Range of the per-slot special roll (= 100 % in basis points). */
export const SPECIAL_ROLL_RANGE = 10000;
/**
 * Range of the per-slot upgrade roll; the upgrade is roll modulo the number of selectable
 * upgrades. 6 is divisible by 1, 2 and 3, so every selectable upgrade is equally likely.
 */
export const UPGRADE_ROLL_RANGE = 6;
/** A double pack spawns this many times the units of the card. */
export const DOUBLE_FACTOR = 2;
