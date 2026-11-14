/** Battle state basics: the field, occupancy and spawning. No simulation logic in here. */
import { GRID_CELLS, GRID_COLS, GRID_ROWS } from '../data/balance.ts';
import { CARDS } from '../data/cards.ts';
import { scaleByLevel } from '../math.ts';
import type { BattleState, CardId, Layer, PlayerIndex, RngState, UnitState } from '../types.ts';
import { ENGINE_VERSION } from '../version.ts';

/** An empty field. `rng` is the battle stream of the match (unused by the M1 units). */
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
 * Throws if the cell is outside the field or already taken on the unit's layer.
 */
export function spawnUnit(
  b: BattleState,
  owner: PlayerIndex,
  card: CardId,
  level: number,
  x: number,
  y: number,
): UnitState {
  const def = CARDS[card];
  if (!isFree(b, def.layer, x, y)) {
    throw new Error(`spawnUnit: cell ${x},${y} is not free for ${card}`);
  }
  const maxHp = scaleByLevel(def.hp, level);
  const unit: UnitState = {
    id: b.nextUnitId++,
    owner,
    card,
    level,
    layer: def.layer,
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
  };
  b.units.push(unit);
  b.occ[occIndex(def.layer, x, y)] = unit.id;
  return unit;
}

/** Deep copy of any engine state (plain JSON data). */
export function cloneState<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T;
}
