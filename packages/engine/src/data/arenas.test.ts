import { describe, expect, it } from 'vitest';
import { ARENAS } from './arenas.ts';
import { CARD_IDS, CARDS } from './cards.ts';

describe('ARENAS (SPEC 7.5)', () => {
  it('matches the table', () => {
    expect(ARENAS.map((a) => [a.id, a.minElo, a.goldMultiplierBps])).toEqual([
      [1, 0, 10000],
      [2, 1100, 12000],
      [3, 1250, 14000],
      [4, 1400, 16000],
      [5, 1600, 20000],
    ]);
  });

  it('gives every card an existing arena', () => {
    const ids = new Set(ARENAS.map((a) => a.id));
    for (const id of CARD_IDS) expect(ids.has(CARDS[id].arena), id).toBe(true);
  });

  it('puts the cards of SPEC 7.5 into their arenas', () => {
    const byArena = (n: number) => CARD_IDS.filter((id) => CARDS[id].arena === n).sort();
    expect(byArena(1)).toEqual(
      ['archer', 'knight', 'skeleton', 'bat', 'tnt', 'healer', 'musketeer'].sort(),
    );
    expect(byArena(2)).toEqual(
      ['assassin', 'berserker', 'shroomling', 'pyromancer', 'necromancer'].sort(),
    );
    expect(byArena(3)).toEqual(['beetle', 'golem']);
    expect(byArena(4)).toEqual(['frost_shaman']);
    expect(byArena(5)).toEqual(['whelp']);
  });
});
