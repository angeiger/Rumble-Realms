/**
 * Army layout (D-042, D-052) and field set-up (D-053). Expected cells are derived by hand
 * from the rule in DECISIONS: groups back -> mid -> front, each starting in the row after
 * the highest row of the group behind it; per unit the free cell minimising
 * (c - column)^2 + 4 * (r - start row)^2, ties smaller row, then smaller column.
 */
import { describe, expect, it } from 'vitest';
import { createBattle } from './battle/state.ts';
import { lcg } from './battle/testing.ts';
import { GRID_CELLS, GRID_COLS, HALF_ROWS } from './data/balance.ts';
import { CARD_IDS, CARDS } from './data/cards.ts';
import { createMatch } from './match.ts';
import { absCol, absRow, layoutArmy, rebuildField } from './placement.ts';
import { seedRng } from './rng.ts';
import type { ArmyLayout } from './placement.ts';
import type { ArmyEntry, CardId, MatchState, PlayerIndex } from './types.ts';
import { AIR, GROUND } from './types.ts';

/** Builds army entries with consecutive unit ids, like applyPick does. */
function army(cards: [PlayerIndex, CardId, number][], firstId = 1): ArmyEntry[] {
  let id = firstId;
  return cards.map(([player, card, column]) => {
    const unitIds: number[] = [];
    for (let i = 0; i < CARDS[card].count; i++) unitIds.push(id++);
    return { player, card, level: 1, column, round: 1, double: false, unitIds };
  });
}

/** Relative [c, r] of the given unit ids (undefined if forfeited). */
function rel(layout: ArmyLayout, player: PlayerIndex, ids: readonly number[]) {
  return ids.map((id) => {
    const cell = layout.cells.find((p) => p.id === id);
    return cell === undefined ? undefined : [absCol(player, cell.x), absRow(player, cell.y)];
  });
}

/** Relative rows used by the units of `entry`. */
function rows(layout: ArmyLayout, player: PlayerIndex, entry: ArmyEntry): number[] {
  return rel(layout, player, entry.unitIds).map((cell) => (cell === undefined ? -1 : cell[1]!));
}

/** Repeats a card `n` times (all with the same column). */
function times(n: number, player: PlayerIndex, card: CardId, column: number) {
  const out: [PlayerIndex, CardId, number][] = [];
  for (let i = 0; i < n; i++) out.push([player, card, column]);
  return out;
}

describe('coordinates', () => {
  it('maps player 0 directly and rotates player 1 by 180 degrees', () => {
    expect([absCol(0, 0), absRow(0, 0)]).toEqual([0, 0]);
    expect([absCol(0, 11), absRow(0, 11)]).toEqual([11, 11]);
    expect([absCol(1, 0), absRow(1, 0)]).toEqual([11, 23]);
    expect([absCol(1, 11), absRow(1, 11)]).toEqual([0, 12]);
    expect([absCol(1, 3), absRow(1, 5)]).toEqual([8, 18]);
  });
});

describe('layoutArmy: as far back as possible (D-042, D-052)', () => {
  it('puts a lone card of any zone onto its column in the base line', () => {
    for (const card of CARD_IDS) {
      const a = army([[0, card, 4]]);
      const layout = layoutArmy(a, 0);
      expect(rel(layout, 0, [a[0]!.unitIds[0]!])).toEqual([[4, 0]]);
      expect(layout.forfeited).toEqual([]);
    }
  });

  it('fills the base line around the column before the next row (wide before deep)', () => {
    const a = army([[0, 'skeleton', 5]]);
    // Costs: (5,0)=0, (4,0)=(6,0)=1, (3,0)=(7,0)=4 beat (5,1)=4 by the smaller row.
    expect(rel(layoutArmy(a, 0), 0, a[0]!.unitIds)).toEqual([
      [5, 0],
      [4, 0],
      [6, 0],
      [3, 0],
      [7, 0],
    ]);
  });

  it('counts a row twice as far as a column; ties go to the smaller row, then column', () => {
    const a = army(times(3, 0, 'skeleton', 0));
    const ids = a.flatMap((e) => e.unitIds);
    // Column 0: row 0 costs c^2, row 1 costs 4 + c^2, row 2 costs 16 + c^2.
    expect(rel(layoutArmy(a, 0), 0, ids)).toEqual([
      [0, 0], // 0
      [1, 0], // 1
      [2, 0], // 4 (row 0 before (0,1))
      [0, 1], // 4
      [1, 1], // 5
      [2, 1], // 8
      [3, 0], // 9
      [3, 1], // 13
      [4, 0], // 16 (row 0 before (0,2))
      [0, 2], // 16
      [1, 2], // 17
      [4, 1], // 20 (row 1 before (2,2))
      [2, 2], // 20
      [5, 0], // 25
      [3, 2], // 25
    ]);
  });

  it('applies the tie-breaks symmetrically around a center column', () => {
    const a = army([
      [0, 'skeleton', 6],
      [0, 'skeleton', 6],
    ]);
    const cells = rel(
      layoutArmy(a, 0),
      0,
      a.flatMap((e) => e.unitIds),
    );
    // 0: (6,0); 1: (5,0) (7,0); 4: (4,0) (8,0) (6,1); 5: (5,1) (7,1); 8: (4,1) (8,1).
    expect(cells).toEqual([
      [6, 0],
      [5, 0],
      [7, 0],
      [4, 0],
      [8, 0],
      [6, 1],
      [5, 1],
      [7, 1],
      [4, 1],
      [8, 1],
    ]);
  });

  it('stacks the groups back -> mid -> front from the base line', () => {
    const a = army([
      [0, 'knight', 3], // front
      [0, 'healer', 3], // mid
      [0, 'archer', 3], // back
    ]);
    const layout = layoutArmy(a, 0);
    expect(rows(layout, 0, a[2]!)).toEqual([0, 0, 0]);
    expect(rows(layout, 0, a[1]!)).toEqual([1, 1]);
    expect(rows(layout, 0, a[0]!)).toEqual([2, 2]);
  });

  it('moves earlier front and mid units forward when a back card joins', () => {
    const before = army([
      [0, 'knight', 5],
      [0, 'healer', 5],
    ]);
    const l1 = layoutArmy(before, 0);
    expect(rel(l1, 0, before[1]!.unitIds)).toEqual([
      [5, 0],
      [4, 0],
    ]);
    expect(rel(l1, 0, before[0]!.unitIds)).toEqual([
      [5, 1],
      [4, 1],
    ]);

    const after = [...before, ...army([[0, 'musketeer', 9]], 5)];
    const l2 = layoutArmy(after, 0);
    expect(rel(l2, 0, after[2]!.unitIds)).toEqual([[9, 0]]);
    expect(rel(l2, 0, after[1]!.unitIds)).toEqual([
      [5, 1],
      [4, 1],
    ]);
    expect(rel(l2, 0, after[0]!.unitIds)).toEqual([
      [5, 2],
      [4, 2],
    ]);
  });

  it('starts each group in the row after the highest row of the group behind it', () => {
    // 15 archers around column 5: rows 0 and 1 ((5,1) at cost 4 is the 6th unit).
    const a = army([...times(5, 0, 'archer', 5), [0, 'knight', 5]]);
    const layout = layoutArmy(a, 0);
    const archerRows = a.slice(0, 5).flatMap((e) => rows(layout, 0, e));
    expect(Math.max(...archerRows)).toBe(1);
    expect(rows(layout, 0, a[5]!)).toEqual([2, 2]);
  });

  it('keeps the start row if a group has no units', () => {
    const a = army([
      [0, 'archer', 0],
      [0, 'knight', 0],
    ]);
    // No mid units: the front group starts right after the back group.
    expect(rows(layoutArmy(a, 0), 0, a[1]!)).toEqual([1, 1]);
  });

  it('places the cards of a group in army order', () => {
    const skeletonFirst = army([
      [0, 'skeleton', 5],
      [0, 'knight', 5],
    ]);
    const l1 = layoutArmy(skeletonFirst, 0);
    // Row 0 keeps (2,0) and (8,0) at cost 9; row 1 offers (5,1) at 4, then (4,1) at 5.
    expect(rel(l1, 0, skeletonFirst[1]!.unitIds)).toEqual([
      [5, 1],
      [4, 1],
    ]);
    const knightFirst = army([
      [0, 'knight', 5],
      [0, 'skeleton', 5],
    ]);
    const l2 = layoutArmy(knightFirst, 0);
    expect(rel(l2, 0, knightFirst[0]!.unitIds)).toEqual([
      [5, 0],
      [4, 0],
    ]);
  });

  it('occupies ground and air separately, but shares the group borders', () => {
    const shared = army([
      [0, 'healer', 7], // mid, ground
      [0, 'bat', 7], // mid, air
    ]);
    const l1 = layoutArmy(shared, 0);
    expect(rel(l1, 0, shared[0]!.unitIds)).toEqual([
      [7, 0],
      [6, 0],
    ]);
    expect(rel(l1, 0, shared[1]!.unitIds)).toEqual([
      [7, 0],
      [6, 0],
      [8, 0],
    ]);

    // Bats in rows 0..1 push the ground front group to row 2, although row 1 is free on
    // the ground.
    const borders = army([
      [0, 'archer', 0], // back: (0,0) (1,0) (2,0)
      [0, 'bat', 0], // mid: start row 1
      [0, 'bat', 0],
      [0, 'knight', 0], // front: after the highest bat row
    ]);
    const l2 = layoutArmy(borders, 0);
    expect(rows(l2, 0, borders[0]!)).toEqual([0, 0, 0]);
    const batRows = [...rows(l2, 0, borders[1]!), ...rows(l2, 0, borders[2]!)];
    expect(Math.min(...batRows)).toBe(1);
    expect(Math.max(...batRows)).toBe(2); // 6 bats from column 0: (0,1) (1,1) (2,1) (0,2) ...
    expect(rows(l2, 0, borders[3]!)).toEqual([3, 3]);
  });

  it('mirrors player 1 exactly', () => {
    const rnd = lcg(77);
    for (let trial = 0; trial < 40; trial++) {
      const cards: [PlayerIndex, CardId, number][] = [];
      const n = 1 + rnd(40);
      for (let i = 0; i < n; i++) {
        cards.push([0, CARD_IDS[rnd(CARD_IDS.length)] as CardId, rnd(GRID_COLS)]);
      }
      const a0 = army(cards);
      const a1 = a0.map((e) => ({ ...e, player: 1 as PlayerIndex }));
      const l0 = layoutArmy(a0, 0);
      const l1 = layoutArmy(a1, 1);
      expect(l1.forfeited).toEqual(l0.forfeited);
      expect(l1.cells).toEqual(l0.cells.map((c) => ({ id: c.id, x: 11 - c.x, y: 23 - c.y })));
    }
  });

  it('only sets up the given player and stays in that half', () => {
    const a = army([
      [0, 'knight', 2],
      [1, 'archer', 2],
      [0, 'bat', 9],
      [1, 'skeleton', 9],
    ]);
    for (const player of [0, 1] as const) {
      const layout = layoutArmy(a, player);
      const own = a.filter((e) => e.player === player).flatMap((e) => e.unitIds);
      expect(layout.cells.map((c) => c.id)).toEqual(own);
      for (const c of layout.cells) {
        expect(player === 0 ? c.y < HALF_ROWS : c.y >= HALF_ROWS).toBe(true);
      }
    }
  });

  it('never puts two units on the same cell of a layer', () => {
    const a = army([...times(10, 0, 'skeleton', 3), ...times(8, 0, 'bat', 3)]);
    const layout = layoutArmy(a, 0);
    const seen = new Set<string>();
    for (const cell of layout.cells) {
      const entry = a.find((e) => e.unitIds.includes(cell.id))!;
      const key = `${CARDS[entry.card].layer}:${cell.x},${cell.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('forfeits units once there is no free cell left on their layer', () => {
    // 29 skeleton cards = 145 ground units for 144 cells: the last one is forfeited.
    const a = army(times(29, 0, 'skeleton', 4));
    const layout = layoutArmy(a, 0);
    expect(layout.cells).toHaveLength(GRID_COLS * HALF_ROWS);
    expect(layout.forfeited).toEqual([145]);
  });

  it('forfeits later groups, even in the air, once a group reached the last row', () => {
    // 44 archer cards + 1 musketeer = 133 back units: rows 0..10 full, one unit in row 11.
    const a = army([
      ...times(44, 0, 'archer', 6),
      [0, 'musketeer', 6],
      [0, 'bat', 6],
      [0, 'knight', 6],
    ]);
    const layout = layoutArmy(a, 0);
    const musketeer = a[44]!;
    expect(rows(layout, 0, musketeer)).toEqual([11]);
    const bats = a[45]!.unitIds;
    const knights = a[46]!.unitIds;
    expect(layout.forfeited).toEqual([...bats, ...knights]);
  });

  it('is a pure function: same result, input untouched', () => {
    const a = army([
      [0, 'knight', 1],
      [0, 'archer', 8],
      [1, 'bat', 3],
      [0, 'healer', 11],
    ]);
    const copy = JSON.parse(JSON.stringify(a)) as ArmyEntry[];
    const first = layoutArmy(a, 0);
    expect(layoutArmy(a, 0)).toEqual(first);
    expect(a).toEqual(copy);
  });

  it('rejects an invalid column', () => {
    for (const column of [-1, 12, 1.5]) {
      expect(() => layoutArmy(army([[0, 'knight', column]]), 0)).toThrow(/column/);
    }
  });
});

describe('rebuildField (D-053)', () => {
  function matchWithArmy(entries: ArmyEntry[]): MatchState {
    const s = createMatch({
      seed: 3,
      players: [
        { deck: ['archer', 'knight', 'tnt', 'skeleton'], levels: {} },
        { deck: ['healer', 'musketeer', 'bat', 'assassin'], levels: {} },
      ],
    });
    s.army = entries;
    s.nextUnitId = 1 + entries.reduce((n, e) => n + e.unitIds.length, 0);
    return s;
  }

  it('spawns every army unit with its id, level and full HP on its layout cell', () => {
    const entries = army([
      [0, 'knight', 2],
      [1, 'bat', 5],
      [0, 'archer', 7],
      [1, 'musketeer', 0],
    ]);
    entries[0]!.level = 3;
    const s = matchWithArmy(entries);
    expect(rebuildField(s)).toEqual([]);
    const b = s.battle;
    expect(b.units.map((u) => u.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const layouts = [layoutArmy(entries, 0), layoutArmy(entries, 1)];
    for (const u of b.units) {
      const entry = entries.find((e) => e.unitIds.includes(u.id))!;
      expect(u.owner).toBe(entry.player);
      expect(u.card).toBe(entry.card);
      expect(u.level).toBe(entry.level);
      expect(u.hp).toBe(u.maxHp);
      const cell = layouts[u.owner]!.cells.find((c) => c.id === u.id)!;
      expect([u.x, u.y, u.tx, u.ty]).toEqual([cell.x, cell.y, cell.x, cell.y]);
      expect(b.occ[u.layer * GRID_CELLS + u.y * GRID_COLS + u.x]).toBe(u.id);
    }
    expect(b.units.find((u) => u.card === 'knight')?.maxHp).toBe(720);
    expect(b.occ.filter((v) => v !== 0)).toHaveLength(b.units.length);
    expect(b.nextUnitId).toBe(10);
  });

  it('replaces whatever stood on the field before, with fresh unit state', () => {
    const s = matchWithArmy(army([[0, 'knight', 2]]));
    rebuildField(s);
    const k = s.battle.units[0]!;
    k.hp = 1;
    k.targetId = 99;
    s.battle.units.push({ ...k, id: 50, x: 9, y: 9, tx: 9, ty: 9 });
    s.battle.occ[GROUND * GRID_CELLS + 9 * GRID_COLS + 9] = 50;
    rebuildField(s);
    expect(s.battle.units.map((u) => [u.id, u.hp, u.targetId])).toEqual([
      [1, 600, 0],
      [2, 600, 0],
    ]);
    expect(s.battle.occ[GROUND * GRID_CELLS + 9 * GRID_COLS + 9]).toBe(0);
  });

  it('keeps ids with gaps and leaves forfeited units out', () => {
    const entries = [
      ...army(times(29, 0, 'skeleton', 4), 10), // ids 10..154, one too many
      ...army([[1, 'bat', 4]], 500),
      ...army([[1, 'knight', 4]], 600),
    ];
    const s = matchWithArmy(entries);
    s.nextUnitId = 700;
    expect(rebuildField(s)).toEqual([154]);
    const ids = s.battle.units.map((u) => u.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(ids).not.toContain(154);
    expect(ids.slice(-5)).toEqual([500, 501, 502, 600, 601]);
    expect(s.battle.units.filter((u) => u.layer === AIR)).toHaveLength(3);
    expect(s.battle.nextUnitId).toBe(700);
  });

  it('rejects an army that uses an id twice', () => {
    const entries = [...army([[0, 'knight', 2]]), ...army([[1, 'knight', 2]])];
    const s = matchWithArmy(entries);
    expect(() => rebuildField(s)).toThrow(/id 1/);
  });

  it('refuses to run once the battle has started', () => {
    const s = matchWithArmy(army([[0, 'knight', 2]]));
    s.battle = createBattle(seedRng(1, 4));
    s.battle.started = true;
    expect(() => rebuildField(s)).toThrow(/started/);
  });
});
