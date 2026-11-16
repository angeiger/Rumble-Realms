/**
 * The six units added in M3b (SPEC 5.2, 5.3): pyromancer, necromancer, beetle, golem, frost
 * shaman, whelp. Rule values are written out on purpose instead of imported.
 */
import { describe, expect, it } from 'vitest';
import { CARDS } from '../data/cards.ts';
import type { BattleState, CardId, UnitState } from '../types.ts';
import { AIR, GROUND } from '../types.ts';
import { applyStun } from './status.ts';
import { attackTicks, dummy, eventsOf, field, put, run, type TickLog } from './testing.ts';

/** Damage of a level 1 attack of `card`, from the card data (a balance round changes it). */
function hitOf(card: CardId): number {
  const a = CARDS[card].attack;
  if (!('damage' in a)) throw new Error(`${card} has no damage`);
  return a.damage;
}

/** Level scaling of SPEC 6.3: +10 % per level, rounded down. */
function atLevel(base: number, level: number): number {
  return Math.floor((base * (9 + level)) / 10);
}

/** A punching bag that neither moves nor attacks. */
function post(
  b: BattleState,
  owner: 0 | 1,
  card: 'knight' | 'bat' | 'archer',
  x: number,
  y: number,
) {
  const u = dummy(b, owner, card, x, y);
  applyStun(u, 100_000, 0);
  return u;
}

function hitsOn(log: TickLog[], unit: UnitState): number[] {
  return eventsOf(log, 'damage')
    .filter((e) => e.unit === unit.id)
    .map((e) => e.amount);
}

describe('Pyromantin', () => {
  it('hits every enemy within r 1 of the target cell on impact, ground and air', () => {
    const b = field();
    const pyro = put(b, 0, 'pyromancer', 5, 5);
    const target = post(b, 1, 'knight', 5, 9); // distSq 16 = range 4
    const left = post(b, 1, 'knight', 4, 9);
    const behind = post(b, 1, 'knight', 5, 10);
    const diagonal = post(b, 1, 'knight', 6, 10); // outside r 1 (D-022)
    const bat = post(b, 1, 'bat', 6, 9);
    const log = run(b, 9);
    const shots = eventsOf(log, 'shot');
    expect(shots[0]).toMatchObject({ tick: 0, unit: pyro.id, target: target.id, impactTick: 8 });
    // 4 fields at 10 fields/s = 8 ticks of flight.
    expect(eventsOf(log, 'impact')).toEqual([
      { type: 'impact', kind: 'splash', unit: pyro.id, x: 5, y: 9, radius: 1000, tick: 8 },
    ]);
    for (const u of [target, left, behind, bat])
      expect(hitsOn(log, u)).toEqual([hitOf('pyromancer')]);
    expect(hitsOn(log, diagonal)).toEqual([]);
  });

  it('fizzles completely when the main target is dead on impact', () => {
    const b = field();
    put(b, 0, 'pyromancer', 5, 5);
    const target = post(b, 1, 'knight', 5, 9);
    const left = post(b, 1, 'knight', 4, 9);
    run(b, 1);
    target.hp = 0; // dies at the end of tick 1
    const log = run(b, 10);
    expect(eventsOf(log, 'impact')).toEqual([]);
    expect(hitsOn(log, left)).toEqual([]);
  });

  it('attacks every 1.8 s', () => {
    const b = field();
    const pyro = put(b, 0, 'pyromancer', 5, 5);
    post(b, 1, 'knight', 5, 8);
    expect(attackTicks(run(b, 80), pyro.id)).toEqual([0, 36, 72]);
  });
});

describe('Nekromant', () => {
  it('summons a skeleton of its level every 4 s on the nearest free neighbouring cell', () => {
    const b = field();
    const necro = put(b, 0, 'necromancer', 5, 5, { level: 3, maxHp: 1_000_000 });
    // In range of the necromancer, in the air: the skeletons have nobody to walk to.
    post(b, 1, 'bat', 5, 8);
    const log = run(b, 81);
    const summons = eventsOf(log, 'summon');
    expect(summons).toHaveLength(1);
    const first = summons[0]!;
    // Straight ahead first (towards the enemy for player 0).
    expect(first).toMatchObject({ tick: 80, summoner: necro.id, card: 'skeleton', x: 5, y: 6 });
    const skeleton = b.units.find((u) => u.id === first.unit)!;
    expect(skeleton.id).toBeGreaterThan(necro.id);
    expect(b.units[b.units.length - 1]).toBe(skeleton);
    expect([skeleton.owner, skeleton.level, skeleton.maxHp, skeleton.layer]).toEqual([
      0,
      3,
      // 30 % of the hit points of a card skeleton of level 3 (D-077).
      Math.floor((atLevel(CARDS.skeleton.hp, 3) * 3000) / 10000),
      GROUND,
    ]);
    expect(skeleton.summonerId).toBe(necro.id);
    expect(necro.summonTick).toBe(160);
  });

  it('keeps at most 4 summons alive and replaces fallen ones', () => {
    const b = field();
    const necro = put(b, 0, 'necromancer', 5, 5, { maxHp: 1_000_000 });
    post(b, 1, 'bat', 5, 8);
    run(b, 80 * 6 + 1);
    const mine = () => b.units.filter((u) => u.summonerId === necro.id);
    expect(mine()).toHaveLength(4);
    const cells = mine()
      .map((u) => `${u.x},${u.y}`)
      .sort();
    expect(cells).toEqual(['4,5', '5,4', '5,6', '6,5']); // the four straight neighbours
    // One falls: the next summon replaces it on the freed cell.
    const fallen = mine()[0]!;
    fallen.hp = 0;
    const log = run(b, 80);
    const summons = eventsOf(log, 'summon');
    expect(summons).toHaveLength(1);
    expect([summons[0]!.x, summons[0]!.y]).toEqual([fallen.x, fallen.y]);
    expect(mine()).toHaveLength(4);
  });

  // D-077: a summoned skeleton has 30 % of the hit points and 75 % of the damage of a skeleton
  // of the card. Both are applied on top of the level scaling.
  describe('summoned skeletons (D-077)', () => {
    const summonedHp = (level: number) =>
      Math.floor((atLevel(CARDS.skeleton.hp, level) * 3000) / 10000);
    const summonedHit = (level: number) =>
      Math.floor((atLevel(hitOf('skeleton'), level) * 7500) / 10000);

    /** A necromancer whose bat target is nearer than the knight that its skeleton will hit. */
    function setup(level: number) {
      const b = field();
      put(b, 0, 'necromancer', 5, 5, { level, maxHp: 1_000_000 });
      post(b, 1, 'bat', 4, 5); // nearest enemy of the necromancer: it keeps off the knight
      const knight = post(b, 1, 'knight', 5, 7); // next to the first summon cell (5, 6)
      run(b, 80);
      const log = run(b, 5); // the summon appears in tick 80
      const [summon] = eventsOf(log, 'summon');
      const skeleton = b.units.find((u) => u.id === summon!.unit)!;
      return { b, log, skeleton, knight };
    }

    it.each([1, 3, 5])('has 30 %% of the HP and 75 %% of the damage at level %i', (level) => {
      const { log, skeleton, knight } = setup(level);
      expect(skeleton.card).toBe('skeleton');
      expect(skeleton.maxHp).toBe(summonedHp(level));
      expect(skeleton.hp).toBe(skeleton.maxHp);
      expect(skeleton.powerBps).toBe(7500);
      const hits = hitsOn(log, knight);
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) expect(hit).toBe(summonedHit(level));
    });

    it('is about 63 HP and 20 damage at level 1, as before the balance round', () => {
      expect(summonedHp(1)).toBe(63);
      expect(summonedHit(1)).toBe(20);
    });

    it('leaves skeletons of the card unchanged', () => {
      for (const level of [1, 3, 5]) {
        const b = field();
        const card = put(b, 0, 'skeleton', 5, 5, { level });
        expect(card.maxHp).toBe(atLevel(CARDS.skeleton.hp, level));
        expect(card.powerBps).toBe(10000);
        const target = post(b, 1, 'knight', 5, 6);
        const log = run(b, 3);
        for (const hit of hitsOn(log, target)) expect(hit).toBe(atLevel(hitOf('skeleton'), level));
        expect(hitsOn(log, target).length).toBeGreaterThan(0);
      }
    });
  });

  it('also attacks itself: 25 damage every 1.2 s at range 3', () => {
    const b = field();
    const necro = put(b, 0, 'necromancer', 5, 5);
    const target = post(b, 1, 'knight', 5, 8);
    const log = run(b, 60);
    expect(attackTicks(log, necro.id)).toEqual([0, 24, 48]);
    expect(hitsOn(log, target)).toEqual([25, 25, 25]);
  });

  it('summons nothing while every neighbouring cell is taken', () => {
    const b = field();
    put(b, 0, 'necromancer', 5, 5, { maxHp: 1_000_000 });
    for (const [x, y] of [
      [4, 4],
      [5, 4],
      [6, 4],
      [4, 5],
      [6, 5],
      [4, 6],
      [5, 6],
      [6, 6],
    ] as const) {
      applyStun(put(b, 0, 'knight', x, y), 100_000, 0);
    }
    post(b, 1, 'bat', 5, 8);
    const log = run(b, 100);
    expect(eventsOf(log, 'summon')).toEqual([]);
  });
});

describe('Bombardierkäfer', () => {
  it('lobs at the cell of the nearest ground enemy and hits all ground enemies within r 1', () => {
    const b = field();
    const beetle = put(b, 0, 'beetle', 5, 2);
    const target = post(b, 1, 'knight', 5, 10);
    const side = post(b, 1, 'knight', 4, 10);
    const diagonal = post(b, 1, 'knight', 6, 11); // outside r 1 (D-022)
    const outside = post(b, 1, 'knight', 7, 10);
    const bat = post(b, 1, 'bat', 5, 10); // air: not attackable for the beetle
    const log = run(b, 31);
    expect(eventsOf(log, 'lob')).toEqual([
      { type: 'lob', id: 1, unit: beetle.id, x: 5, y: 10, impactTick: 30, tick: 0 },
    ]);
    expect(eventsOf(log, 'impact')).toEqual([
      { type: 'impact', kind: 'shell', unit: beetle.id, x: 5, y: 10, radius: 1000, tick: 30 },
    ]);
    expect(hitsOn(log, target)).toEqual([hitOf('beetle')]);
    expect(hitsOn(log, side)).toEqual([hitOf('beetle')]);
    expect(hitsOn(log, diagonal)).toEqual([]);
    expect(hitsOn(log, outside)).toEqual([]);
    expect(hitsOn(log, bat)).toEqual([]);
  });

  it('reaches the whole field, fires every 6 s and does not move while it has a target', () => {
    const b = field();
    const beetle = put(b, 0, 'beetle', 0, 0);
    post(b, 1, 'knight', 11, 23);
    const log = run(b, 241);
    expect(attackTicks(log, beetle.id)).toEqual([0, 120, 240]);
    expect([beetle.x, beetle.y, beetle.moveCost]).toEqual([0, 0, 0]);
  });

  it('ignores enemies closer than 2 fields and does not attack without another target', () => {
    const b = field();
    const beetle = put(b, 0, 'beetle', 5, 5, { maxHp: 1_000_000 });
    post(b, 1, 'knight', 6, 6); // distSq 2 < 4
    const log = run(b, 60);
    expect(beetle.targetId).toBe(0);
    expect(attackTicks(log, beetle.id)).toEqual([]);
    expect([beetle.x, beetle.y]).toEqual([5, 5]);

    const c = field();
    const other = put(c, 0, 'beetle', 5, 5);
    post(c, 1, 'knight', 5, 6);
    const far = post(c, 1, 'knight', 5, 7); // distSq 4: just far enough
    run(c, 1);
    expect(other.targetId).toBe(far.id);
  });

  it('a moving target can dodge the shell', () => {
    const b = field();
    put(b, 0, 'beetle', 5, 2);
    // Skeletons need about 11 ticks per field: two fields away when the shell lands.
    const runner = dummy(b, 1, 'skeleton', 5, 14);
    const log = run(b, 31);
    expect(eventsOf(log, 'lob')[0]).toMatchObject({ x: 5, y: 14 });
    expect(runner.y).toBe(12);
    expect(hitsOn(log, runner)).toEqual([]);
  });
});

describe('Steingolem', () => {
  it('is a slow melee tank: 90 damage every 2 s, 0.5 fields/s', () => {
    const b = field();
    const golem = put(b, 0, 'golem', 5, 10);
    const enemy = post(b, 1, 'knight', 5, 11);
    const log = run(b, 81);
    expect(attackTicks(log, golem.id)).toEqual([0, 40, 80]);
    expect(hitsOn(log, enemy)).toEqual([90, 90, 90]);
    expect([golem.maxHp, golem.speed]).toEqual([1600, 25]);

    const c = field();
    const walker = put(c, 0, 'golem', 5, 2);
    post(c, 1, 'knight', 5, 20);
    run(c, 40); // 1000 milli-fields at 25 per tick
    expect([walker.x, walker.y]).toEqual([5, 3]);
  });
});

describe('Frostschamane', () => {
  it('slows movement and attack speed of the target by 30 % for 2 s from impact', () => {
    const b = field();
    put(b, 0, 'frost_shaman', 5, 5);
    const knight = dummy(b, 1, 'knight', 5, 10); // walks towards the shaman
    const log = run(b, 11);
    // 5 fields at 10 fields/s: impact in tick 10.
    expect(hitsOn(log, knight)).toEqual([hitOf('frost_shaman')]);
    expect([knight.slowBps, knight.slowUntil]).toEqual([3000, 50]);
    // Ticks 0..9 at 40, tick 10 at 28.
    expect(knight.moveProgress).toBe(428);
  });

  it('renews the slow with every hit instead of stacking it', () => {
    const b = field();
    put(b, 0, 'frost_shaman', 5, 5);
    const target = post(b, 1, 'knight', 5, 8);
    run(b, 7); // impact in tick 6 (3 fields)
    expect([target.slowBps, target.slowUntil]).toEqual([3000, 46]);
    run(b, 30); // second shot in tick 24 (every 1.2 s), impact in tick 30
    expect([target.slowBps, target.slowUntil]).toEqual([3000, 70]);
  });
});

describe('Drachenjunges', () => {
  it('flies and can only be attacked by ranged units', () => {
    const b = field();
    const whelp = put(b, 0, 'whelp', 5, 10);
    expect(whelp.layer).toBe(AIR);
    const knight = put(b, 1, 'knight', 5, 12);
    const archer = put(b, 1, 'archer', 3, 14);
    run(b, 1);
    expect(knight.targetId).toBe(0);
    expect(archer.targetId).toBe(whelp.id);
  });

  it('hits ground and air enemies within r 1 of its target at range 2', () => {
    const b = field();
    const whelp = put(b, 0, 'whelp', 5, 8);
    const target = post(b, 1, 'knight', 5, 10);
    const side = post(b, 1, 'archer', 4, 10);
    const bat = post(b, 1, 'bat', 5, 11);
    const log = run(b, 5);
    expect(attackTicks(log, whelp.id)).toEqual([0]);
    // 2 fields at 12 fields/s: 4 ticks.
    expect(eventsOf(log, 'impact')).toEqual([
      { type: 'impact', kind: 'splash', unit: whelp.id, x: 5, y: 10, radius: 1000, tick: 4 },
    ]);
    for (const u of [target, side, bat]) expect(hitsOn(log, u)).toEqual([hitOf('whelp')]);
  });
});
