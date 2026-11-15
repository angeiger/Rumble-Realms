/**
 * Automatic set-up of the armies (D-042, D-046, D-053, D-070; replaces SPEC 4.4).
 *
 * Everything is computed from the owner's point of view: relative column c (0-11) and
 * relative row r (0 = own base line, 11 = next to the middle). Player 0 uses (c, r) directly,
 * player 1 is rotated by 180 degrees to (11 - c, 23 - r), so both armies mirror exactly.
 *
 * The layout is a pure function of the army: it is computed from scratch after every pick
 * and at the start of every round, so units of earlier picks may move.
 */
import { GRID_COLS, GRID_ROWS, HALF_ROWS } from './data/balance.ts';
import { CARDS, FORMATION_RANKS } from './data/cards.ts';
import { makeGiant, spawnUnit } from './battle/state.ts';
import { hasUpgrade, refParam, upgradeRef } from './upgrades.ts';
import type { ArmyEntry, MatchState, PlayerIndex } from './types.ts';

const GIANT = upgradeRef('shroomling.giant_mushroom');

/** A unit's cell in absolute field coordinates. */
export interface PlacedUnit {
  id: number;
  x: number;
  y: number;
}

export interface ArmyLayout {
  /** Units that got a cell, ascending by id. */
  cells: PlacedUnit[];
  /** Ids of the units that found no row in the owner's half, ascending. */
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
 * Sets up the army of `player` in centred rows by rank (D-070):
 * - The ranks of `FORMATION_RANKS` follow each other from the base line (row 0) towards the
 *   middle. A rank without units takes no row.
 * - The units of a rank line up per layer: card by card in the order of the rank, within a
 *   card in army order. Each layer fills rows of `GRID_COLS` cells from the back; the last
 *   (frontmost) row holds the rest.
 * - Every row is centred. If an odd number of cells stays free, the row stands half a column
 *   to the left of the middle (seen from the owner): k units start in column
 *   floor((GRID_COLS - k) / 2).
 * - A rank takes as many rows as its fuller layer needs; the next rank starts in front of it.
 * - Units whose row would lie beyond the own half are forfeited (D-055).
 */
export function layoutArmy(entries: readonly ArmyEntry[], player: PlayerIndex): ArmyLayout {
  const cells: PlacedUnit[] = [];
  const forfeited: number[] = [];
  let firstRow = 0;
  for (const rank of FORMATION_RANKS) {
    // Unit ids of this rank per layer, in line-up order.
    const lines: [number[], number[]] = [[], []];
    for (const card of rank) {
      const line = lines[CARDS[card].layer];
      for (const entry of entries) {
        if (entry.player !== player || entry.card !== card) continue;
        for (const id of entry.unitIds) line.push(id);
      }
    }
    let rankRows = 0;
    for (const line of lines) {
      const n = line.length;
      const rows = Math.ceil(n / GRID_COLS);
      if (rows > rankRows) rankRows = rows;
      for (let i = 0; i < n; i++) {
        const id = line[i] as number;
        const rowOfRank = Math.floor(i / GRID_COLS);
        const r = firstRow + rowOfRank;
        if (r >= HALF_ROWS) {
          forfeited.push(id);
          continue;
        }
        const inRow = Math.min(GRID_COLS, n - rowOfRank * GRID_COLS);
        const c = Math.floor((GRID_COLS - inRow) / 2) + (i % GRID_COLS);
        cells.push({ id, x: absCol(player, c), y: absRow(player, r) });
      }
    }
    firstRow += rankRows;
  }
  cells.sort((a, b) => a.id - b.id);
  forfeited.sort((a, b) => a - b);
  return { cells, forfeited };
}

/**
 * Puts the whole army of both players onto the field (D-053): removes all units of the
 * field and spawns every army unit with full hit points on its layout cell, keeping its id,
 * with the stats of the currently active upgrades.
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
  // Units take the stats of the upgrades active right now (spawnUnit reads b.upgrades).
  b.upgrades = [{ ...state.activeUpgrades[0] }, { ...state.activeUpgrades[1] }];
  for (const cell of cells) {
    const entry = entryOf.get(cell.id) as ArmyEntry;
    const unit = spawnUnit(b, entry.player, entry.card, entry.level, cell.x, cell.y, cell.id);
    // Riesenpilz: the first unit of every group of the card's base count in the entry.
    if (
      entry.card === GIANT.card &&
      hasUpgrade(b.upgrades[entry.player][entry.card] ?? 0, GIANT.index) &&
      entry.unitIds.indexOf(cell.id) % CARDS[entry.card].count === 0
    ) {
      makeGiant(unit, refParam(GIANT, 'hpBps'), refParam(GIANT, 'damageBps'));
    }
  }
  b.nextUnitId = state.nextUnitId;
  const forfeited = [...layouts[0].forfeited, ...layouts[1].forfeited];
  forfeited.sort((x, y) => x - y);
  return forfeited;
}
