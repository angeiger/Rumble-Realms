/**
 * Army layout (D-070) and field set-up (D-053). Expected cells are derived by hand from the
 * rule in DECISIONS: ranks from the base line (assassins) to the middle (skeletons), each in
 * its own centred rows of 12; k units of a row start in column floor((12 - k) / 2).
 */
import { describe, expect, it } from 'vitest';
import { createBattle } from './battle/state.ts';
import { lcg } from './battle/testing.ts';
import { GRID_CELLS, GRID_COLS, HALF_ROWS } from './data/balance.ts';
import { CARD_IDS, CARDS, FORMATION_RANKS } from './data/cards.ts';
import { createMatch } from './match.ts';
import { absCol, absRow, layoutArmy, rebuildField } from './placement.ts';
import { seedRng } from './rng.ts';
import type { ArmyLayout } from './placement.ts';
import type { ArmyEntry, CardId, MatchState, PlayerIndex } from './types.ts';
import { AIR, GROUND } from './types.ts';

/** Builds army entries with consecutive unit ids, like applyPick does. */
function army(cards: [PlayerIndex, CardId][], firstId = 1): ArmyEntry[] {
  let id = firstId;
  return cards.map(([player, card]) => {
    const unitIds: number[] = [];
    for (let i = 0; i < CARDS[card].count; i++) unitIds.push(id++);
    return { player, card, level: 1, round: 1, double: false, unitIds };
  });
}

/** Relative [c, r] of the given unit ids (undefined if forfeited). */
function rel(layout: ArmyLayout, player: PlayerIndex, ids: readonly number[]) {
  return ids.map((id) => {
    const cell = layout.cells.find((p) => p.id === id);
    return cell === undefined ? undefined : [absCol(player, cell.x), absRow(player, cell.y)];
  });
}

/** Relative [c, r] of the units of `entry`. */
function cellsOf(layout: ArmyLayout, entry: ArmyEntry) {
  return rel(layout, entry.player, entry.unitIds);
}

/** Repeats a card `n` times. */
function times(n: number, player: PlayerIndex, card: CardId) {
  const out: [PlayerIndex, CardId][] = [];
  for (let i = 0; i < n; i++) out.push([player, card]);
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

describe('FORMATION_RANKS (D-070)', () => {
  it('lists every card exactly once', () => {
    const all = FORMATION_RANKS.flat();
    expect([...all].sort()).toEqual([...CARD_IDS].sort());
  });

  it('runs from the assassins at the base line to the skeletons in front', () => {
    expect(FORMATION_RANKS.map((rank) => rank[0])).toEqual([
      'assassin',
      'archer',
      'healer',
      'knight',
      'tnt',
      'skeleton',
    ]);
    // Flyers share the rank of the healers, on the air layer.
    expect(FORMATION_RANKS[2]).toEqual(['healer', 'bat', 'whelp']);
    expect(CARDS.bat.layer).toBe(AIR);
    expect(CARDS.whelp.layer).toBe(AIR);
    expect(CARDS.healer.layer).toBe(GROUND);
  });
});

describe('layoutArmy: centred rows by rank (D-070)', () => {
  it('centres a lone card in the base line, half a column to the left if uneven', () => {
    const cases: [CardId, number[]][] = [
      ['archer', [4, 5, 6]], // 9 free cells: starts in column 4
      ['knight', [5, 6]],
      ['musketeer', [5]],
      ['skeleton', [3, 4, 5, 6, 7]],
      ['bat', [4, 5, 6]],
      ['shroomling', [4, 5, 6, 7]],
    ];
    for (const [card, columns] of cases) {
      const a = army([[0, card]]);
      expect(cellsOf(layoutArmy(a, 0), a[0]!)).toEqual(columns.map((c) => [c, 0]));
    }
  });

  it('centres the row again when units join it', () => {
    const one = army([[0, 'assassin']]);
    expect(cellsOf(layoutArmy(one, 0), one[0]!)).toEqual([
      [4, 0],
      [5, 0],
      [6, 0],
    ]);
    const two = army([
      [0, 'assassin'],
      [0, 'assassin'],
    ]);
    const layout = layoutArmy(two, 0);
    expect(cellsOf(layout, two[0]!)).toEqual([
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
    expect(cellsOf(layout, two[1]!)).toEqual([
      [6, 0],
      [7, 0],
      [8, 0],
    ]);
  });

  it('stacks the ranks from the base line to the middle, whatever the pick order', () => {
    const a = army([
      [0, 'skeleton'],
      [0, 'knight'],
      [0, 'bat'],
      [0, 'tnt'],
      [0, 'healer'],
      [0, 'archer'],
      [0, 'assassin'],
    ]);
    const layout = layoutArmy(a, 0);
    const rowOf = (i: number) => cellsOf(layout, a[i]!).map((cell) => cell![1]);
    expect(rowOf(6)).toEqual([0, 0, 0]); // assassins
    expect(rowOf(5)).toEqual([1, 1, 1]); // archers
    expect(rowOf(4)).toEqual([2, 2]); // healers
    expect(rowOf(2)).toEqual([2, 2, 2]); // bats above the healers' row
    expect(rowOf(1)).toEqual([3, 3]); // knights
    expect(rowOf(3)).toEqual([4, 4, 4]); // TNT
    expect(rowOf(0)).toEqual([5, 5, 5, 5, 5]); // skeletons
    expect(layout.forfeited).toEqual([]);
  });

  it('gives a rank without units no row', () => {
    const a = army([
      [0, 'skeleton'],
      [0, 'archer'],
    ]);
    const layout = layoutArmy(a, 0);
    expect(cellsOf(layout, a[1]!).map((cell) => cell![1])).toEqual([0, 0, 0]);
    expect(cellsOf(layout, a[0]!).map((cell) => cell![1])).toEqual([1, 1, 1, 1, 1]);
  });

  it('lets the cards of a rank share the row, grouped by card in rank order', () => {
    // Picked: musketeer, archer, beetle, musketeer. Line-up: archers, musketeers, beetle.
    const a = army([
      [0, 'musketeer'],
      [0, 'archer'],
      [0, 'beetle'],
      [0, 'musketeer'],
    ]);
    const layout = layoutArmy(a, 0);
    // 6 units: columns 3..8.
    expect(cellsOf(layout, a[1]!)).toEqual([
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
    expect(cellsOf(layout, a[0]!)).toEqual([[6, 0]]);
    expect(cellsOf(layout, a[3]!)).toEqual([[7, 0]]);
    expect(cellsOf(layout, a[2]!)).toEqual([[8, 0]]);
  });

  it('keeps the units of one card in army order inside its group', () => {
    const a = army([
      [0, 'knight'],
      [0, 'golem'],
      [0, 'knight'],
    ]);
    const layout = layoutArmy(a, 0);
    // Knights 1, 2, 4, 5, then the golem 3: five units from column 3.
    expect(rel(layout, 0, [1, 2, 4, 5, 3])).toEqual([
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 0],
      [7, 0],
    ]);
  });

  it('fills full rows from the back and centres the rest in front of them', () => {
    const a = army([...times(5, 0, 'archer'), [0, 'knight']]); // 15 archers
    const layout = layoutArmy(a, 0);
    const ids = a.slice(0, 5).flatMap((e) => e.unitIds);
    const expected: number[][] = [];
    for (let c = 0; c < 12; c++) expected.push([c, 0]);
    expected.push([4, 1], [5, 1], [6, 1]);
    expect(rel(layout, 0, ids)).toEqual(expected);
    // The next rank starts in front of both rows.
    expect(cellsOf(layout, a[5]!)).toEqual([
      [5, 2],
      [6, 2],
    ]);
  });

  it('centres ground and air separately; a rank is as deep as its fuller layer', () => {
    const a = army([
      ...times(5, 0, 'bat'), // 15 bats: two air rows
      [0, 'healer'], // one ground row
      [0, 'whelp'],
      [0, 'knight'],
    ]);
    const layout = layoutArmy(a, 0);
    expect(cellsOf(layout, a[5]!)).toEqual([
      [5, 0],
      [6, 0],
    ]);
    const air = [...a.slice(0, 5).flatMap((e) => e.unitIds), ...a[6]!.unitIds]; // bats, then whelp
    const expected: number[][] = [];
    for (let c = 0; c < 12; c++) expected.push([c, 0]);
    expected.push([4, 1], [5, 1], [6, 1], [7, 1]);
    expect(rel(layout, 0, air)).toEqual(expected);
    expect(cellsOf(layout, a[7]!)).toEqual([
      [5, 2],
      [6, 2],
    ]);
  });

  it('mirrors player 1 exactly', () => {
    const rnd = lcg(77);
    for (let trial = 0; trial < 40; trial++) {
      const cards: [PlayerIndex, CardId][] = [];
      const n = 1 + rnd(40);
      for (let i = 0; i < n; i++) cards.push([0, CARD_IDS[rnd(CARD_IDS.length)] as CardId]);
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
      [0, 'knight'],
      [1, 'archer'],
      [0, 'bat'],
      [1, 'skeleton'],
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

  it('never puts two units on the same cell of a layer and loses no unit', () => {
    const rnd = lcg(5);
    for (let trial = 0; trial < 60; trial++) {
      const cards: [PlayerIndex, CardId][] = [];
      const n = 1 + rnd(60);
      for (let i = 0; i < n; i++) cards.push([0, CARD_IDS[rnd(CARD_IDS.length)] as CardId]);
      const a = army(cards);
      const layout = layoutArmy(a, 0);
      const seen = new Set<string>();
      for (const cell of layout.cells) {
        const entry = a.find((e) => e.unitIds.includes(cell.id))!;
        expect(cell.x >= 0 && cell.x < GRID_COLS && cell.y >= 0 && cell.y < HALF_ROWS).toBe(true);
        const key = `${CARDS[entry.card].layer}:${cell.x},${cell.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      const total = a.reduce((sum, e) => sum + e.unitIds.length, 0);
      expect(layout.cells.length + layout.forfeited.length).toBe(total);
    }
  });

  it('forfeits the units whose row would lie beyond the own half', () => {
    // 29 skeleton cards = 145 skeletons: twelve full rows, the last unit has no row.
    const a = army(times(29, 0, 'skeleton'));
    const layout = layoutArmy(a, 0);
    expect(layout.cells).toHaveLength(GRID_COLS * HALF_ROWS);
    expect(layout.forfeited).toEqual([145]);
  });

  it('forfeits whole ranks in front, even in the air, once the half is full (D-055)', () => {
    // 48 assassin cards = 144 assassins fill all twelve rows.
    const a = army([...times(48, 0, 'assassin'), [0, 'bat'], [0, 'knight']]);
    const layout = layoutArmy(a, 0);
    expect(layout.cells).toHaveLength(144);
    expect(layout.forfeited).toEqual([...a[48]!.unitIds, ...a[49]!.unitIds]);
  });

  it('is a pure function: same result, input untouched', () => {
    const a = army([
      [0, 'knight'],
      [0, 'archer'],
      [1, 'bat'],
      [0, 'healer'],
    ]);
    const copy = JSON.parse(JSON.stringify(a)) as ArmyEntry[];
    const first = layoutArmy(a, 0);
    expect(layoutArmy(a, 0)).toEqual(first);
    expect(a).toEqual(copy);
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
      [0, 'knight'],
      [1, 'bat'],
      [0, 'archer'],
      [1, 'musketeer'],
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
    expect(b.units.find((u) => u.card === 'knight')?.maxHp).toBe(
      Math.floor((CARDS.knight.hp * 12) / 10), // level 3: +20 %
    );
    expect(b.occ.filter((v) => v !== 0)).toHaveLength(b.units.length);
    expect(b.nextUnitId).toBe(10);
  });

  it('replaces whatever stood on the field before, with fresh unit state', () => {
    const s = matchWithArmy(army([[0, 'knight']]));
    rebuildField(s);
    const k = s.battle.units[0]!;
    k.hp = 1;
    k.targetId = 99;
    s.battle.units.push({ ...k, id: 50, x: 9, y: 9, tx: 9, ty: 9 });
    s.battle.occ[GROUND * GRID_CELLS + 9 * GRID_COLS + 9] = 50;
    rebuildField(s);
    expect(s.battle.units.map((u) => [u.id, u.hp, u.targetId])).toEqual([
      [1, CARDS.knight.hp, 0],
      [2, CARDS.knight.hp, 0],
    ]);
    expect(s.battle.occ[GROUND * GRID_CELLS + 9 * GRID_COLS + 9]).toBe(0);
  });

  it('keeps ids with gaps and leaves forfeited units out', () => {
    const entries = [
      ...army(times(29, 0, 'skeleton'), 10), // ids 10..154, one too many
      ...army([[1, 'bat']], 500),
      ...army([[1, 'knight']], 600),
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
    const entries = [...army([[0, 'knight']]), ...army([[1, 'knight']])];
    const s = matchWithArmy(entries);
    expect(() => rebuildField(s)).toThrow(/id 1/);
  });

  it('refuses to run once the battle has started', () => {
    const s = matchWithArmy(army([[0, 'knight']]));
    s.battle = createBattle(seedRng(1, 4));
    s.battle.started = true;
    expect(() => rebuildField(s)).toThrow(/started/);
  });
});
