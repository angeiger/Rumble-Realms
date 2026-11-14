/** A* path finding on one layer of the field (SPEC 6.2, step 4). */
import type { Layer, PlayerIndex } from '../types.ts';

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
  // Placeholder until the path finding work package lands: units simply keep waiting.
  void occ;
  void layer;
  void owner;
  void sx;
  void sy;
  void gx;
  void gy;
  void reachSq;
  return [];
}
