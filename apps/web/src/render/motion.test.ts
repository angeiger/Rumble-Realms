import { describe, expect, it } from 'vitest';
import { clamp, easeOutBack, stepFraction, unitFieldPosition, type UnitPlace } from './motion.ts';

const stepping: UnitPlace = { x: 2, y: 3, tx: 3, ty: 4, moveCost: 1414, moveProgress: 0 };
const standing: UnitPlace = { x: 5, y: 6, tx: 5, ty: 6, moveCost: 0, moveProgress: 0 };

describe('stepFraction', () => {
  it('is 0 at the start of a step', () => {
    expect(stepFraction(stepping, 50, 0)).toBe(0);
  });
  it('is half-way in the middle', () => {
    const half = { ...stepping, moveCost: 1000, moveProgress: 400 };
    expect(stepFraction(half, 50, 2)).toBeCloseTo(0.5, 12); // 400 + 2 * 50
  });
  it('is 1 when the step is done and never more', () => {
    expect(stepFraction({ ...stepping, moveProgress: 1414 }, 50, 0.9)).toBe(1);
    expect(stepFraction({ ...stepping, moveProgress: 1400 }, 90, 1)).toBe(1);
  });
  it('is 0 for a standing unit whatever the alpha', () => {
    expect(stepFraction(standing, 50, 0.7)).toBe(0);
  });
  it('never goes below 0', () => {
    expect(stepFraction({ ...stepping, moveProgress: -100 }, 50, 0)).toBe(0);
  });
});

describe('unitFieldPosition', () => {
  const o = { x: 0, y: 0 };
  it('starts on the logical cell', () => {
    expect(unitFieldPosition(stepping, 50, 0, o)).toEqual({ x: 2, y: 3 });
  });
  it('moves linearly towards the reserved cell', () => {
    const half = { ...stepping, moveCost: 1000, moveProgress: 400 };
    const p = unitFieldPosition(half, 50, 2, o);
    expect(p.x).toBeCloseTo(2.5, 12);
    expect(p.y).toBeCloseTo(3.5, 12);
  });
  it('ends on the reserved cell', () => {
    expect(unitFieldPosition({ ...stepping, moveProgress: 1414 }, 50, 0, o)).toEqual({
      x: 3,
      y: 4,
    });
  });
  it('keeps a standing unit on its cell', () => {
    expect(unitFieldPosition(standing, 50, 0.99, o)).toEqual({ x: 5, y: 6 });
  });
});

describe('helpers', () => {
  it('clamp', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });
  it('easeOutBack overshoots and ends at 1', () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 12);
    expect(easeOutBack(1)).toBeCloseTo(1, 12);
    expect(Math.max(easeOutBack(0.6), easeOutBack(0.7), easeOutBack(0.8))).toBeGreaterThan(1);
  });
});
