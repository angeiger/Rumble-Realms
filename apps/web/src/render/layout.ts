/**
 * Pure geometry of the battle view: fitting the field into the canvas and mapping field
 * coordinates to screen pixels for both viewing directions. No Pixi, no DOM.
 */
import { GRID_COLS, GRID_ROWS, type PlayerIndex } from '@rumble-realms/engine';

/** Where the field lies on the canvas (all values in canvas pixels). */
export interface FieldLayout {
  /** Edge length of one field cell. */
  cell: number;
  /** Top-left corner of the field. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Space around the field in cells. Figures are wider and taller than a cell and the ones
 * in the outer rows and columns must not be cut off by the canvas edge.
 */
export const FIELD_INSETS = { side: 0.3, top: 1.0, bottom: 0.2 } as const;

/**
 * Pixels at the top and bottom of the canvas that must stay free of the field, because the
 * header and the status line of the battle screen lie there (D-043). Safe areas included.
 */
export interface EdgeInsets {
  top: number;
  bottom: number;
}

export const NO_EDGE_INSETS: EdgeInsets = { top: 0, bottom: 0 };

/** Largest cell size that fits the whole field plus its insets into the given area. */
export function fitCell(width: number, height: number, edge: EdgeInsets = NO_EDGE_INSETS): number {
  const cellsW = GRID_COLS + 2 * FIELD_INSETS.side;
  const cellsH = GRID_ROWS + FIELD_INSETS.top + FIELD_INSETS.bottom;
  const freeH = height - edge.top - edge.bottom;
  return Math.max(0, Math.min(width / cellsW, freeH / cellsH));
}

/** Largest field that fits into a canvas of `width` x `height` (fixed aspect ratio), centred. */
export function computeLayout(
  width: number,
  height: number,
  edge: EdgeInsets = NO_EDGE_INSETS,
): FieldLayout {
  const cell = fitCell(width, height, edge);
  const fieldW = cell * GRID_COLS;
  const fieldH = cell * GRID_ROWS;
  const usedH = fieldH + cell * (FIELD_INSETS.top + FIELD_INSETS.bottom);
  return {
    cell,
    left: (width - fieldW) / 2,
    top: edge.top + (height - edge.top - edge.bottom - usedH) / 2 + cell * FIELD_INSETS.top,
    width: fieldW,
    height: fieldH,
  };
}

/**
 * Column of a field position in view direction (cell centres at integers). The local
 * player's half is always at the bottom: player 0 sees the field as it is (row 23 - y),
 * player 1 sees it turned by 180 degrees (row y, column 11 - x).
 */
export function viewCol(me: PlayerIndex, fx: number): number {
  return me === 0 ? fx : GRID_COLS - 1 - fx;
}

export function viewRow(me: PlayerIndex, fy: number): number {
  return me === 0 ? GRID_ROWS - 1 - fy : fy;
}

/**
 * Screen position of the centre of field position (`fx`, `fy`), which may be fractional
 * for units in the middle of a step. Writes into `out` and returns it (no allocation).
 */
export function fieldToScreen(
  layout: FieldLayout,
  me: PlayerIndex,
  fx: number,
  fy: number,
  out: Point,
): Point {
  out.x = layout.left + (viewCol(me, fx) + 0.5) * layout.cell;
  out.y = layout.top + (viewRow(me, fy) + 0.5) * layout.cell;
  return out;
}

/** Whether row `fy` of the field belongs to the local player's half. */
export function isOwnHalf(me: PlayerIndex, fy: number): boolean {
  return me === 0 ? fy < GRID_ROWS / 2 : fy >= GRID_ROWS / 2;
}
