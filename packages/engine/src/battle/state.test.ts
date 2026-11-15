/** Field basics: spawning with and without a fixed id (D-053). */
import { describe, expect, it } from 'vitest';
import { createBattle, spawnUnit, unitById } from './state.ts';

function emptyField() {
  return createBattle([1, 2, 3, 4]);
}

describe('spawnUnit', () => {
  it('numbers units from nextUnitId without an id', () => {
    const b = emptyField();
    expect([spawnUnit(b, 0, 'knight', 1, 0, 0).id, spawnUnit(b, 1, 'bat', 2, 5, 20).id]).toEqual([
      1, 2,
    ]);
    expect(b.nextUnitId).toBe(3);
  });

  it('keeps a given id and moves nextUnitId past it', () => {
    const b = emptyField();
    const u = spawnUnit(b, 0, 'knight', 1, 3, 3, 40);
    expect(u.id).toBe(40);
    expect(b.nextUnitId).toBe(41);
    expect(b.occ[3 * 12 + 3]).toBe(40);
    expect(unitById(b, 40)).toBe(u);
    // A lower id later on leaves nextUnitId alone ...
    b.nextUnitId = 100;
    spawnUnit(b, 0, 'knight', 1, 4, 3, 50);
    expect(b.nextUnitId).toBe(100);
    // ... and automatic numbering continues above every id.
    expect(spawnUnit(b, 1, 'knight', 1, 4, 20).id).toBe(100);
    expect(b.units.map((x) => x.id)).toEqual([40, 50, 100]);
  });

  it('starts every unit without jump target and without burning fuse', () => {
    const b = emptyField();
    for (const card of ['assassin', 'tnt', 'knight'] as const) {
      const u = spawnUnit(b, 0, card, 1, b.units.length, 0);
      expect([u.jumpTick, u.jumpX, u.jumpY, u.fuseTick]).toEqual([-1, -1, -1, -1]);
    }
  });

  it('rejects an id that is not above every id on the field', () => {
    const b = emptyField();
    spawnUnit(b, 0, 'knight', 1, 0, 0, 7);
    expect(() => spawnUnit(b, 0, 'knight', 1, 1, 0, 7)).toThrow(/id 7/);
    expect(() => spawnUnit(b, 0, 'knight', 1, 1, 0, 3)).toThrow(/id 3/);
    expect(() => spawnUnit(b, 0, 'knight', 1, 1, 0, 8.5)).toThrow(/id/);
    expect(b.units).toHaveLength(1);
  });

  it('rejects a taken cell', () => {
    const b = emptyField();
    spawnUnit(b, 0, 'knight', 1, 0, 0);
    expect(() => spawnUnit(b, 1, 'knight', 1, 0, 0, 9)).toThrow(/not free/);
    expect(spawnUnit(b, 1, 'bat', 1, 0, 0).layer).toBe(1);
  });
});
