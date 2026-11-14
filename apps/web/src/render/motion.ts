/** Pure helpers for unit movement and easing. No Pixi, no DOM. */
import type { Point } from './layout.ts';

/** The fields of `UnitState` that describe the position. */
export interface UnitPlace {
  x: number;
  y: number;
  tx: number;
  ty: number;
  moveCost: number;
  moveProgress: number;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Fraction (0..1) of the current step that is done, `alpha` of a tick after the last
 * simulated tick (D-021). `moveSpeed` is in milli-fields per tick. 0 for a standing unit.
 */
export function stepFraction(place: UnitPlace, moveSpeed: number, alpha: number): number {
  if (place.moveCost <= 0) return 0;
  return clamp((place.moveProgress + alpha * moveSpeed) / place.moveCost, 0, 1);
}

/**
 * Field position (in cells, fractional) of a unit between two ticks: linear from the
 * logical cell to the reserved cell. Writes into `out` and returns it.
 */
export function unitFieldPosition(
  place: UnitPlace,
  moveSpeed: number,
  alpha: number,
  out: Point,
): Point {
  const f = stepFraction(place, moveSpeed, alpha);
  out.x = place.x + (place.tx - place.x) * f;
  out.y = place.y + (place.ty - place.y) * f;
  return out;
}

/** Ease-out with overshoot, 0 -> 1 (for the "plop" on appearing). */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = clamp(t, 0, 1) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/** 0 -> 1 -> 0 over t in 0..1. */
export function pulse01(t: number): number {
  return Math.sin(Math.PI * clamp(t, 0, 1));
}
