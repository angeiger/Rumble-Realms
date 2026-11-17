/**
 * Integer helpers. JavaScript numbers are doubles, but +, -, * and the truncated division
 * below are exact and identical on every device as long as all values stay below 2^53.
 */
import { BPS, LEVEL_BONUS_BPS } from './data/balance.ts';

/** Integer division, rounded towards zero. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** floor(value * bps / 10000) for non-negative values. */
export function applyBps(value: number, bps: number): number {
  return idiv(value * bps, BPS);
}

/** A level 1 stat (HP, damage, healing) scaled to `level` (SPEC 6.3). */
export function scaleByLevel(base: number, level: number): number {
  return applyBps(base, BPS + LEVEL_BONUS_BPS * (level - 1));
}

/** Squared distance between two cells or points. */
export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** floor(sqrt(n)) for 0 <= n < 2^31, computed with integers only. */
export function isqrt(n: number): number {
  let rest = n;
  let root = 0;
  let bit = 1 << 30;
  while (bit > rest) bit >>= 2;
  while (bit !== 0) {
    if (rest >= root + bit) {
      rest -= root + bit;
      root = (root >> 1) + bit;
    } else {
      root >>= 1;
    }
    bit >>= 2;
  }
  return root;
}

/** Squared reach in cells: range 1 covers all 8 neighbours, larger ranges are Euclidean. */
export function rangeSq(range: number): number {
  return range <= 1 ? 2 : range * range;
}
