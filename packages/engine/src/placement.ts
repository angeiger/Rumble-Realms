/**
 * Automatic placement of a picked card's units (SPEC 4.4, D-026).
 *
 * Everything is computed from the owner's point of view: relative column c (0-11) and
 * relative row r (0 = own base line, 11 = next to the middle). Player 0 uses (c, r) directly,
 * player 1 is rotated by 180 degrees to (11 - c, 23 - r), so all tie-breaks mirror exactly.
 */
import { GRID_COLS, GRID_ROWS, ZONE_ROWS } from './data/balance.ts';
import { CARDS } from './data/cards.ts';
import { isFree, spawnUnit } from './battle/state.ts';
import { distSq } from './math.ts';
import { nextInt } from './rng.ts';
import type { BattleState, CardId, Layer, PlayerIndex, RngState, Zone } from './types.ts';

export interface PlacementResult {
  /** Ids of the spawned units, in spawn order. */
  spawned: number[];
  /** Units that found no free cell in the owner's half. */
  forfeited: number;
}

/** Zones ordered from the base line to the middle. */
const ZONES_FROM_BASE: readonly Zone[] = ['back', 'mid', 'front'];

/**
 * Order in which zones are tried for a card of `zone`: the zone itself, then zone by zone
 * towards the base line, then towards the middle (D-026).
 */
export function zoneOrder(zone: Zone): Zone[] {
  const k = ZONES_FROM_BASE.indexOf(zone);
  const order: Zone[] = [];
  for (let i = k; i >= 0; i--) order.push(ZONES_FROM_BASE[i] as Zone);
  for (let i = k + 1; i < ZONES_FROM_BASE.length; i++) order.push(ZONES_FROM_BASE[i] as Zone);
  return order;
}

/** Absolute column of relative column `c` for `owner`. */
export function absCol(owner: PlayerIndex, c: number): number {
  return owner === 0 ? c : GRID_COLS - 1 - c;
}

/** Absolute row of relative row `r` (0 = own base line) for `owner`. */
export function absRow(owner: PlayerIndex, r: number): number {
  return owner === 0 ? r : GRID_ROWS - 1 - r;
}

/**
 * Nearest free cell of `zone` to (centerCol, front row of the zone), as relative [c, r];
 * null if the zone is full on `layer`. Ties: smaller relative column, then smaller row.
 */
function nearestFree(
  b: BattleState,
  owner: PlayerIndex,
  layer: Layer,
  zone: Zone,
  centerCol: number,
): [number, number] | null {
  const rows = ZONE_ROWS[zone];
  const centerRow = rows.to;
  let best: [number, number] | null = null;
  let bestD = 0;
  // Columns outer, rows inner, both ascending: the first cell found wins every tie.
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = rows.from; r <= rows.to; r++) {
      if (!isFree(b, layer, absCol(owner, c), absRow(owner, r))) continue;
      const d = distSq(c, r, centerCol, centerRow);
      if (best === null || d < bestD) {
        best = [c, r];
        bestD = d;
      }
    }
  }
  return best;
}

/**
 * Places `count` units of `card` for `owner` on the field.
 * Draws exactly one `nextInt(rng, GRID_COLS)` (the center column), whatever the field
 * looks like, so later draws of this stream never depend on the board.
 */
export function placeCard(
  battle: BattleState,
  rng: RngState,
  owner: PlayerIndex,
  card: CardId,
  level: number,
  count: number,
): PlacementResult {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`placeCard: count must be a non-negative integer, got ${count}`);
  }
  const def = CARDS[card];
  const centerCol = nextInt(rng, GRID_COLS);
  const zones = zoneOrder(def.zone);
  const spawned: number[] = [];
  let zi = 0;
  let placed = 0;
  // A zone that is full stays full during this call, so the zone index only moves forward.
  while (placed < count && zi < zones.length) {
    const cell = nearestFree(battle, owner, def.layer, zones[zi] as Zone, centerCol);
    if (cell === null) {
      zi++;
      continue;
    }
    const unit = spawnUnit(
      battle,
      owner,
      card,
      level,
      absCol(owner, cell[0]),
      absRow(owner, cell[1]),
    );
    spawned.push(unit.id);
    placed++;
  }
  return { spawned, forfeited: count - placed };
}
