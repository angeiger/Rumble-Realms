/**
 * Status effects (SPEC 6.2 step 1) and the one place where damage is applied.
 *
 * Every effect lives in flat integer fields of `UnitState`: a strength and an end tick.
 * Timed effects are active while `tick < until`. Damage over time (burn, poison) deals its
 * damage in the ticks `start < tick <= until`, spread without rounding loss (D-025), so an
 * effect of X damage per second for n seconds deals exactly n * X.
 *
 * Renewing an effect resets its duration and keeps the stronger strength (no stacking,
 * SPEC 5.3 frost shaman). Shield points add up.
 */
import { BPS, TICKS_PER_SECOND } from '../data/balance.ts';
import { applyBps, idiv } from '../math.ts';
import type { BattleEvent, UnitState } from '../types.ts';

// --- Applying effects -------------------------------------------------------

/** Slows movement and attack speed by `bps` for `ticks` ticks from `tick` on. */
export function applySlow(u: UnitState, bps: number, ticks: number, tick: number): void {
  u.slowBps = u.slowUntil > tick ? Math.max(u.slowBps, bps) : bps;
  u.slowUntil = Math.max(u.slowUntil, tick + ticks);
}

/** Slows only the attack speed. */
export function applyAttackSlow(u: UnitState, bps: number, ticks: number, tick: number): void {
  u.atkSlowBps = u.atkSlowUntil > tick ? Math.max(u.atkSlowBps, bps) : bps;
  u.atkSlowUntil = Math.max(u.atkSlowUntil, tick + ticks);
}

/** Stun or freeze: no attacks, abilities or movement. */
export function applyStun(u: UnitState, ticks: number, tick: number): void {
  u.stunUntil = Math.max(u.stunUntil, tick + ticks);
}

/** Burn with `dps` damage per second; the first damage falls in the next tick. */
export function applyBurn(u: UnitState, dps: number, ticks: number, tick: number): void {
  u.burnDps = u.burnUntil > tick ? Math.max(u.burnDps, dps) : dps;
  u.burnStart = tick;
  u.burnUntil = tick + ticks;
}

/** Poison, like burn in its own slot (so both can run at the same time). */
export function applyPoison(u: UnitState, dps: number, ticks: number, tick: number): void {
  u.poisonDps = u.poisonUntil > tick ? Math.max(u.poisonDps, dps) : dps;
  u.poisonStart = tick;
  u.poisonUntil = tick + ticks;
}

export function addShield(u: UnitState, points: number): void {
  u.shield += points;
}

export function setInvulnerable(u: UnitState, ticks: number, tick: number): void {
  u.invulnUntil = Math.max(u.invulnUntil, tick + ticks);
}

export function setUntargetable(u: UnitState, ticks: number, tick: number): void {
  u.untargetableUntil = Math.max(u.untargetableUntil, tick + ticks);
}

/** The unit deals `bps` more damage for `ticks` ticks. */
export function applyDamageBonus(u: UnitState, bps: number, ticks: number, tick: number): void {
  u.dmgBonusBps = u.dmgBonusUntil > tick ? Math.max(u.dmgBonusBps, bps) : bps;
  u.dmgBonusUntil = Math.max(u.dmgBonusUntil, tick + ticks);
}

// --- Queries ----------------------------------------------------------------

/** False while stunned or frozen. */
export function canAct(u: UnitState, tick: number): boolean {
  return u.stunUntil <= tick;
}

/** False while the unit may not be picked as a target. */
export function isTargetable(u: UnitState, tick: number): boolean {
  return u.untargetableUntil <= tick;
}

/** Move speed in milli-fields per tick after slows (at least 1). */
export function effectiveMoveSpeed(u: UnitState, tick: number): number {
  if (u.slowUntil <= tick) return u.speed;
  return Math.max(1, applyBps(u.speed, BPS - u.slowBps));
}

/**
 * Attack interval after slows. A slow of p basis points lowers the attack *rate* by p, so
 * the interval grows to interval / (1 - p), rounded up. With both slows active the stronger
 * one counts.
 */
export function effectiveAttackInterval(u: UnitState, interval: number, tick: number): number {
  const slow = u.slowUntil > tick ? u.slowBps : 0;
  const atkSlow = u.atkSlowUntil > tick ? u.atkSlowBps : 0;
  const bps = Math.max(slow, atkSlow);
  if (bps <= 0) return interval;
  const rest = Math.max(1, BPS - bps);
  return idiv(interval * BPS + rest - 1, rest);
}

/** Damage `amount` of `u` after its own damage factor (powerBps) and its damage bonus. */
export function outgoingDamage(u: UnitState, amount: number, tick: number): number {
  const base = u.powerBps === BPS ? amount : applyBps(amount, u.powerBps);
  return u.dmgBonusUntil > tick ? applyBps(base, BPS + u.dmgBonusBps) : base;
}

/** Damage over time in tick `tick` for an effect started at `start` (D-025); 0 outside it. */
export function dotDamage(dps: number, start: number, until: number, tick: number): number {
  if (tick <= start || tick > until || dps <= 0) return 0;
  const k = tick - start;
  return idiv(dps * k, TICKS_PER_SECOND) - idiv(dps * (k - 1), TICKS_PER_SECOND);
}

// --- Damage -----------------------------------------------------------------

/**
 * The only function that removes hit points. Order: invulnerability (nothing happens),
 * armour (floor(amount * (1 - armour))), shield points, hit points. Returns the hit points
 * actually removed (for lifesteal). Units may drop below 0; they die at the end of the tick.
 */
export function applyDamage(
  target: UnitState,
  amount: number,
  tick: number,
  events: BattleEvent[] | undefined,
): number {
  if (target.invulnUntil > tick) return 0;
  let rest = target.armorBps > 0 ? applyBps(amount, BPS - target.armorBps) : amount;
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, rest);
    target.shield -= absorbed;
    rest -= absorbed;
  }
  const removed = target.hp > 0 ? Math.min(rest, target.hp) : 0;
  target.hp -= rest;
  if (events !== undefined) events.push({ type: 'damage', unit: target.id, amount: rest });
  return removed;
}
