/**
 * Helpers for the battle tests: build fields, run ticks, collect events, check invariants.
 * Not part of the engine API (not exported from index.ts); only imported by *.test.ts files.
 */
import { DIAGONAL_STEP, FIELD, GRID_CELLS, GRID_COLS, HALF_ROWS } from '../data/balance.ts';
import { CARD_IDS, CARDS } from '../data/cards.ts';
import type { BattleEvent, BattleState, CardId, PlayerIndex, UnitState } from '../types.ts';
import { stepTick } from './sim.ts';
import { createBattle, isFree, occIndex, spawnUnit } from './state.ts';

/** An empty field with a fixed battle seed. */
export function field(): BattleState {
  return createBattle([1, 2, 3, 4]);
}

export interface PutOptions {
  level?: number;
  /** Overrides the current hit points (after level scaling). */
  hp?: number;
  /** Overrides the maximum hit points; current hit points follow unless `hp` is given. */
  maxHp?: number;
}

/** Spawns one unit; optionally overrides its hit points. */
export function put(
  b: BattleState,
  owner: PlayerIndex,
  card: CardId,
  x: number,
  y: number,
  options: PutOptions = {},
): UnitState {
  const u = spawnUnit(b, owner, card, options.level ?? 1, x, y);
  if (options.maxHp !== undefined) {
    u.maxHp = options.maxHp;
    u.hp = options.maxHp;
  }
  if (options.hp !== undefined) u.hp = options.hp;
  return u;
}

/** A unit with (practically) endless hit points: a punching bag that never dies. */
export function dummy(
  b: BattleState,
  owner: PlayerIndex,
  card: CardId,
  x: number,
  y: number,
): UnitState {
  return put(b, owner, card, x, y, { maxHp: 1_000_000 });
}

export interface TickLog {
  /** Index of the simulated tick. */
  tick: number;
  events: BattleEvent[];
}

/** Simulates `n` ticks and returns the events of each tick. */
export function run(b: BattleState, n: number): TickLog[] {
  const log: TickLog[] = [];
  for (let i = 0; i < n; i++) {
    const tick = b.tick;
    const events: BattleEvent[] = [];
    stepTick(b, events);
    log.push({ tick, events });
  }
  return log;
}

export type EventOf<T extends BattleEvent['type']> = Extract<BattleEvent, { type: T }> & {
  tick: number;
};

/** All events of one type from a log, each tagged with its tick. */
export function eventsOf<T extends BattleEvent['type']>(log: TickLog[], type: T): EventOf<T>[] {
  const out: EventOf<T>[] = [];
  for (const entry of log) {
    for (const e of entry.events) {
      if (e.type === type)
        out.push({ ...(e as Extract<BattleEvent, { type: T }>), tick: entry.tick });
    }
  }
  return out;
}

/** Ticks in which `unit` attacked in melee or fired a shot. */
export function attackTicks(log: TickLog[], unit: number): number[] {
  const ticks: number[] = [];
  for (const entry of log) {
    for (const e of entry.events) {
      if ((e.type === 'attack' || e.type === 'shot' || e.type === 'lob') && e.unit === unit) {
        ticks.push(entry.tick);
        break;
      }
    }
  }
  return ticks;
}

/** A player 1 knight walled into the top-left corner by three healers that never move. */
export function cornerPocket(b: BattleState): { knight: UnitState; healers: UnitState[] } {
  const knight = put(b, 1, 'knight', 0, 23);
  const healers = [
    put(b, 1, 'healer', 1, 23),
    put(b, 1, 'healer', 0, 22),
    put(b, 1, 'healer', 1, 22),
  ];
  return { knight, healers };
}

/**
 * Keeps player 0 in the game without touching the rest of the field: a bat in the corner
 * that is busy with a player 1 bait knight (knights cannot hit bats, so nothing moves there).
 */
export function busyCorner(b: BattleState): void {
  put(b, 1, 'knight', 0, 0);
  put(b, 0, 'bat', 0, 1);
}

/** Small integer LCG for test data (deterministic, independent of the engine RNG). */
export function lcg(seed: number): (n: number) => number {
  let state = seed >>> 0;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 8) % n;
  };
}

/** A field with 1-4 random cards per side, random levels and random cells in each half. */
export function randomBattle(seed: number): BattleState {
  const rnd = lcg(seed * 7919 + 17);
  const b = createBattle([seed + 1, 2, 3, 4]);
  for (const owner of [0, 1] as const) {
    const cards = 1 + rnd(4);
    for (let c = 0; c < cards; c++) {
      const card = CARD_IDS[rnd(CARD_IDS.length)] as CardId;
      const def = CARDS[card];
      const level = 1 + rnd(5);
      for (let k = 0; k < def.count; k++) {
        for (let attempt = 0; attempt < 30; attempt++) {
          const x = rnd(GRID_COLS);
          const y = owner * HALF_ROWS + rnd(HALF_ROWS);
          if (isFree(b, def.layer, x, y)) {
            spawnUnit(b, owner, card, level, x, y);
            break;
          }
        }
      }
    }
  }
  return b;
}

/**
 * Consistency of units and occupancy (D-021): every living unit occupies exactly its
 * (tx, ty) on its layer, nothing else is occupied, and a step only goes to a neighbour.
 * Returns a list of problems (empty if all is well).
 */
export function invariantProblems(b: BattleState): string[] {
  const problems: string[] = [];
  let lastId = 0;
  for (const u of b.units) {
    if (u.id <= lastId) problems.push(`units not ascending at ${u.id}`);
    lastId = u.id;
    if (u.hp <= 0) problems.push(`dead unit ${u.id} still on the field`);
    if (u.hp > u.maxHp) problems.push(`unit ${u.id} above max HP`);
    if (b.occ[occIndex(u.layer, u.tx, u.ty)] !== u.id) {
      problems.push(`unit ${u.id} does not occupy ${u.tx},${u.ty}`);
    }
    const dx = Math.abs(u.tx - u.x);
    const dy = Math.abs(u.ty - u.y);
    if (u.moveCost === 0) {
      if (dx !== 0 || dy !== 0) problems.push(`standing unit ${u.id} reserved another cell`);
    } else {
      const expected = dx === 1 && dy === 1 ? DIAGONAL_STEP : FIELD;
      if (dx > 1 || dy > 1 || dx + dy === 0 || u.moveCost !== expected) {
        problems.push(`unit ${u.id} has an invalid step`);
      }
    }
  }
  let taken = 0;
  for (let i = 0; i < 2 * GRID_CELLS; i++) if (b.occ[i] !== 0) taken++;
  if (taken !== b.units.length) {
    problems.push(`${taken} occupied cells for ${b.units.length} units`);
  }
  return problems;
}
