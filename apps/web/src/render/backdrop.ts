/**
 * Backdrop "Gruenwiesen-Dorf" (SPEC 11): meadow with a subtle checkerboard, a dirt path
 * along the centre line, a slightly different tint for the enemy half and a dark border.
 * Drawn once per layout, never per frame.
 */
import { GRID_COLS, GRID_ROWS, HALF_ROWS, type PlayerIndex } from '@rumble-realms/engine';
import type { Graphics } from 'pixi.js';
import type { FieldLayout } from './layout.ts';
import { isOwnHalf } from './layout.ts';

/** Colour of the canvas outside the field. */
export const CANVAS_BACKGROUND = 0x28592e;

const GRASS_OWN = [0x77c35c, 0x6dba54] as const;
const GRASS_ENEMY = [0x6db056, 0x64a64f] as const;
const BORDER = 0x1d4024;
const PATH = 0xd9b873;
const PATH_EDGE = 0xa57c42;
const FLOWER_COLORS = [0xfff6d6, 0xffd23a, 0xff9bb3, 0xffffff] as const;

/** Small deterministic random generator: the decoration is the same on every start. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws the whole field into `g` (which should be empty). */
export function drawBackdrop(g: Graphics, layout: FieldLayout, me: PlayerIndex): void {
  const { cell, left, top, width, height } = layout;
  if (cell <= 0) return;

  drawForestEdge(g, layout);

  // Border: a dark frame around the field.
  const frame = cell * 0.22;
  g.roundRect(left - frame, top - frame, width + 2 * frame, height + 2 * frame, cell * 0.3).fill(
    BORDER,
  );

  // Checkerboard. Row 0 of the view is the top of the screen.
  for (let row = 0; row < GRID_ROWS; row++) {
    // Field row belonging to this screen row.
    const fy = me === 0 ? GRID_ROWS - 1 - row : row;
    const palette = isOwnHalf(me, fy) ? GRASS_OWN : GRASS_ENEMY;
    for (let col = 0; col < GRID_COLS; col++) {
      g.rect(left + col * cell, top + row * cell, cell + 0.5, cell + 0.5).fill(
        palette[(row + col) % 2] as number,
      );
    }
  }

  // Decoration: grass tufts, flowers, a few stones (more near the edges, never blocking).
  const rnd = mulberry32(20261114);
  for (let i = 0; i < 90; i++) {
    const col = Math.floor(rnd() * GRID_COLS);
    const row = Math.floor(rnd() * GRID_ROWS);
    // Keep the path clear.
    if (row === HALF_ROWS - 1 || row === HALF_ROWS) continue;
    const px = left + (col + 0.1 + rnd() * 0.8) * cell;
    const py = top + (row + 0.15 + rnd() * 0.75) * cell;
    const kind = rnd();
    if (kind < 0.5) {
      for (const dx of [-0.12, 0, 0.12]) {
        g.moveTo(px + dx * cell, py)
          .lineTo(px + dx * cell * 1.6, py - cell * 0.16)
          .stroke({ color: 0x4c9440, width: Math.max(1, cell * 0.04), cap: 'round', alpha: 0.7 });
      }
    } else if (kind < 0.85) {
      const color = FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)] as number;
      g.circle(px, py, cell * 0.06).fill({ color, alpha: 0.9 });
      g.circle(px, py, cell * 0.025).fill({ color: 0xffc83a, alpha: 0.9 });
    } else {
      g.ellipse(px, py, cell * 0.1, cell * 0.07).fill({ color: 0x9aa58f, alpha: 0.75 });
    }
  }

  // Dirt path along the centre line.
  const pathH = cell * 0.5;
  const mid = top + height / 2;
  g.rect(left, mid - pathH / 2 - cell * 0.05, width, pathH + cell * 0.1).fill(PATH_EDGE);
  g.rect(left, mid - pathH / 2, width, pathH).fill(PATH);
  for (let i = 0; i < GRID_COLS * 2; i++) {
    const x = left + (i + 0.5) * (cell / 2);
    g.circle(x, mid + (i % 2 === 0 ? -1 : 1) * cell * 0.08, cell * 0.035).fill({
      color: PATH_EDGE,
      alpha: 0.55,
    });
  }
}

/** Bushes and treetops around the field, so the canvas outside it looks like a forest edge. */
function drawForestEdge(g: Graphics, layout: FieldLayout): void {
  const { cell, left, top, width, height } = layout;
  const rnd = mulberry32(777);
  const shades = [0x1f4a26, 0x2a5c30, 0x347038] as const;
  const blob = (x: number, y: number): void => {
    const r = cell * (0.34 + rnd() * 0.22);
    g.circle(x, y + r * 0.25, r).fill({ color: 0x143019, alpha: 0.5 });
    g.circle(x, y, r).fill(shades[Math.floor(rnd() * shades.length)] as number);
    g.circle(x - r * 0.3, y - r * 0.3, r * 0.4).fill({ color: 0x4a8a46, alpha: 0.45 });
  };
  const rows = Math.ceil(height / (cell * 0.8)) + 4;
  for (let i = -2; i < rows; i++) {
    const y = top + i * cell * 0.8 + rnd() * cell * 0.2;
    blob(left - cell * (0.35 + rnd() * 0.35), y);
    blob(left + width + cell * (0.35 + rnd() * 0.35), y);
    if (i % 2 === 0) {
      blob(left - cell * (1.0 + rnd() * 0.5), y + cell * 0.4);
      blob(left + width + cell * (1.0 + rnd() * 0.5), y + cell * 0.4);
    }
  }
  const cols = Math.ceil(width / (cell * 0.8)) + 1;
  for (let i = 0; i < cols; i++) {
    const x = left + i * cell * 0.8 + rnd() * cell * 0.2;
    blob(x, top - cell * (0.45 + rnd() * 0.3));
    blob(x + cell * 0.4, top - cell * (1.1 + rnd() * 0.5));
    blob(x, top + height + cell * (0.45 + rnd() * 0.3));
    blob(x + cell * 0.4, top + height + cell * (1.1 + rnd() * 0.5));
  }
}
