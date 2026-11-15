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
import type { CardId, UnitState, UpgradeIndex } from './types.ts';

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

/** One upgrade resolved by id, for the simulation: card, bit and parameters. */
export interface UpgradeRef {
  card: CardId;
  index: UpgradeIndex;
  bit: number;
  params: Readonly<Record<string, number>>;
}

/** Looks up an upgrade by id (e.g. 'archer.fire_arrows'). Throws for unknown ids. */
export function upgradeRef(id: string): UpgradeRef {
  for (const card of Object.keys(UPGRADES) as CardId[]) {
    const list = UPGRADES[card];
    for (let i = 0; i < UPGRADES_PER_CARD; i++) {
      const def = list[i as UpgradeIndex];
      if (def.id === id) return { card, index: i as UpgradeIndex, bit: 1 << i, params: def.params };
    }
  }
  throw new Error(`upgradeRef: unknown upgrade ${id}`);
}

/** Parameter `name` of `ref`; throws if the data has none (caught by the tests at load). */
export function refParam(ref: UpgradeRef, name: string): number {
  const value = ref.params[name];
  if (value === undefined) throw new Error(`refParam: ${ref.card} upgrade has no ${name}`);
  return value;
}

/** True if unit `u` belongs to the card of `ref` and spawned with that upgrade active. */
export function unitHas(u: UnitState, ref: UpgradeRef): boolean {
  return (u.up & ref.bit) !== 0 && u.card === ref.card;
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
  /** Shield points at spawn (knight shield, scaled by level like hit points). */
  shield: number;
  /** Direct hits ignored completely (pyromancer heat shield). */
  ignoreHits: number;
  /** Triggers of the berserker's unstoppable per round. */
  unstoppableLeft: number;
  /** Revives of the healer per round. */
  reviveLeft: number;
  /** Ticks after spawn until the first timed ability; -1 = none. */
  abilityDelay: number;
}

/**
 * Timed abilities: upgrade id and the delay of the first use after spawn. Frost nova fires
 * at battle start (army units spawn at tick 0), the others after one interval.
 */
const ABILITIES: readonly (readonly [UpgradeRef, boolean])[] = [
  [upgradeRef('pyromancer.meteor'), false],
  [upgradeRef('golem.earthquake'), false],
  [upgradeRef('frost_shaman.frost_nova'), true],
  [upgradeRef('whelp.growth'), false],
];

function abilityDelay(card: CardId, mask: number): number {
  for (const [ref, atStart] of ABILITIES) {
    if (ref.card === card && hasUpgrade(mask, ref.index)) {
      return atStart ? 0 : refParam(ref, 'intervalTicks');
    }
  }
  return -1;
}

const UNSTOPPABLE = upgradeRef('berserker.unstoppable');
const REVIVE = upgradeRef('healer.revive');

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
    // Assumption: the shield grows with the level like the hit points (SPEC 6.3).
    shield: shieldBonus(card, mask, level),
    ignoreHits: upgradeBonus(card, mask, 'ignoredHits'),
    unstoppableLeft:
      card === UNSTOPPABLE.card && hasUpgrade(mask, UNSTOPPABLE.index)
        ? refParam(UNSTOPPABLE, 'perRound')
        : 0,
    abilityDelay: abilityDelay(card, mask),
    reviveLeft:
      card === REVIVE.card && hasUpgrade(mask, REVIVE.index) ? refParam(REVIVE, 'perRound') : 0,
  };
}

function shieldBonus(card: CardId, mask: number, level: number): number {
  const points = upgradeBonus(card, mask, 'shieldPoints');
  return points === 0 ? 0 : scaleByLevel(points, level);
}

const BONE_ARMY = upgradeRef('necromancer.bone_army');

/** Ticks between two summons of `card` (Knochenarmee shortens it). 0 for non-summoners. */
export function summonInterval(card: CardId, mask: number): number {
  const s = CARDS[card].summon;
  if (s === undefined) return 0;
  if (card === BONE_ARMY.card && hasUpgrade(mask, BONE_ARMY.index)) {
    return refParam(BONE_ARMY, 'intervalTicks');
  }
  return s.intervalTicks;
}

/** Maximum of living summons of `card` (Knochenarmee raises it). 0 for non-summoners. */
export function summonMax(card: CardId, mask: number): number {
  const s = CARDS[card].summon;
  if (s === undefined) return 0;
  if (card === BONE_ARMY.card && hasUpgrade(mask, BONE_ARMY.index)) {
    return refParam(BONE_ARMY, 'max');
  }
  return s.max;
}
