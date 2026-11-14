import { describe, expect, it } from 'vitest';
import { createBattle, spawnUnit, unitById } from './battle/state.ts';
import { GRID_COLS, HALF_ROWS, ZONE_ROWS } from './data/balance.ts';
import { CARD_IDS, CARDS } from './data/cards.ts';
import { absCol, absRow, placeCard, zoneOrder } from './placement.ts';
import { nextInt, seedRng, STREAM_PLACEMENT } from './rng.ts';
import type { BattleState, CardId, PlayerIndex, RngState, Zone } from './types.ts';
import { AIR, GROUND } from './types.ts';

function emptyBattle(): BattleState {
  return createBattle(seedRng(0, 4));
}

function copyRng(rng: RngState): RngState {
  return [rng[0], rng[1], rng[2], rng[3]];
}

/** A placement stream whose next center column is `col`. */
function rngWithCenter(col: number): RngState {
  for (let seed = 0; ; seed++) {
    const rng = seedRng(seed, STREAM_PLACEMENT);
    if (nextInt(copyRng(rng), GRID_COLS) === col) return rng;
  }
}

/** Relative [c, r] of the spawned units. */
function relCells(b: BattleState, owner: PlayerIndex, ids: number[]): [number, number][] {
  return ids.map((id) => {
    const u = unitById(b, id);
    if (u === undefined) throw new Error(`unit ${id} missing`);
    return [absCol(owner, u.x), absRow(owner, u.y)];
  });
}

/** Fills every cell of `zones` for `owner` on `layer`, optionally leaving some free. */
function fill(
  b: BattleState,
  owner: PlayerIndex,
  layer: typeof GROUND | typeof AIR,
  zones: Zone[],
  keepFree: [number, number][] = [],
): void {
  const filler: CardId = layer === GROUND ? 'knight' : 'bat';
  for (const zone of zones) {
    for (let c = 0; c < GRID_COLS; c++) {
      for (let r = ZONE_ROWS[zone].from; r <= ZONE_ROWS[zone].to; r++) {
        if (keepFree.some(([kc, kr]) => kc === c && kr === r)) continue;
        spawnUnit(b, owner, filler, 1, absCol(owner, c), absRow(owner, r));
      }
    }
  }
}

describe('coordinates', () => {
  it('maps player 0 directly and rotates player 1 by 180 degrees', () => {
    expect([absCol(0, 0), absRow(0, 0)]).toEqual([0, 0]);
    expect([absCol(0, 11), absRow(0, 11)]).toEqual([11, 11]);
    expect([absCol(1, 0), absRow(1, 0)]).toEqual([11, 23]);
    expect([absCol(1, 11), absRow(1, 11)]).toEqual([0, 12]);
    expect([absCol(1, 3), absRow(1, 5)]).toEqual([8, 18]);
  });

  it('tries zones towards the base line first, then towards the middle', () => {
    expect(zoneOrder('front')).toEqual(['front', 'mid', 'back']);
    expect(zoneOrder('mid')).toEqual(['mid', 'back', 'front']);
    expect(zoneOrder('back')).toEqual(['back', 'mid', 'front']);
  });
});

describe('placeCard', () => {
  it('places a single unit on the center column in the front row of its zone', () => {
    const expected: Record<Zone, number> = { front: 11, mid: 7, back: 3 };
    for (const card of CARD_IDS) {
      const b = emptyBattle();
      const res = placeCard(b, rngWithCenter(4), 0, card, 1, 1);
      expect(relCells(b, 0, res.spawned)).toEqual([[4, expected[CARDS[card].zone]]]);
    }
  });

  it('keeps every unit of every card in its zone on an empty field', () => {
    for (const card of CARD_IDS) {
      for (const owner of [0, 1] as const) {
        for (let seed = 0; seed < 20; seed++) {
          const b = emptyBattle();
          const def = CARDS[card];
          const res = placeCard(b, seedRng(seed, STREAM_PLACEMENT), owner, card, 1, def.count);
          expect(res.spawned).toHaveLength(def.count);
          expect(res.forfeited).toBe(0);
          for (const [c, r] of relCells(b, owner, res.spawned)) {
            expect(c >= 0 && c < GRID_COLS).toBe(true);
            expect(r >= ZONE_ROWS[def.zone].from && r <= ZONE_ROWS[def.zone].to).toBe(true);
          }
        }
      }
    }
  });

  it('fills nearest cells first; ties go to the smaller column, then the smaller row', () => {
    const b = emptyBattle();
    const res = placeCard(b, rngWithCenter(5), 0, 'skeleton', 1, 5);
    // d=0: (5,11); d=1: (4,11), (5,10), (6,11); d=2: (4,10), (6,10).
    expect(relCells(b, 0, res.spawned)).toEqual([
      [5, 11],
      [4, 11],
      [5, 10],
      [6, 11],
      [4, 10],
    ]);
  });

  it('walks down one column towards the base line when only that column is free', () => {
    // The center lies in the front row of the zone, so two cells of one column never have
    // the same distance; the "smaller row" tie-break cannot trigger inside a zone.
    const b = emptyBattle();
    fill(
      b,
      0,
      GROUND,
      ['mid'],
      [
        [5, 5],
        [5, 6],
      ],
    );
    const res = placeCard(b, rngWithCenter(5), 0, 'healer', 1, 2);
    expect(relCells(b, 0, res.spawned)).toEqual([
      [5, 6],
      [5, 5],
    ]);
  });

  it('applies the tie-breaks in relative coordinates near the edges', () => {
    const b = emptyBattle();
    const res = placeCard(b, rngWithCenter(0), 0, 'skeleton', 1, 4);
    expect(relCells(b, 0, res.spawned)).toEqual([
      [0, 11],
      [0, 10],
      [1, 11],
      [1, 10],
    ]);
  });

  it('mirrors player 1 exactly for the same random sequence', () => {
    for (const card of CARD_IDS) {
      for (let seed = 0; seed < 10; seed++) {
        const b0 = emptyBattle();
        const b1 = emptyBattle();
        const rng = seedRng(seed, STREAM_PLACEMENT);
        const r0 = placeCard(b0, copyRng(rng), 0, card, 1, CARDS[card].count * 3);
        const r1 = placeCard(b1, copyRng(rng), 1, card, 1, CARDS[card].count * 3);
        const cells0 = r0.spawned.map((id) => unitById(b0, id));
        const cells1 = r1.spawned.map((id) => unitById(b1, id));
        expect(cells1.map((u) => [u?.x, u?.y])).toEqual(
          cells0.map((u) => [11 - (u?.x ?? 0), 23 - (u?.y ?? 0)]),
        );
      }
    }
  });

  it('lets a ground and an air unit share a cell', () => {
    const b = emptyBattle();
    const ground = placeCard(b, rngWithCenter(7), 0, 'healer', 1, 1);
    const air = placeCard(b, rngWithCenter(7), 0, 'bat', 1, 1);
    expect(relCells(b, 0, ground.spawned)).toEqual([[7, 7]]);
    expect(relCells(b, 0, air.spawned)).toEqual([[7, 7]]);
    expect(unitById(b, air.spawned[0] as number)?.layer).toBe(AIR);
  });

  it('only counts units of the own layer as blocking', () => {
    const b = emptyBattle();
    fill(b, 0, AIR, ['mid']);
    const res = placeCard(b, rngWithCenter(2), 0, 'assassin', 1, 3);
    expect(res.forfeited).toBe(0);
    for (const [, r] of relCells(b, 0, res.spawned)) expect(r >= 4 && r <= 7).toBe(true);
  });

  it('overflows front -> mid -> back', () => {
    const b = emptyBattle();
    fill(b, 0, GROUND, ['front']);
    const res = placeCard(b, rngWithCenter(3), 0, 'knight', 1, 1);
    expect(relCells(b, 0, res.spawned)).toEqual([[3, 7]]);

    const b2 = emptyBattle();
    fill(b2, 0, GROUND, ['front', 'mid']);
    const res2 = placeCard(b2, rngWithCenter(3), 0, 'knight', 1, 1);
    expect(relCells(b2, 0, res2.spawned)).toEqual([[3, 3]]);
  });

  it('overflows back -> mid -> front', () => {
    const b = emptyBattle();
    fill(b, 0, GROUND, ['back']);
    const res = placeCard(b, rngWithCenter(9), 0, 'archer', 1, 1);
    expect(relCells(b, 0, res.spawned)).toEqual([[9, 7]]);

    const b2 = emptyBattle();
    fill(b2, 0, GROUND, ['back', 'mid']);
    const res2 = placeCard(b2, rngWithCenter(9), 0, 'archer', 1, 1);
    expect(relCells(b2, 0, res2.spawned)).toEqual([[9, 11]]);
  });

  it('overflows mid -> back -> front', () => {
    const b = emptyBattle();
    fill(b, 0, GROUND, ['mid']);
    const res = placeCard(b, rngWithCenter(6), 0, 'healer', 1, 1);
    expect(relCells(b, 0, res.spawned)).toEqual([[6, 3]]);

    const b2 = emptyBattle();
    fill(b2, 0, GROUND, ['mid', 'back']);
    const res2 = placeCard(b2, rngWithCenter(6), 0, 'healer', 1, 1);
    expect(relCells(b2, 0, res2.spawned)).toEqual([[6, 11]]);
  });

  it('switches zones in the middle of a card, also for player 1', () => {
    for (const owner of [0, 1] as const) {
      const b = emptyBattle();
      fill(b, owner, GROUND, ['front'], [[0, 8]]);
      const res = placeCard(b, rngWithCenter(10), owner, 'knight', 1, 2);
      expect(relCells(b, owner, res.spawned)).toEqual([
        [0, 8],
        [10, 7],
      ]);
    }
  });

  it('forfeits units once the whole half is full on their layer', () => {
    for (const owner of [0, 1] as const) {
      const b = emptyBattle();
      fill(
        b,
        owner,
        GROUND,
        ['back', 'mid', 'front'],
        [
          [1, 1],
          [2, 5],
          [3, 9],
        ],
      );
      const unitsBefore = b.units.length;
      const res = placeCard(b, rngWithCenter(0), owner, 'skeleton', 1, 5);
      expect(res.spawned).toHaveLength(3);
      expect(res.forfeited).toBe(2);
      expect(relCells(b, owner, res.spawned)).toEqual([
        [3, 9],
        [2, 5],
        [1, 1],
      ]);
      const full = placeCard(b, rngWithCenter(0), owner, 'knight', 1, 2);
      expect(full).toEqual({ spawned: [], forfeited: 2 });
      expect(b.units.length).toBe(unitsBefore + 3);
      // The air layer is still free.
      const bats = placeCard(b, rngWithCenter(0), owner, 'bat', 1, 3);
      expect(bats.forfeited).toBe(0);
    }
  });

  it('never uses the enemy half, even when the own half is full', () => {
    const b = emptyBattle();
    const rng = seedRng(5, STREAM_PLACEMENT);
    for (let i = 0; i < 80; i++) {
      const card = CARD_IDS[i % CARD_IDS.length] as CardId;
      placeCard(b, rng, 0, card, 1, CARDS[card].count);
      placeCard(b, rng, 1, card, 1, CARDS[card].count);
    }
    for (const u of b.units) {
      if (u.owner === 0) expect(u.y < HALF_ROWS).toBe(true);
      else expect(u.y >= HALF_ROWS).toBe(true);
    }
    // Both halves are completely full on the ground layer by now.
    expect(b.units.filter((u) => u.layer === GROUND).length).toBe(2 * GRID_COLS * HALF_ROWS);
  });

  it('assigns ascending ids, the given level and level-scaled HP', () => {
    const b = emptyBattle();
    const res = placeCard(b, rngWithCenter(5), 0, 'knight', 3, 2);
    expect(res.spawned).toEqual([1, 2]);
    for (const id of res.spawned) {
      const u = unitById(b, id);
      expect(u?.level).toBe(3);
      expect(u?.maxHp).toBe(720); // 600 * 120 %
      expect(u?.owner).toBe(0);
      expect(u?.card).toBe('knight');
    }
  });

  it('draws exactly one center column per call, whatever the field looks like', () => {
    const start = seedRng(31, STREAM_PLACEMENT);
    const expected = copyRng(start);
    nextInt(expected, GRID_COLS);

    const onEmpty = copyRng(start);
    placeCard(emptyBattle(), onEmpty, 0, 'skeleton', 1, 5);
    expect(onEmpty).toEqual(expected);

    const full = emptyBattle();
    fill(full, 1, GROUND, ['back', 'mid', 'front']);
    const onFull = copyRng(start);
    placeCard(full, onFull, 1, 'skeleton', 1, 5);
    expect(onFull).toEqual(expected);

    const none = copyRng(start);
    placeCard(emptyBattle(), none, 0, 'knight', 1, 0);
    expect(none).toEqual(expected);
  });

  it('rejects a negative or fractional count', () => {
    expect(() => placeCard(emptyBattle(), seedRng(1, 3), 0, 'knight', 1, -1)).toThrow(/count/);
    expect(() => placeCard(emptyBattle(), seedRng(1, 3), 0, 'knight', 1, 1.5)).toThrow(/count/);
  });
});
