import { describe, expect, it } from 'vitest';
import { findPath } from './pathfinding.ts';
import { lcg } from './testing.ts';
import type { Layer, PlayerIndex } from '../types.ts';

// Field values from SPEC 4.1 / balance: 12 x 24 cells, straight step 1000, diagonal 1414.
const COLS = 12;
const ROWS = 24;
const CELLS = COLS * ROWS;
const STRAIGHT = 1000;
const DIAGONAL = 1414;
const MELEE_REACH = 2; // range 1 = all 8 neighbours (D-022)

function emptyOcc(): number[] {
  return new Array<number>(2 * CELLS).fill(0);
}

function block(occ: number[], layer: Layer, x: number, y: number, id = 99): void {
  occ[layer * CELLS + y * COLS + x] = id;
}

function xy(cell: number): [number, number] {
  return [cell % COLS, Math.floor(cell / COLS)];
}

function d2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

/** Cost of walking `path` from (sx, sy); -1 if a step is not to a neighbouring cell. */
function pathCost(sx: number, sy: number, path: number[]): number {
  let cost = 0;
  let x = sx;
  let y = sy;
  for (const cell of path) {
    const [nx, ny] = xy(cell);
    const dx = Math.abs(nx - x);
    const dy = Math.abs(ny - y);
    if (dx > 1 || dy > 1 || dx + dy === 0) return -1;
    cost += dx + dy === 2 ? DIAGONAL : STRAIGHT;
    x = nx;
    y = ny;
  }
  return cost;
}

/**
 * Reference: plain Dijkstra with a linear minimum search, written independently of the
 * engine. Returns the optimal cost to any free cell in reach of the goal, 0 if the start
 * is already in reach, -1 if there is no way.
 */
function referenceCost(
  occ: number[],
  layer: Layer,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  reachSq: number,
): number {
  if (d2(sx, sy, gx, gy) <= reachSq) return 0;
  const start = sy * COLS + sx;
  const dist = new Array<number>(CELLS).fill(Infinity);
  const done = new Array<boolean>(CELLS).fill(false);
  dist[start] = 0;
  for (;;) {
    let cur = -1;
    for (let c = 0; c < CELLS; c++) {
      if (!done[c] && dist[c] !== Infinity && (cur < 0 || dist[c]! < dist[cur]!)) cur = c;
    }
    if (cur < 0) return -1;
    done[cur] = true;
    const [x, y] = xy(cur);
    if (cur !== start && d2(x, y, gx, gy) <= reachSq) return dist[cur]!;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        const n = ny * COLS + nx;
        if (occ[layer * CELLS + n] !== 0) continue;
        const nd = dist[cur]! + (dx !== 0 && dy !== 0 ? DIAGONAL : STRAIGHT);
        if (nd < dist[n]!) dist[n] = nd;
      }
    }
  }
}

/** Checks the shape of a path: neighbouring free cells, no repeats, ends in reach. */
function expectValidPath(
  occ: number[],
  layer: Layer,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  reachSq: number,
  path: number[],
): void {
  expect(pathCost(sx, sy, path)).toBeGreaterThan(0);
  const seen = new Set<number>([sy * COLS + sx]);
  for (const cell of path) {
    expect(cell).toBeGreaterThanOrEqual(0);
    expect(cell).toBeLessThan(CELLS);
    expect(occ[layer * CELLS + cell]).toBe(0);
    expect(seen.has(cell)).toBe(false);
    seen.add(cell);
  }
  const [lx, ly] = xy(path[path.length - 1]!);
  expect(d2(lx, ly, gx, gy)).toBeLessThanOrEqual(reachSq);
  // Only the last cell may be in reach; otherwise the path would be longer than needed.
  for (const cell of path.slice(0, -1)) {
    const [x, y] = xy(cell);
    expect(d2(x, y, gx, gy)).toBeGreaterThan(reachSq);
  }
}

function mirrorOcc(occ: number[]): number[] {
  const out = emptyOcc();
  for (let layer = 0; layer < 2; layer++) {
    for (let c = 0; c < CELLS; c++) out[layer * CELLS + (CELLS - 1 - c)] = occ[layer * CELLS + c]!;
  }
  return out;
}

interface Case {
  occ: number[];
  layer: Layer;
  sx: number;
  sy: number;
  gx: number;
  gy: number;
  reachSq: number;
}

/** Random occupancy (0-45 %), start cell occupied by the walking unit itself. */
function randomCase(rnd: (n: number) => number): Case {
  const occ = emptyOcc();
  const layer: Layer = rnd(4) === 0 ? 1 : 0;
  const density = rnd(46);
  for (let l = 0; l < 2; l++) {
    for (let c = 0; c < CELLS; c++) if (rnd(100) < density) occ[l * CELLS + c] = 1 + rnd(500);
  }
  const sx = rnd(COLS);
  const sy = rnd(ROWS);
  occ[layer * CELLS + sy * COLS + sx] = 7777; // the unit itself
  const gx = rnd(COLS);
  const gy = rnd(ROWS);
  const reachSq = [2, 2, 2, 9, 25, 64][rnd(6)]!;
  return { occ, layer, sx, sy, gx, gy, reachSq };
}

function solve(c: Case, owner: PlayerIndex): number[] {
  return findPath(c.occ, c.layer, owner, c.sx, c.sy, c.gx, c.gy, c.reachSq);
}

describe('findPath', () => {
  it('finds the shortest path on a free field', () => {
    const occ = emptyOcc();
    const path = findPath(occ, 0, 0, 0, 0, 11, 23, MELEE_REACH);
    // Nearest cell in reach is (10, 22): 10 diagonal and 12 straight steps.
    expect(path).toHaveLength(22);
    expect(pathCost(0, 0, path)).toBe(10 * DIAGONAL + 12 * STRAIGHT);
    expectValidPath(occ, 0, 0, 0, 11, 23, MELEE_REACH, path);
  });

  it('walks straight ahead when that is the only shortest way', () => {
    const path = findPath(emptyOcc(), 0, 0, 5, 0, 5, 10, MELEE_REACH);
    expect(path.map(xy)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((y) => [5, y]));
  });

  it('returns [] if the goal is already in reach', () => {
    const occ = emptyOcc();
    expect(findPath(occ, 0, 0, 5, 5, 6, 6, MELEE_REACH)).toEqual([]);
    expect(findPath(occ, 0, 1, 5, 5, 5, 5, MELEE_REACH)).toEqual([]);
    expect(findPath(occ, 0, 0, 5, 5, 8, 9, 25)).toEqual([]); // (3,4) at range 5
  });

  it('goes through the only gap of a wall', () => {
    const occ = emptyOcc();
    for (let x = 0; x < COLS; x++) if (x !== 9) block(occ, 0, x, 6);
    const path = findPath(occ, 0, 0, 2, 2, 2, 12, MELEE_REACH);
    expectValidPath(occ, 0, 2, 2, 2, 12, MELEE_REACH, path);
    expect(path).toContain(6 * COLS + 9);
    expect(pathCost(2, 2, path)).toBe(referenceCost(occ, 0, 2, 2, 2, 12, MELEE_REACH));
  });

  it('returns [] if the unit is walled in', () => {
    const occ = emptyOcc();
    block(occ, 0, 5, 5, 1); // the unit itself
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) if (dx !== 0 || dy !== 0) block(occ, 0, 5 + dx, 5 + dy);
    }
    expect(findPath(occ, 0, 0, 5, 5, 5, 20, MELEE_REACH)).toEqual([]);
    expect(findPath(occ, 0, 1, 5, 5, 5, 20, MELEE_REACH)).toEqual([]);
  });

  it('returns [] if every cell in reach of the goal is taken', () => {
    const occ = emptyOcc();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) block(occ, 0, 5 + dx, 15 + dy);
    expect(findPath(occ, 0, 0, 5, 2, 5, 15, MELEE_REACH)).toEqual([]);
  });

  it('stops next to an occupied goal cell', () => {
    const occ = emptyOcc();
    block(occ, 0, 5, 10, 42); // the target unit
    const path = findPath(occ, 0, 0, 5, 2, 5, 10, MELEE_REACH);
    expect(path.map(xy).at(-1)).toEqual([5, 9]);
    expect(path).not.toContain(10 * COLS + 5);
    expectValidPath(occ, 0, 5, 2, 5, 10, MELEE_REACH, path);
  });

  it('treats the start cell as free even though the unit occupies it', () => {
    const occ = emptyOcc();
    block(occ, 0, 0, 0, 1);
    expect(pathCost(0, 0, findPath(occ, 0, 0, 0, 0, 0, 5, MELEE_REACH))).toBe(4 * STRAIGHT);
  });

  it('allows diagonal steps past occupied corners', () => {
    const occ = emptyOcc();
    // Only the diagonal (5,5) -> (6,6) is open; its two corner cells are taken.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) if (dx !== 1 || dy !== 1) block(occ, 0, 5 + dx, 5 + dy);
    }
    const path = findPath(occ, 0, 0, 5, 5, 8, 8, MELEE_REACH);
    expect(path.map(xy)[0]).toEqual([6, 6]);
  });

  it('ignores ground units on the air layer and vice versa', () => {
    const occ = emptyOcc();
    for (let x = 0; x < COLS; x++) block(occ, 0, x, 6); // full ground wall
    const air = findPath(occ, 1, 0, 5, 2, 5, 12, MELEE_REACH);
    expect(pathCost(5, 2, air)).toBe(9 * STRAIGHT);
    expect(findPath(occ, 0, 0, 5, 2, 5, 12, MELEE_REACH)).toEqual([]);

    const sky = emptyOcc();
    for (let x = 0; x < COLS; x++) block(sky, 1, x, 6); // full air wall
    expect(findPath(sky, 1, 0, 5, 2, 5, 12, MELEE_REACH)).toEqual([]);
    expect(pathCost(5, 2, findPath(sky, 0, 0, 5, 2, 5, 12, MELEE_REACH))).toBe(9 * STRAIGHT);
  });

  it('respects ranged reach (stops as soon as the goal is within range)', () => {
    const occ = emptyOcc();
    const path = findPath(occ, 0, 0, 5, 0, 5, 20, 25);
    expect(path.map(xy).at(-1)).toEqual([5, 15]);
  });

  it('matches a reference Dijkstra on 300 random fields', () => {
    const rnd = lcg(12345);
    let found = 0;
    let none = 0;
    for (let i = 0; i < 300; i++) {
      const c = randomCase(rnd);
      const ref = referenceCost(c.occ, c.layer, c.sx, c.sy, c.gx, c.gy, c.reachSq);
      for (const owner of [0, 1] as const) {
        const path = solve(c, owner);
        if (ref <= 0) {
          expect(path).toEqual([]);
        } else {
          expect(pathCost(c.sx, c.sy, path)).toBe(ref);
          expectValidPath(c.occ, c.layer, c.sx, c.sy, c.gx, c.gy, c.reachSq, path);
        }
      }
      if (ref > 0) found++;
      else none++;
    }
    // The generator must produce both kinds of cases to make the comparison meaningful.
    expect(found).toBeGreaterThan(100);
    expect(none).toBeGreaterThan(10);
  });

  it('is mirror-symmetric: player 1 on the rotated field walks the rotated path', () => {
    const rnd = lcg(999);
    for (let i = 0; i < 200; i++) {
      const c = randomCase(rnd);
      const mirrored: Case = {
        occ: mirrorOcc(c.occ),
        layer: c.layer,
        sx: COLS - 1 - c.sx,
        sy: ROWS - 1 - c.sy,
        gx: COLS - 1 - c.gx,
        gy: ROWS - 1 - c.gy,
        reachSq: c.reachSq,
      };
      const path = solve(c, 0);
      expect(solve(mirrored, 1)).toEqual(path.map((cell) => CELLS - 1 - cell));
      // And the other way round.
      expect(solve(mirrored, 0)).toEqual(solve(c, 1).map((cell) => CELLS - 1 - cell));
    }
  });

  it('gives the same answer regardless of earlier calls (no state between calls)', () => {
    const rnd = lcg(4242);
    const cases = Array.from({ length: 30 }, () => randomCase(rnd));
    const first = cases.map((c) => solve(c, 0));
    const again = [...cases]
      .reverse()
      .map((c) => solve(c, 0))
      .reverse();
    expect(again).toEqual(first);
  });

  it('does not modify the occupancy', () => {
    const c = randomCase(lcg(7));
    const before = [...c.occ];
    solve(c, 0);
    solve(c, 1);
    expect(c.occ).toEqual(before);
  });
});
