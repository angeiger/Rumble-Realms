/** Card values for display (SPEC 5.2, 6.3): conversion from engine units, German number format. */
import {
  CARDS,
  scaleByLevel,
  TICKS_PER_SECOND,
  type CardDef,
  type CardId,
  type Role,
} from '@rumble-realms/engine';
import { getLocale } from '../i18n/index.ts';

/** A level 1 value scaled to `level`, exactly as the engine does it (SPEC 6.3). */
export const scaleStat = scaleByLevel;

/** Number with at most `digits` decimals and a decimal comma (de) or point (en). */
export function formatNumber(value: number, digits = 1): string {
  const locale = getLocale() === 'de' ? 'de-DE' : 'en-US';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

export function intervalSeconds(intervalTicks: number): number {
  return intervalTicks / TICKS_PER_SECOND;
}

/** Fields per second from milli-fields per tick (1,0 field/s = 50). */
export function speedFieldsPerSecond(moveSpeed: number): number {
  return moveSpeed / 50;
}

export type EffectKind = 'damage' | 'heal';
export type RangeKind = 'melee' | 'contact' | 'ranged';
export type TargetKind = 'ground' | 'groundAir' | 'allies';

export interface CardStats {
  count: number;
  role: Role;
  hp: number;
  effectKind: EffectKind;
  effect: number;
  /** Seconds between attacks; null for one-time attacks. */
  interval: number | null;
  rangeKind: RangeKind;
  /** Fields; only meaningful for `ranged`. */
  range: number;
  /** Fields per second. */
  speed: number;
  target: TargetKind;
}

export function getCardStats(card: CardId, level: number): CardStats {
  const def: CardDef = CARDS[card];
  const a = def.attack;
  const base = {
    count: def.count,
    role: def.role,
    hp: scaleStat(def.hp, level),
    speed: speedFieldsPerSecond(def.moveSpeed),
  };
  switch (a.kind) {
    case 'melee':
      return {
        ...base,
        effectKind: 'damage',
        effect: scaleStat(a.damage, level),
        interval: intervalSeconds(a.intervalTicks),
        rangeKind: 'melee',
        range: 1,
        target: def.targets.air ? 'groundAir' : 'ground',
      };
    case 'ranged':
      return {
        ...base,
        effectKind: 'damage',
        effect: scaleStat(a.damage, level),
        interval: intervalSeconds(a.intervalTicks),
        rangeKind: 'ranged',
        range: a.range,
        target: def.targets.air ? 'groundAir' : 'ground',
      };
    case 'heal':
      return {
        ...base,
        effectKind: 'heal',
        effect: scaleStat(a.amount, level),
        interval: intervalSeconds(a.intervalTicks),
        rangeKind: 'ranged',
        range: a.range,
        target: 'allies',
      };
    case 'explode':
      return {
        ...base,
        effectKind: 'damage',
        effect: scaleStat(a.damage, level),
        interval: null,
        rangeKind: 'contact',
        range: 1,
        target: 'ground',
      };
  }
}
