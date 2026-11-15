import { describe, expect, it } from 'vitest';
import { UPGRADE_UNLOCK_LEVELS, upgradesForLevel } from './progression.ts';

describe('upgradesForLevel (SPEC 7.3)', () => {
  it('unlocks upgrade 1 at level 2, upgrade 2 at level 3 and upgrade 3 at level 5', () => {
    expect(UPGRADE_UNLOCK_LEVELS).toEqual([2, 3, 5]);
    expect([1, 2, 3, 4, 5].map(upgradesForLevel)).toEqual([0, 0b001, 0b011, 0b011, 0b111]);
  });
});
