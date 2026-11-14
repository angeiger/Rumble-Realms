/**
 * Movement and reservation (SPEC 6.2 step 4, D-021): step timing, occupancy invariants,
 * shared ground/air cells, standing in reach, A* detours around blocked cells.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent, BattleState, UnitState } from '../types.ts';
import { stepTick } from './sim.ts';
import { occIndex } from './state.ts';
import {
  attackTicks,
  cornerPocket,
  dummy,
  eventsOf,
  field,
  invariantProblems,
  put,
  randomBattle,
  run,
  type TickLog,
} from './testing.ts';

const STRAIGHT = 1000;
const DIAGONAL = 1414;

/** Puts a unit into the middle of a step towards (nx, ny), as if it had begun one tick ago. */
function beginStep(b: BattleState, u: UnitState, nx: number, ny: number, speed: number): void {
  b.occ[occIndex(u.layer, u.x, u.y)] = 0;
  b.occ[occIndex(u.layer, nx, ny)] = u.id;
  u.tx = nx;
  u.ty = ny;
  u.moveCost = nx !== u.x && ny !== u.y ? DIAGONAL : STRAIGHT;
  u.moveProgress = speed;
}

describe('occupancy invariants (D-021)', () => {
  it('keeps units and occupancy consistent in 60 random battles', () => {
    for (let seed = 100; seed < 160; seed++) {
      const b = randomBattle(seed);
      expect(invariantProblems(b)).toEqual([]);
      while (b.result === null) {
        const before = new Map(b.units.map((u) => [u.id, { ...u }]));
        const events: BattleEvent[] = [];
        stepTick(b, events);
        expect(invariantProblems(b)).toEqual([]);

        const jumped = new Set(events.flatMap((e) => (e.type === 'jump' ? [e.unit] : [])));
        for (const e of events) {
          // No attack, shot or heal from a unit that was in the middle of a step.
          if (e.type === 'attack' || e.type === 'shot' || e.type === 'heal') {
            expect(before.get(e.unit)!.moveCost).toBe(0);
          }
        }
        for (const u of b.units) {
          const prev = before.get(u.id);
          if (prev === undefined || (prev.x === u.x && prev.y === u.y)) continue;
          // The logical cell only changes on arrival, and only to the reserved cell.
          if (jumped.has(u.id)) continue;
          expect(prev.moveCost).toBeGreaterThan(0);
          expect([u.x, u.y]).toEqual([prev.tx, prev.ty]);
          expect(u.moveCost).toBe(0);
        }
      }
    }
  });
});

describe('step timing', () => {
  it('takes 20 ticks per straight step at speed 1.0', () => {
    const b = field();
    const a = put(b, 0, 'archer', 5, 0);
    put(b, 1, 'knight', 5, 23);
    for (let t = 1; t <= 80; t++) {
      run(b, 1);
      expect([a.x, a.y]).toEqual([5, Math.floor(t / 20)]);
      if (a.moveCost > 0) {
        // Reserved the next cell and released the old one at once.
        expect([a.tx, a.ty]).toEqual([5, a.y + 1]);
        expect(b.occ[occIndex(0, 5, a.y + 1)]).toBe(a.id);
        expect(b.occ[occIndex(0, 5, a.y)]).toBe(0);
      }
    }
  });

  it('takes longer for diagonal steps and carries the overshoot over', () => {
    const b = field();
    const a = put(b, 0, 'archer', 0, 0);
    put(b, 1, 'knight', 11, 11);
    // Speed 1.0 = 50 milli-fields per tick, a diagonal step is 1414 long.
    for (let t = 1; t <= 85; t++) {
      run(b, 1);
      const steps = Math.floor((50 * t) / DIAGONAL);
      expect([a.x, a.y]).toEqual([steps, steps]);
    }
  });

  it('keeps the exact average speed over many steps (bat, speed 1.6)', () => {
    const b = field();
    const bat = put(b, 0, 'bat', 5, 0);
    const k = put(b, 1, 'knight', 5, 20); // cannot attack the bat, so it stands still
    for (let t = 1; t <= 200; t++) {
      run(b, 1);
      // 80 milli-fields per tick; steps take 13 and 12 ticks in turn.
      expect(bat.y).toBe(Math.floor((80 * t) / STRAIGHT));
    }
    expect([k.x, k.y]).toEqual([5, 20]);
  });
});

describe('movement rules (SPEC 6.2, D-021)', () => {
  it('does not attack in the middle of a step, but right after arriving', () => {
    const b = field();
    const k = dummy(b, 0, 'knight', 5, 5);
    const e = dummy(b, 1, 'knight', 4, 5);
    beginStep(b, k, 5, 6, 40); // knight speed 0.8 = 40 per tick
    let arrival = -1;
    const log: TickLog[] = [];
    while (arrival < 0) {
      const tick = b.tick;
      log.push(...run(b, 1));
      if (k.moveCost === 0) arrival = tick;
    }
    // 1000 milli-fields minus 40 already covered, 40 per tick: 24 more ticks.
    expect(arrival).toBe(23);
    expect([k.x, k.y]).toEqual([5, 6]);
    expect(attackTicks(log, k.id)).toEqual([]);
    // The enemy hit the knight all the time: logically it still stood next to it.
    expect(attackTicks(log, e.id)[0]).toBe(0);
    expect(attackTicks(run(b, 1), k.id)).toEqual([arrival + 1]);
  });

  it('gives no free hits on a unit that is still on its way', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 5);
    const s = put(b, 1, 'skeleton', 5, 8);
    const log = run(b, 26);
    // The fast skeleton waits on (5,7) for the knight, which arrives on (5,6) in tick 24.
    expect([s.x, s.y]).toEqual([5, 7]);
    expect([k.x, k.y]).toEqual([5, 6]);
    expect(attackTicks(log, s.id)).toEqual([25]);
    expect(attackTicks(log, k.id)).toEqual([25]);
  });

  it('lets a ground and an air unit share a cell', () => {
    const b = field();
    const bat = put(b, 0, 'bat', 5, 6);
    const knight = put(b, 0, 'knight', 5, 6);
    expect(b.occ[occIndex(0, 5, 6)]).toBe(knight.id);
    expect(b.occ[occIndex(1, 5, 6)]).toBe(bat.id);

    const c = field();
    const flyer = put(c, 0, 'bat', 5, 5);
    const below = put(c, 0, 'knight', 5, 6);
    put(c, 1, 'knight', 5, 7);
    run(c, 1);
    // The bat steps onto (5,6) above the knight.
    expect([flyer.tx, flyer.ty]).toEqual([5, 6]);
    expect([below.tx, below.ty]).toEqual([5, 6]);
  });

  it('stays in place while the target is in reach', () => {
    const b = field();
    const a = put(b, 0, 'archer', 5, 2);
    put(b, 1, 'knight', 5, 7); // exactly range 5
    for (let t = 0; t < 30; t++) {
      run(b, 1);
      expect([a.x, a.y, a.tx, a.ty]).toEqual([5, 2, 5, 2]);
    }

    const c = field();
    const k1 = put(c, 0, 'knight', 5, 10);
    const k2 = put(c, 1, 'knight', 6, 11);
    run(c, 50);
    expect([k1.tx, k1.ty, k2.tx, k2.ty]).toEqual([5, 10, 6, 11]);
  });

  it('uses A* after being blocked for more than 20 ticks and walks around a wall', () => {
    const b = field();
    // Healer wall on row 4 with a single gap at x = 11. The healers follow each other
    // (nobody is hurt), so they never move.
    const wall: UnitState[] = [];
    for (let x = 0; x <= 10; x++) wall.push(put(b, 0, 'healer', x, 4));
    const k = put(b, 0, 'knight', 5, 1);
    cornerPocket(b);

    let standing = 0;
    let longestStand = 0;
    let passed = -1;
    for (let t = 0; t < 800 && passed < 0; t++) {
      const was = [k.x, k.y, k.tx, k.ty].join();
      run(b, 1);
      standing = [k.x, k.y, k.tx, k.ty].join() === was && k.moveCost === 0 ? standing + 1 : 0;
      longestStand = Math.max(longestStand, standing);
      if (k.y > 4) passed = t;
    }
    expect(passed).toBeGreaterThan(0);
    // Greedy steps got it stuck under the wall. It stood for the full 20 ticks (1 s) and only
    // in the next blocked tick (> 1 s) used A* for the detour.
    expect(longestStand).toBeGreaterThanOrEqual(20);
    expect(wall.map((h) => [h.x, h.y])).toEqual(wall.map((_, x) => [x, 4]));
  });

  it('lets air units fly over a closed ground wall as if it were not there', () => {
    const flight = (withWall: boolean): number[][] => {
      const b = field();
      if (withWall) for (let x = 0; x <= 11; x++) put(b, 0, 'healer', x, 4);
      else put(b, 0, 'healer', 0, 0); // same number of sides, nothing in the way
      const bat = put(b, 0, 'bat', 5, 1);
      cornerPocket(b);
      const track: number[][] = [];
      for (let t = 0; t < 100; t++) {
        run(b, 1);
        track.push([bat.x, bat.y]);
      }
      return track;
    };
    const over = flight(true);
    expect(over).toEqual(flight(false));
    expect(over.at(-1)![1]).toBeGreaterThan(4);
  });

  it('keeps the occupancy consistent in a crowded lane', () => {
    // Crowd: many fast units rushing into a narrow lane.
    const b = field();
    for (let x = 0; x < 12; x++) if (x !== 5 && x !== 6) put(b, 0, 'healer', x, 11);
    for (let i = 0; i < 6; i++) put(b, 0, 'skeleton', i * 2, 6);
    for (let i = 0; i < 6; i++) put(b, 1, 'skeleton', i * 2 + 1, 16);
    let deaths = 0;
    for (let t = 0; t < 400 && b.result === null; t++) {
      deaths += eventsOf(run(b, 1), 'death').length;
      expect(invariantProblems(b)).toEqual([]);
    }
    expect(deaths).toBeGreaterThan(0); // there was a real fight in the lane
  });
});
