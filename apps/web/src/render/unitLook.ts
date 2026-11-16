/**
 * Pure rules of how a unit looks: which status overlays are active, which figure, how big,
 * how tinted. Also the geometry of the new effects (lobbed shell, flame cone, meteor).
 * No Pixi, no DOM: everything here is testable and allocation-free where it runs per frame.
 */
import type { CardId, UnitState, UnitVariant, ZoneKind, ImpactKind } from '@rumble-realms/engine';
import type { FigureId } from './figures.ts';
import type { Point } from './layout.ts';
import { clamp } from './motion.ts';

// ---- status overlays ------------------------------------------------------------------

/** Bit flags of the visible status overlays of one unit. */
export const FX_BURN = 1 << 0;
export const FX_POISON = 1 << 1;
export const FX_SLOW = 1 << 2;
export const FX_FROZEN = 1 << 3;
export const FX_STUN = 1 << 4;
export const FX_SHIELD = 1 << 5;
export const FX_HEAT = 1 << 6;
export const FX_INVULN = 1 << 7;
export const FX_UNTARGET = 1 << 8;
export const FX_BONUS = 1 << 9;

/** The fields of `UnitState` that decide the look. */
export type LookUnit = Pick<
  UnitState,
  | 'card'
  | 'variant'
  | 'giant'
  | 'ghost'
  | 'summonerId'
  | 'stacks'
  | 'shield'
  | 'ignoreHits'
  | 'burnUntil'
  | 'poisonUntil'
  | 'slowUntil'
  | 'atkSlowUntil'
  | 'frozenUntil'
  | 'stunUntil'
  | 'invulnUntil'
  | 'untargetableUntil'
  | 'dmgBonusUntil'
>;

/**
 * A risen zombie lies flat while it is stunned, invulnerable and (here) still a zombie;
 * it then gets up (Untot, D-064).
 */
export function zombieLying(u: LookUnit, tick: number): boolean {
  return u.variant === 'zombie' && tick < u.stunUntil && tick < u.invulnUntil;
}

/** Bit mask of the overlays to show for `u` at battle tick `tick`. */
export function overlayFlags(u: LookUnit, tick: number): number {
  let f = 0;
  if (tick < u.burnUntil) f |= FX_BURN;
  if (tick < u.poisonUntil) f |= FX_POISON;
  if (tick < u.slowUntil || tick < u.atkSlowUntil) f |= FX_SLOW;
  const frozen = tick < u.frozenUntil;
  if (frozen) f |= FX_FROZEN;
  else if (tick < u.stunUntil) f |= FX_STUN;
  if (u.shield > 0) f |= FX_SHIELD;
  if (u.ignoreHits > 0) f |= FX_HEAT;
  if (tick < u.invulnUntil) f |= FX_INVULN;
  if (tick < u.untargetableUntil) f |= FX_UNTARGET;
  if (tick < u.dmgBonusUntil) f |= FX_BONUS;
  if (zombieLying(u, tick)) f &= ~(FX_STUN | FX_INVULN | FX_UNTARGET);
  return f;
}

/** Whether the figure stands still (frozen or stunned, but not the lying zombie). */
export function isHeld(flags: number): boolean {
  return (flags & (FX_FROZEN | FX_STUN)) !== 0;
}

// ---- figure, size, tint ---------------------------------------------------------------

/**
 * A skeleton summoned by a necromancer (also Knochenarmee and Seelenernte): a normal skeleton
 * that has a summoner. Army skeletons have `summonerId === 0`. The zombie of a skeleton gets
 * the dead skeleton as `summonerId` in both cases, so it cannot be told apart and is not
 * covered here.
 */
export function isSummonedSkeleton(u: LookUnit): boolean {
  return u.card === 'skeleton' && u.variant === 'normal' && u.summonerId !== 0;
}

/** The figure to draw for `u`. */
export function figureFor(u: LookUnit): FigureId {
  if (u.ghost) return 'ghost';
  if (u.variant === 'zombie') return 'zombie';
  if (u.variant === 'mini') return 'mini_golem';
  if (isSummonedSkeleton(u)) return 'summoned_skeleton';
  return u.card;
}

const GIANT_SIZE = 1.6;
const DAUGHTER_SIZE = 0.7;
/** The mini golem figure is already drawn smaller than the golem (about 0.77), so about 0.6 in all. */
const MINI_SIZE = 0.8;
/** Summoned skeletons are drawn clearly smaller than the card skeleton. */
const SUMMONED_SKELETON_SIZE = 0.78;
const GROWTH_PER_STACK = 0.1;

/** Size factor of the figure (1 = normal). */
export function sizeFactor(u: LookUnit): number {
  let s = 1;
  if (u.giant) s *= GIANT_SIZE;
  if (u.variant === 'daughter') s *= DAUGHTER_SIZE;
  else if (u.variant === 'mini') s *= MINI_SIZE;
  else if (isSummonedSkeleton(u)) s *= SUMMONED_SKELETON_SIZE;
  return s * (1 + GROWTH_PER_STACK * u.stacks);
}

function mul(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return ((r & 255) << 16) | ((g & 255) << 8) | (bl & 255);
}

/** Multiplied into the figure's colours; 0xffffff = unchanged. Several states combine. */
export function bodyTint(flags: number, ghost: boolean): number {
  let t = 0xffffff;
  if (ghost) t = mul(t, 0xc4d8ff);
  if (flags & FX_BURN) t = mul(t, 0xffd2bc);
  if (flags & FX_POISON) t = mul(t, 0xb4f5a8);
  if (flags & FX_SLOW) t = mul(t, 0xb4d2ff);
  if (flags & FX_FROZEN) t = mul(t, 0xa8dcff);
  return t;
}

/** Opacity of the figure: ghosts and units that cannot be targeted are see-through. */
export function bodyAlpha(flags: number, ghost: boolean): number {
  let a = 1;
  if (ghost) a *= 0.7;
  if (flags & FX_UNTARGET) a *= 0.5;
  return a;
}

// ---- summon, impact and zone styles ---------------------------------------------------

export type SummonStyle = 'bones' | 'light' | 'ghost' | 'zombie' | 'dust';

/** Which appear effect fits a unit that appeared in mid-battle. */
export function summonStyle(card: CardId, variant: UnitVariant, ghost: boolean): SummonStyle {
  if (ghost) return 'ghost';
  switch (variant) {
    case 'revived':
      return 'light';
    case 'zombie':
      return 'zombie';
    case 'daughter':
    case 'mini':
      return 'dust';
    case 'normal':
      return card === 'skeleton' ? 'bones' : 'dust';
  }
}

export interface ZoneLook {
  /** Fill colour, rim colour and the colour of the rising specks or bubbles. */
  fill: number;
  rim: number;
  speck: number;
  /** Height of the pool relative to its width (a flat puddle is lower than a cloud). */
  squash: number;
  /** Peak opacity of the fill. */
  alpha: number;
  /** Whether bubbles rise (acid) or spores (cloud). */
  bubbles: boolean;
}

const ZONE_LOOKS: Record<ZoneKind, ZoneLook> = {
  spores: {
    fill: 0x8a5fd0,
    rim: 0xa6f04a,
    speck: 0xd2ff6a,
    squash: 1,
    alpha: 0.62,
    bubbles: false,
  },
  acid: {
    fill: 0xc3d62a,
    rim: 0x6f9a1a,
    speck: 0xf2ff9a,
    squash: 0.72,
    alpha: 0.78,
    bubbles: true,
  },
};

export function zoneLook(kind: ZoneKind): ZoneLook {
  return ZONE_LOOKS[kind];
}

/** Whether an impact kind needs the screen to shake, and how hard (share of a cell). */
export function impactShake(kind: ImpactKind): number {
  switch (kind) {
    case 'shell':
      return 0.12;
    case 'splash':
      return 0;
    case 'quake':
      return 0.22;
    case 'nova':
      return 0;
    case 'meteor':
      return 0.5;
  }
}

// ---- geometry -------------------------------------------------------------------------

/** Meteor fall: the whole animation is display only and kept short. */
export const METEOR_FALL_MS = 240;
/** Flame cone: half opening angle of the whelp's breath (SPEC 5.4). */
export const BREATH_HALF_ANGLE = Math.PI / 4;

/** Height of the arc of a lobbed shell over a ground distance of `dist` pixels. */
export function lobArcHeight(dist: number, cell: number): number {
  return clamp(dist * 0.35, cell * 1.5, cell * 6);
}

/** Point of the arc at `t` (0..1): straight line from start to end, lifted by a parabola. */
export function lobPoint(
  t: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  arc: number,
  out: Point,
): Point {
  const u = clamp(t, 0, 1);
  out.x = x0 + (x1 - x0) * u;
  out.y = y0 + (y1 - y0) * u - arc * 4 * u * (1 - u);
  return out;
}

/**
 * The `i`-th of `n` flame particles of a cone: an angle offset from the cone axis (within
 * +-`half`) and a distance (0.2..1 of `range`). A low-discrepancy sequence spreads them
 * evenly without random numbers.
 */
export function coneSample(
  i: number,
  half: number,
  range: number,
  out: { angle: number; dist: number },
): { angle: number; dist: number } {
  const a = (i * 0.6180339887) % 1;
  const d = (i * 0.7548776662 + 0.3) % 1;
  out.angle = (a * 2 - 1) * half;
  out.dist = range * (0.2 + 0.8 * d);
  return out;
}

/** Position of the meteor at `t` (0..1) of its fall onto (`x`, `y`): from above and a bit left. */
export function meteorPoint(t: number, x: number, y: number, fall: number, out: Point): Point {
  const u = clamp(t, 0, 1);
  const e = u * u; // accelerates
  out.x = x - fall * 0.3 * (1 - e);
  out.y = y - fall * (1 - e);
  return out;
}
