import { describe, expect, it } from 'vitest';
import { GRID_COLS, GRID_ROWS } from '@rumble-realms/engine';
import {
  FIELD_INSETS,
  computeLayout,
  fieldToScreen,
  fitCell,
  isOwnHalf,
  type Point,
} from './layout.ts';

const out = (): Point => ({ x: 0, y: 0 });

describe('fitCell', () => {
  const w = (GRID_COLS + 2 * FIELD_INSETS.side) * 10;
  const h = (GRID_ROWS + FIELD_INSETS.top + FIELD_INSETS.bottom) * 10;
  it('is limited by the height for a wide container', () => {
    expect(fitCell(w * 10, h)).toBeCloseTo(10, 9);
  });
  it('is limited by the width for a tall container', () => {
    expect(fitCell(w, h * 10)).toBeCloseTo(10, 9);
  });
  it('is never negative', () => {
    expect(fitCell(-5, -5)).toBe(0);
  });
});

describe('computeLayout', () => {
  it('keeps the aspect ratio 1:2 and the insets inside the canvas', () => {
    for (const [w, h] of [
      [412, 915],
      [800, 600],
      [300, 1200],
      [1920, 1080],
    ] as const) {
      const l = computeLayout(w, h);
      expect(l.width / l.height).toBeCloseTo(GRID_COLS / GRID_ROWS, 9);
      expect(l.width).toBeCloseTo(l.cell * GRID_COLS, 9);
      expect(l.left).toBeGreaterThanOrEqual(l.cell * FIELD_INSETS.side - 1e-9);
      expect(l.left + l.width).toBeLessThanOrEqual(w - l.cell * FIELD_INSETS.side + 1e-9);
      expect(l.top).toBeGreaterThanOrEqual(l.cell * FIELD_INSETS.top - 1e-9);
      expect(l.top + l.height).toBeLessThanOrEqual(h - l.cell * FIELD_INSETS.bottom + 1e-9);
    }
  });
  it('fills the limiting dimension completely', () => {
    const l = computeLayout(412, 915);
    expect(l.left * 2 + l.width).toBeCloseTo(412, 6);
  });
  it('centres the field horizontally', () => {
    const l = computeLayout(500, 900);
    expect(l.left + l.width / 2).toBeCloseTo(250, 9);
  });
  it('survives a zero-sized canvas', () => {
    expect(computeLayout(0, 0).cell).toBe(0);
  });
});

describe('fieldToScreen', () => {
  const layout = { cell: 10, left: 20, top: 100, width: 120, height: 240 };

  it('maps the corners for me = 0 (own half at the bottom)', () => {
    // Field (0, 0) is the bottom-left cell, (11, 23) the top-right cell.
    expect(fieldToScreen(layout, 0, 0, 0, out())).toEqual({ x: 25, y: 335 });
    expect(fieldToScreen(layout, 0, 11, 0, out())).toEqual({ x: 135, y: 335 });
    expect(fieldToScreen(layout, 0, 0, 23, out())).toEqual({ x: 25, y: 105 });
    expect(fieldToScreen(layout, 0, 11, 23, out())).toEqual({ x: 135, y: 105 });
  });

  it('turns the view by 180 degrees for me = 1', () => {
    expect(fieldToScreen(layout, 1, 0, 0, out())).toEqual({ x: 135, y: 105 });
    expect(fieldToScreen(layout, 1, 11, 0, out())).toEqual({ x: 25, y: 105 });
    expect(fieldToScreen(layout, 1, 0, 23, out())).toEqual({ x: 135, y: 335 });
    expect(fieldToScreen(layout, 1, 11, 23, out())).toEqual({ x: 25, y: 335 });
  });

  it('puts the own half at the bottom for both players', () => {
    const mid = layout.top + layout.height / 2;
    for (const me of [0, 1] as const) {
      const own = me === 0 ? 3 : 20;
      const foe = me === 0 ? 20 : 3;
      expect(fieldToScreen(layout, me, 5, own, out()).y).toBeGreaterThan(mid);
      expect(fieldToScreen(layout, me, 5, foe, out()).y).toBeLessThan(mid);
    }
  });

  it('interpolates fractional positions linearly', () => {
    expect(fieldToScreen(layout, 0, 0.5, 0.5, out())).toEqual({ x: 30, y: 330 });
  });

  it('reuses the given output object', () => {
    const o = out();
    expect(fieldToScreen(layout, 0, 1, 1, o)).toBe(o);
  });
});

describe('isOwnHalf', () => {
  it('splits at row 12', () => {
    expect(isOwnHalf(0, 11)).toBe(true);
    expect(isOwnHalf(0, 12)).toBe(false);
    expect(isOwnHalf(1, 12)).toBe(true);
    expect(isOwnHalf(1, GRID_ROWS - 1)).toBe(true);
    expect(isOwnHalf(1, 11)).toBe(false);
  });
});

describe('computeLayout with edge insets', () => {
  it('keeps the field clear of the header and the status line', () => {
    for (const [w, h, top, bottom] of [
      [412, 915, 56, 42],
      [390, 844, 70, 76],
      [1000, 700, 60, 40],
    ] as const) {
      const l = computeLayout(w, h, { top, bottom });
      const headroom = l.cell * FIELD_INSETS.top;
      const footroom = l.cell * FIELD_INSETS.bottom;
      expect(l.top - headroom).toBeGreaterThanOrEqual(top - 1e-9);
      expect(l.top + l.height + footroom).toBeLessThanOrEqual(h - bottom + 1e-9);
      expect(l.width / l.height).toBeCloseTo(GRID_COLS / GRID_ROWS, 9);
    }
  });
  it('is the old layout without insets', () => {
    expect(computeLayout(412, 915, { top: 0, bottom: 0 })).toEqual(computeLayout(412, 915));
  });
});
