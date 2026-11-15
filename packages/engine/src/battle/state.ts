/** Battle state basics: the field, occupancy and spawning. No simulation logic in here. */
import * as balance from '../data/balance.ts';
import { CARDS } from '../data/cards.ts';
import { applyBps } from '../math.ts';
import { summonInterval, unitStats } from '../upgrades.ts';
import type { BattleState, CardId, Layer, PlayerIndex, RngState, UnitState } from '../types.ts';
import { ENGINE_VERSION } from '../version.ts';

// Local copies of the field size: isFree and occIndex run in the inner loops of the
// simulation (see the note in sim.ts).
const { GRID_CELLS, GRID_COLS, GRID_ROWS } = balance;

/** An empty field without upgrades. `rng` is the battle stream of the match (unused so far). */
export function createBattle(rng: RngState): BattleState {
  const occ: number[] = [];
  for (let i = 0; i < 2 * GRID_CELLS; i++) occ.push(0);
  return {
    engineVersion: ENGINE_VERSION,
    tick: 0,
    started: false,
    nextUnitId: 1,
    nextProjectileId: 1,
    nextZoneId: 1,
    units: [],
    projectiles: [],
    zones: [],
    occ,
    rng: [rng[0], rng[1], rng[2], rng[3]],
    upgrades: [{}, {}],
    result: null,
  };
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < GRID_COLS && y >= 0 && y < GRID_ROWS;
}

export function cellIndex(x: number, y: number): number {
  return y * GRID_COLS + x;
}

export function occIndex(layer: Layer, x: number, y: number): number {
  return layer * GRID_CELLS + y * GRID_COLS + x;
}

/** True if the cell is on the field and no unit stands on or has reserved it on this layer. */
export function isFree(b: BattleState, layer: Layer, x: number, y: number): boolean {
  return inBounds(x, y) && b.occ[occIndex(layer, x, y)] === 0;
}

/** Finds a living unit by id (units are sorted by id); undefined if it is gone. */
export function unitById(b: BattleState, id: number): UnitState | undefined {
  const units = b.units;
  let lo = 0;
  let hi = units.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const u = units[mid] as UnitState;
    if (u.id === id) return u;
    if (u.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/**
 * Puts one unit of `card` on a free cell and returns it.
 * Without `id` the unit gets the next free id of the field. With `id` (the army set-up,
 * D-053) it keeps that id, which must be higher than every id on the field, so `units`
 * stays sorted; `nextUnitId` then moves past it.
 * Stats (HP, speed, range, armour) come from the level and the owner's active upgrades of
 * `card` in `b.upgrades`. Throws if the cell is outside the field or already taken.
 */
export function spawnUnit(
  b: BattleState,
  owner: PlayerIndex,
  card: CardId,
  level: number,
  x: number,
  y: number,
  id?: number,
  layer: Layer = CARDS[card].layer,
): UnitState {
  const def = CARDS[card];
  if (!isFree(b, layer, x, y)) {
    throw new Error(`spawnUnit: cell ${x},${y} is not free for ${card}`);
  }
  let unitId: number;
  if (id === undefined) {
    unitId = b.nextUnitId++;
  } else {
    const last = b.units.length === 0 ? 0 : (b.units[b.units.length - 1] as UnitState).id;
    if (!Number.isSafeInteger(id) || id <= last) {
      throw new Error(`spawnUnit: id ${id} must be an integer above ${last}`);
    }
    unitId = id;
    if (b.nextUnitId <= id) b.nextUnitId = id + 1;
  }
  const up = b.upgrades[owner][card] ?? 0;
  const stats = unitStats(card, level, up);
  const maxHp = stats.maxHp;
  const unit: UnitState = {
    id: unitId,
    owner,
    card,
    level,
    layer,
    x,
    y,
    tx: x,
    ty: y,
    moveCost: 0,
    moveProgress: 0,
    moveCarry: 0,
    hp: maxHp,
    maxHp,
    mode: 'attack',
    targetId: 0,
    retargetTick: 0,
    nextAttackTick: 0,
    stuckTicks: 0,
    path: [],
    jumpTick: -1,
    jumpX: -1,
    jumpY: -1,
    fuseTick: -1,
    up,
    speed: stats.speed,
    range: stats.range,
    armorBps: stats.armorBps,
    summonerId: 0,
    summonTick: def.summon === undefined ? -1 : b.tick + summonInterval(card, up),
    slowBps: 0,
    slowUntil: 0,
    atkSlowBps: 0,
    atkSlowUntil: 0,
    stunUntil: 0,
    burnDps: 0,
    burnStart: 0,
    burnUntil: 0,
    poisonDps: 0,
    poisonStart: 0,
    poisonUntil: 0,
    shield: stats.shield,
    invulnUntil: 0,
    untargetableUntil: 0,
    dmgBonusBps: 0,
    dmgBonusUntil: 0,
    attacks: 0,
    hits: 0,
    ignoreHits: stats.ignoreHits,
    unstoppableLeft: stats.unstoppableLeft,
    moved: false,
    powerBps: balance.BPS,
    reviveLeft: stats.reviveLeft,
    abilityTick: stats.abilityDelay < 0 ? -1 : b.tick + stats.abilityDelay,
    stacks: 0,
    jumpReadyTick: 0,
    giant: false,
    ghost: false,
    sporedUntil: 0,
    sporedDps: 0,
  };
  b.units.push(unit);
  b.occ[occIndex(layer, x, y)] = unit.id;
  return unit;
}

/**
 * Riesenpilz: makes a freshly spawned unit a giant (hit points and damage times `hpBps` /
 * `damageBps`). Its death cloud stays normal (cloud damage ignores powerBps).
 */
export function makeGiant(u: UnitState, hpBps: number, damageBps: number): void {
  u.maxHp = applyBps(u.maxHp, hpBps);
  u.hp = u.maxHp;
  u.powerBps = applyBps(u.powerBps, damageBps);
  u.giant = true;
}

/** Deep copy of any engine state (plain JSON data). */
export function cloneState<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T;
}
