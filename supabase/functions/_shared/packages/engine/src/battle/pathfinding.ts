/** A* path finding on one layer of the field (SPEC 6.2, step 4). */
import * as balance from '../data/balance.ts';
import * as math from '../math.ts';
import type { Layer, PlayerIndex } from '../types.ts';

// Local copies of the imports used in the inner loops (see the note in sim.ts).
const { DIAGONAL_STEP, FIELD, GRID_CELLS, GRID_COLS, GRID_ROWS } = balance;
const { distSq } = math;

/**
 * Step directions seen from player 0 (forward = towards higher rows): straight steps
 * first, then diagonals. Player 1 uses the same list rotated by 180 degrees, so ties
 * are resolved mirror-symmetrically.
 */
export const STEP_DX: readonly number[] = [0, -1, 1, 0, -1, 1, -1, 1];
export const STEP_DY: readonly number[] = [1, 0, 0, -1, 1, 1, -1, -1];

const UNREACHED = 0x7fffffff;
/** Heap entries pack (f, cell) into one integer: f * CELL_SLOTS + cell. */
const CELL_SLOTS = 512;
const CELL_MASK = CELL_SLOTS - 1;
const CELL_SHIFT = 9;

// Work arrays, reused by every call. They never carry information from one call to the next.
const dist = new Int32Array(GRID_CELLS);
const closed = new Uint8Array(GRID_CELLS);
/** Each cell is pushed at most once as a source and once per neighbour. */
const heap = new Int32Array(GRID_CELLS * 9);
let heapSize = 0;

function heapPush(key: number): void {
  let i = heapSize++;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const pk = heap[parent] as number;
    if (pk <= key) break;
    heap[i] = pk;
    i = parent;
  }
  heap[i] = key;
}

function heapPop(): number {
  const top = heap[0] as number;
  const last = heap[--heapSize] as number;
  let i = 0;
  for (;;) {
    const left = 2 * i + 1;
    if (left >= heapSize) break;
    const right = left + 1;
    let child = left;
    if (right < heapSize && (heap[right] as number) < (heap[left] as number)) child = right;
    const ck = heap[child] as number;
    if (ck >= last) break;
    heap[i] = ck;
    i = child;
  }
  if (heapSize > 0) heap[i] = last;
  return top;
}

/** Octile distance in milli-fields: the exact cost on an empty field (consistent heuristic). */
function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  const lo = Math.min(dx, dy);
  return DIAGONAL_STEP * lo + FIELD * (Math.max(dx, dy) - lo);
}

/**
 * Shortest path for a unit standing on (sx, sy) to the nearest cell from which the goal
 * cell (gx, gy) is within `reachSq` (squared distance in cells, see `rangeSq` in math.ts).
 *
 * - Moves in 8 directions; a straight step costs FIELD, a diagonal one DIAGONAL_STEP.
 * - A cell is blocked if `occ` holds a unit id for it on `layer` (index: see `occIndex`).
 *   The start cell counts as free; the goal cell itself need not be free.
 * - Returns the cells to walk as cell indices (y * GRID_COLS + x), without the start cell.
 *   Returns [] if the start already satisfies the goal or if there is no way.
 * - Must be fully deterministic: integer costs only, ties broken by a fixed rule that is
 *   mirrored for player 1 (`owner`), so that neither side is favoured.
 *
 * Method: everything runs in the owner's own frame (player 1: field rotated by 180 degrees).
 * An A* search runs backwards from all enterable cells in reach of the goal towards the
 * start and settles every cell whose estimate does not exceed the optimal cost. The path
 * is then walked forwards from the start: each step takes the first direction in
 * STEP_DX/STEP_DY order that stays on an optimal path. This result depends only on the
 * exact costs, never on the order of equal heap entries.
 */
export function findPath(
  occ: readonly number[],
  layer: Layer,
  owner: PlayerIndex,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  reachSq: number,
): number[] {
  if (distSq(sx, sy, gx, gy) <= reachSq) return [];
  const flip = owner === 1;
  const base = layer * GRID_CELLS;
  // Start and goal in the owner's frame; distances are invariant under the rotation.
  const lsx = flip ? GRID_COLS - 1 - sx : sx;
  const lsy = flip ? GRID_ROWS - 1 - sy : sy;
  const lgx = flip ? GRID_COLS - 1 - gx : gx;
  const lgy = flip ? GRID_ROWS - 1 - gy : gy;
  const start = lsy * GRID_COLS + lsx;

  dist.fill(UNREACHED);
  closed.fill(0);
  heapSize = 0;

  // Sources: every enterable cell from which the goal is in reach (the start is not one).
  for (let cell = 0; cell < GRID_CELLS; cell++) {
    if (occ[base + (flip ? GRID_CELLS - 1 - cell : cell)] !== 0) continue;
    const x = cell % GRID_COLS;
    const y = (cell - x) / GRID_COLS;
    if (distSq(x, y, lgx, lgy) > reachSq) continue;
    dist[cell] = 0;
    heapPush(octile(x, y, lsx, lsy) * CELL_SLOTS + cell);
  }

  let best = UNREACHED;
  while (heapSize > 0) {
    const key = heapPop();
    if (key >> CELL_SHIFT > best) break;
    const cell = key & CELL_MASK;
    if (closed[cell] === 1) continue;
    closed[cell] = 1;
    const g = dist[cell] as number;
    if (cell === start) {
      best = g;
      continue;
    }
    const x = cell % GRID_COLS;
    const y = (cell - x) / GRID_COLS;
    for (let i = 0; i < 8; i++) {
      const nx = x + (STEP_DX[i] as number);
      const ny = y + (STEP_DY[i] as number);
      if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
      const next = ny * GRID_COLS + nx;
      if (closed[next] === 1) continue;
      if (next !== start && occ[base + (flip ? GRID_CELLS - 1 - next : next)] !== 0) continue;
      const ng = g + (nx !== x && ny !== y ? DIAGONAL_STEP : FIELD);
      if (ng < (dist[next] as number)) {
        dist[next] = ng;
        heapPush((ng + octile(nx, ny, lsx, lsy)) * CELL_SLOTS + next);
      }
    }
  }
  if (best === UNREACHED) return [];

  // Walk forwards. A neighbour whose cost plus the step equals the current cost lies on an
  // optimal path; its cost is then exact, because estimates are never below the truth.
  const path: number[] = [];
  let cell = start;
  while ((dist[cell] as number) !== 0) {
    const x = cell % GRID_COLS;
    const y = (cell - x) / GRID_COLS;
    const here = dist[cell] as number;
    let chosen = -1;
    for (let i = 0; i < 8; i++) {
      const nx = x + (STEP_DX[i] as number);
      const ny = y + (STEP_DY[i] as number);
      if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
      const next = ny * GRID_COLS + nx;
      const d = dist[next] as number;
      if (d === UNREACHED) continue;
      if (d + (nx !== x && ny !== y ? DIAGONAL_STEP : FIELD) === here) {
        chosen = next;
        break;
      }
    }
    // Cannot happen for an optimal cost; guards against an endless loop all the same.
    if (chosen < 0) return [];
    path.push(flip ? GRID_CELLS - 1 - chosen : chosen);
    cell = chosen;
  }
  return path;
}
