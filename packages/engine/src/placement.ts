/**
 * Automatic set-up of the armies (D-042, D-046, D-052, D-053; replaces SPEC 4.4 and D-026).
 *
 * Everything is computed from the owner's point of view: relative column c (0-11) and
 * relative row r (0 = own base line, 11 = next to the middle). Player 0 uses (c, r) directly,
 * player 1 is rotated by 180 degrees to (11 - c, 23 - r), so all tie-breaks mirror exactly.
 *
 * The layout is a pure function of the army: it is computed from scratch after every pick
 * and at the start of every round, so units of earlier picks may move forward.
 */
import { FORMATION_ROW_WEIGHT, GRID_COLS, GRID_ROWS, HALF_ROWS } from './data/balance.ts';
import { CARDS } from './data/cards.ts';
import { spawnUnit } from './battle/state.ts';
import type { ArmyEntry, MatchState, PlayerIndex, Zone } from './types.ts';

/** Groups from the base line towards the middle (D-052). */
export const FORMATION_GROUPS: readonly Zone[] = ['back', 'mid', 'front'];

/** A unit's cell in absolute field coordinates. */
export interface PlacedUnit {
  id: number;
  x: number;
  y: number;
}

export interface ArmyLayout {
  /** Units that got a cell, in army order (= ascending id). */
  cells: PlacedUnit[];
  /** Ids of the units that found no free cell in the owner's half, ascending. */
  forfeited: number[];
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
 * Sets up the army of `player` (D-052):
 * - Groups "back", "mid", "front" one after another. The first group starts in row 0;
 *   every next group starts in the row after the highest row the previous group used
 *   (on either layer). A group without any placed unit does not move the start row.
 * - Inside a group the cards come in army order, their units one by one. A unit takes the
 *   free cell of its layer with start row <= r <= 11 that minimises
 *   (c - column)^2 + FORMATION_ROW_WEIGHT * (r - start row)^2; ties: smaller row, then
 *   smaller column. Ground and air cells are occupied separately.
 * - A unit without a free cell is forfeited.
 */
export function layoutArmy(entries: readonly ArmyEntry[], player: PlayerIndex): ArmyLayout {
  const cells: PlacedUnit[] = [];
  const forfeited: number[] = [];
  // Relative cell index r * GRID_COLS + c, per layer: true = taken.
  const taken: boolean[][] = [[], []];
  for (let i = 0; i < HALF_ROWS * GRID_COLS; i++) {
    (taken[0] as boolean[]).push(false);
    (taken[1] as boolean[]).push(false);
  }
  let bandStart = 0;
  for (const group of FORMATION_GROUPS) {
    let highestRow = -1;
    for (const entry of entries) {
      if (entry.player !== player) continue;
      const def = CARDS[entry.card];
      if (def.zone !== group) continue;
      const column = entry.column;
      if (!Number.isInteger(column) || column < 0 || column >= GRID_COLS) {
        throw new Error(`layoutArmy: column must be an integer 0..${GRID_COLS - 1}, got ${column}`);
      }
      const layerTaken = taken[def.layer] as boolean[];
      for (const id of entry.unitIds) {
        let best = -1;
        let bestD = 0;
        for (let r = bandStart; r < HALF_ROWS; r++) {
          const dr = r - bandStart;
          const rowCost = FORMATION_ROW_WEIGHT * dr * dr;
          // Rows further out cost at least as much; an equal cost loses to the smaller row.
          if (best >= 0 && rowCost >= bestD) break;
          for (let c = 0; c < GRID_COLS; c++) {
            const cell = r * GRID_COLS + c;
            if (layerTaken[cell] === true) continue;
            const d = (c - column) * (c - column) + rowCost;
            if (best < 0 || d < bestD) {
              best = cell;
              bestD = d;
            }
          }
        }
        if (best < 0) {
          forfeited.push(id);
          continue;
        }
        layerTaken[best] = true;
        const r = (best - (best % GRID_COLS)) / GRID_COLS;
        const c = best % GRID_COLS;
        if (r > highestRow) highestRow = r;
        cells.push({ id, x: absCol(player, c), y: absRow(player, r) });
      }
    }
    if (highestRow >= 0) bandStart = highestRow + 1;
  }
  cells.sort((a, b) => a.id - b.id);
  forfeited.sort((a, b) => a - b);
  return { cells, forfeited };
}

/**
 * Puts the whole army of both players onto the field (D-053): removes all units of the
 * field and spawns every army unit with full hit points on its layout cell, keeping its id.
 * `battle.units` ends up sorted by id and `battle.nextUnitId` equals `state.nextUnitId`.
 * Only allowed before the battle has started. Returns the ids that found no cell, ascending.
 */
export function rebuildField(state: MatchState): number[] {
  const b = state.battle;
  if (b.started) throw new Error('rebuildField: the battle has already started');
  const layouts = [layoutArmy(state.army, 0), layoutArmy(state.army, 1)] as const;
  const entryOf = new Map<number, ArmyEntry>();
  for (const entry of state.army) for (const id of entry.unitIds) entryOf.set(id, entry);
  // Spawn in ascending id order, so `units` stays sorted (spawnUnit rejects duplicates).
  const cells = [...layouts[0].cells, ...layouts[1].cells];
  cells.sort((x, y) => x.id - y.id);

  b.units = [];
  b.occ.fill(0);
  for (const cell of cells) {
    const entry = entryOf.get(cell.id) as ArmyEntry;
    spawnUnit(b, entry.player, entry.card, entry.level, cell.x, cell.y, cell.id);
  }
  b.nextUnitId = state.nextUnitId;
  const forfeited = [...layouts[0].forfeited, ...layouts[1].forfeited];
  forfeited.sort((x, y) => x - y);
  return forfeited;
}
