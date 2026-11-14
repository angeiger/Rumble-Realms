/**
 * Upgrade helpers (SPEC 4.3, 4.5, 5.4): bit masks, unit stats with upgrades, unit counts.
 *
 * Stat upgrades work through parameter names in data/upgrades.ts: every *implemented* and
 * active upgrade of a card adds its `extraUnits`, `hpBonusBps`, `speedBonusBps`, `bonusRange`
 * and `armorBps`. Several upgrades of the same card add up.
 */
import { BPS, MELEE_RANGE } from './data/balance.ts';
import { CARDS } from './data/cards.ts';
import { DOUBLE_FACTOR } from './data/specials.ts';
import { UPGRADES, UPGRADES_PER_CARD } from './data/upgrades.ts';
import { applyBps, scaleByLevel } from './math.ts';
import type { CardId, UpgradeIndex } from './types.ts';

export function hasUpgrade(mask: number, index: number): boolean {
  return (mask & (1 << index)) !== 0;
}

/** Parameter `name` of upgrade `index` of `card`. Throws if the data has no such parameter. */
export function upgradeParam(card: CardId, index: UpgradeIndex, name: string): number {
  const value = UPGRADES[card][index].params[name];
  if (value === undefined) {
    throw new Error(`upgradeParam: ${UPGRADES[card][index].id} has no parameter ${name}`);
  }
  return value;
}

/** Sum of parameter `name` over the implemented upgrades of `card` that are set in `mask`. */
export function upgradeBonus(card: CardId, mask: number, name: string): number {
  if (mask === 0) return 0;
  const list = UPGRADES[card];
  let sum = 0;
  for (let i = 0; i < UPGRADES_PER_CARD; i++) {
    const def = list[i as UpgradeIndex];
    if (!def.implemented || !hasUpgrade(mask, i)) continue;
    sum += def.params[name] ?? 0;
  }
  return sum;
}

/**
 * Upgrades of `card` that may appear on offer: unlocked, not yet active and implemented,
 * ascending by index.
 */
export function selectableUpgrades(card: CardId, unlocked: number, active: number): UpgradeIndex[] {
  const out: UpgradeIndex[] = [];
  for (let i = 0; i < UPGRADES_PER_CARD; i++) {
    const index = i as UpgradeIndex;
    if (!UPGRADES[card][index].implemented) continue;
    if (hasUpgrade(unlocked, i) && !hasUpgrade(active, i)) out.push(index);
  }
  return out;
}

/**
 * Units one played card puts on the field: the card's count plus `extraUnits` of the active
 * upgrades, doubled for a double pack (assumption: the double pack doubles the upgraded count).
 */
export function unitCount(card: CardId, mask: number, double: boolean): number {
  const n = CARDS[card].count + upgradeBonus(card, mask, 'extraUnits');
  return double ? n * DOUBLE_FACTOR : n;
}

/** Stats of a unit resolved once at spawn. */
export interface UnitStats {
  maxHp: number;
  /** Milli-fields per tick. */
  speed: number;
  /** Fields. */
  range: number;
  /** Share of damage taken that is ignored, basis points. */
  armorBps: number;
}

/**
 * Level scaling first (SPEC 6.3), then the upgrade bonuses on top: HP and speed bonuses are
 * percentages of the levelled value, ranges add fields.
 */
export function unitStats(card: CardId, level: number, mask: number): UnitStats {
  const def = CARDS[card];
  const atk = def.attack;
  const levelled = scaleByLevel(def.hp, level);
  const hpBonus = upgradeBonus(card, mask, 'hpBonusBps');
  const speedBonus = upgradeBonus(card, mask, 'speedBonusBps');
  let range = MELEE_RANGE;
  if (atk.kind === 'ranged') range = atk.range + upgradeBonus(card, mask, 'bonusRange');
  else if (atk.kind === 'heal') range = atk.range;
  return {
    maxHp: hpBonus === 0 ? levelled : applyBps(levelled, BPS + hpBonus),
    speed: speedBonus === 0 ? def.moveSpeed : applyBps(def.moveSpeed, BPS + speedBonus),
    range,
    armorBps: upgradeBonus(card, mask, 'armorBps'),
  };
}
