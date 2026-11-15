/**
 * Upgrades with an effect in the simulation (SPEC 5.4), M3b-2. Rule values are written out on
 * purpose instead of imported. Bit i of a mask is upgrade i of the card (data/upgrades.ts).
 */
import { describe, expect, it } from 'vitest';
import { createMatch } from '../match.ts';
import { rebuildField } from '../placement.ts';
import type { BattleState, CardId, MatchState, PlayerIndex, UnitState } from '../types.ts';
import { AIR } from '../types.ts';
import { unitCount } from '../upgrades.ts';
import { makeGiant } from './state.ts';
import { applyStun } from './status.ts';
import {
  busyCorner,
  dummy,
  eventsOf,
  field,
  put,
  run,
  type PutOptions,
  type TickLog,
} from './testing.ts';

/** Spawns a unit with the upgrade mask `mask` of its card. */
function up(
  b: BattleState,
  owner: PlayerIndex,
  card: CardId,
  mask: number,
  x: number,
  y: number,
  options: PutOptions = {},
): UnitState {
  b.upgrades[owner][card] = mask;
  return put(b, owner, card, x, y, options);
}

/** A punching bag that neither moves nor attacks. */
function post(b: BattleState, owner: PlayerIndex, card: CardId, x: number, y: number): UnitState {
  const u = dummy(b, owner, card, x, y);
  applyStun(u, 100_000, 0);
  return u;
}

function hitsOn(log: TickLog[], unit: UnitState): number[] {
  return eventsOf(log, 'damage')
    .filter((e) => e.unit === unit.id)
    .map((e) => e.amount);
}

/** Skips the battle start, so that assassins do not jump (D-049). */
function noJump(b: BattleState): void {
  b.started = true;
}

describe('Bogenschütze: Feuerpfeile', () => {
  it('sets the target on fire for 3 s with 8 damage per second', () => {
    const b = field();
    busyCorner(b); // keeps player 0 in the game after the archer is gone
    const archer = up(b, 0, 'archer', 1, 5, 5);
    const target = post(b, 1, 'knight', 5, 9);
    run(b, 1); // shot at tick 0, 4 fields at 12 fields/s = 7 ticks
    archer.hp = 0; // dies at the end of tick 1; the arrow still lands
    const log = run(b, 7);
    expect(hitsOn(log, target)).toEqual([30]);
    expect(target).toMatchObject({ burnDps: 8, burnStart: 7, burnUntil: 67 });
    const rest = run(b, 70);
    expect(hitsOn(rest, target).reduce((a, n) => a + n, 0)).toBe(24);
  });

  it('does nothing without the upgrade', () => {
    const b = field();
    put(b, 0, 'archer', 5, 5);
    const target = post(b, 1, 'knight', 5, 9);
    run(b, 8);
    expect(target.burnUntil).toBe(0);
  });
});

describe('Pyromantin: Inferno and Hitzeschild', () => {
  it('Inferno: every unit hit by the blast burns, rate scaled by level', () => {
    const b = field();
    up(b, 0, 'pyromancer', 1, 5, 5, { level: 3 });
    const target = post(b, 1, 'knight', 5, 9);
    const left = post(b, 1, 'knight', 4, 9);
    run(b, 9); // impact at tick 8
    for (const u of [target, left]) {
      expect(u).toMatchObject({ burnDps: 18, burnStart: 8, burnUntil: 68 });
    }
  });

  it('Hitzeschild: the first two hits against her are ignored', () => {
    const b = field();
    const pyro = up(b, 0, 'pyromancer', 4, 5, 5, { maxHp: 1_000_000 });
    dummy(b, 1, 'knight', 5, 6); // hits at 0, 24, 48
    const log = run(b, 50);
    expect(hitsOn(log, pyro)).toEqual([0, 0, 60]);
    expect(pyro.ignoreHits).toBe(0);
  });
});

describe('Assassine: Gift', () => {
  it('poisons on every hit for 4 s with 12 damage per second, renewed', () => {
    const b = field();
    noJump(b);
    up(b, 0, 'assassin', 1, 5, 5);
    const target = post(b, 1, 'knight', 5, 6);
    run(b, 1);
    expect(target).toMatchObject({ poisonDps: 12, poisonStart: 0, poisonUntil: 80 });
    run(b, 18); // second hit at tick 18
    expect(target).toMatchObject({ poisonStart: 18, poisonUntil: 98 });
  });
});

describe('Fledermäuse', () => {
  it('Ultraschall: hits slow the attack speed by 25 % for 2 s', () => {
    const b = field();
    up(b, 0, 'bat', 4, 5, 5);
    const target = post(b, 1, 'knight', 5, 6);
    run(b, 1);
    expect(target).toMatchObject({ atkSlowBps: 2500, atkSlowUntil: 40, slowUntil: 0 });
  });

  it('Blutdurst: 40 % lifesteal', () => {
    const b = field();
    const bat = up(b, 0, 'bat', 1, 5, 5, { hp: 30 });
    post(b, 1, 'knight', 5, 6);
    run(b, 1);
    expect(bat.hp).toBe(30 + 8); // floor(22 * 40 %)
  });

  it('combines all three upgrades (mask 7)', () => {
    expect(unitCount('bat', 7, false)).toBe(5);
    const b = field();
    const bat = up(b, 0, 'bat', 7, 5, 5, { hp: 30 });
    const target = post(b, 1, 'knight', 5, 6);
    run(b, 1);
    expect(bat.hp).toBe(38);
    expect(target.atkSlowBps).toBe(2500);
  });
});

describe('Frostschamane', () => {
  it('Eisblock: every 4th hit freezes the target for 1 s', () => {
    const b = field();
    up(b, 0, 'frost_shaman', 1, 5, 5, { maxHp: 1_000_000 });
    const knight = dummy(b, 1, 'knight', 5, 9);
    let hits = 0;
    let frozenAt = -1;
    for (let i = 0; i < 200 && frozenAt < 0; i++) {
      const log = run(b, 1);
      hits += hitsOn(log, knight).length;
      if (knight.stunUntil > 0) frozenAt = log[0]!.tick;
    }
    expect(hits).toBe(4);
    expect(knight.stunUntil).toBe(frozenAt + 20);
  });

  it('Eisrüstung: melee attackers are slowed by 30 % for 2 s', () => {
    const b = field();
    up(b, 0, 'frost_shaman', 4, 5, 5, { maxHp: 1_000_000 });
    const knight = dummy(b, 1, 'knight', 5, 6);
    run(b, 1); // the knight hits at tick 0; the shaman's own shot lands later
    expect(knight).toMatchObject({ slowBps: 3000, slowUntil: 40 });
  });

  it('without Eisrüstung the attacker is not slowed in tick 0', () => {
    const b = field();
    put(b, 0, 'frost_shaman', 5, 5, { maxHp: 1_000_000 });
    const knight = dummy(b, 1, 'knight', 5, 6);
    run(b, 1);
    expect(knight.slowUntil).toBe(0);
  });
});

describe('Bombardierkäfer: Chitinpanzer', () => {
  it('+60 % HP and 15 damage back to melee attackers', () => {
    const b = field();
    const plain = put(b, 1, 'beetle', 0, 23);
    const beetle = up(b, 0, 'beetle', 4, 5, 5);
    expect(beetle.maxHp).toBe((plain.maxHp * 16) / 10);
    const knight = dummy(b, 1, 'knight', 5, 6);
    run(b, 1);
    expect(knight.hp).toBe(1_000_000 - 15);
  });
});

describe('Ritter: Schild', () => {
  it('absorbs the first 250 damage, scaled by level', () => {
    const b = field();
    const knight = up(b, 0, 'knight', 1, 5, 5);
    expect(knight.shield).toBe(250);
    put(b, 1, 'knight', 5, 6);
    run(b, 1);
    expect(knight).toMatchObject({ shield: 190, hp: 600 });
    const b2 = field();
    expect(up(b2, 0, 'knight', 1, 5, 5, { level: 2 }).shield).toBe(275);
  });
});

describe('Musketier: Kopfschuss', () => {
  it('the first shot of the round deals three times the damage', () => {
    const b = field();
    up(b, 0, 'musketeer', 2, 5, 5);
    const target = post(b, 1, 'knight', 5, 9);
    expect(hitsOn(run(b, 60), target)).toEqual([420, 140]);
  });
});

describe('Berserker', () => {
  it('Blutrausch: a kill heals 15 % of max HP', () => {
    const b = field();
    const berserker = up(b, 0, 'berserker', 4, 5, 5, { hp: 100 });
    post(b, 1, 'knight', 5, 6).hp = 10;
    run(b, 1);
    expect(berserker.hp).toBe(100 + 2 + 135); // 25 % rage lifesteal of 10, then 15 % of 900
  });

  it('Unbändig: below 20 % HP 2 s invulnerable, once per round', () => {
    const b = field();
    const berserker = up(b, 0, 'berserker', 1, 5, 5, { hp: 200 });
    dummy(b, 1, 'knight', 5, 6);
    const first = run(b, 1);
    expect(hitsOn(first, berserker)).toEqual([60]);
    expect(berserker).toMatchObject({ invulnUntil: 40, unstoppableLeft: 0 });
    expect(hitsOn(run(b, 39), berserker)).toEqual([]); // the hit at tick 24 is ignored
    expect(hitsOn(run(b, 10), berserker)).toEqual([60]); // tick 48
  });

  it('Unbändig: a lethal hit still kills', () => {
    const b = field();
    // 10 + 17 lifesteal of its own hit, then the knight's 60 kill it outright.
    const berserker = up(b, 0, 'berserker', 1, 5, 5, { hp: 10 });
    dummy(b, 1, 'knight', 5, 6);
    run(b, 1);
    expect(b.units.some((u) => u.id === berserker.id)).toBe(false);
  });

  it('Wirbelwind: every 3rd attack hits all adjacent enemies', () => {
    const b = field();
    up(b, 0, 'berserker', 2, 5, 5, { maxHp: 1_000_000 });
    const front = post(b, 1, 'knight', 5, 6);
    const side = post(b, 1, 'knight', 6, 6);
    const far = post(b, 1, 'knight', 5, 7);
    const log = run(b, 60); // attacks at 0, 28, 56
    expect(hitsOn(log, front)).toEqual([70, 70, 70]);
    expect(hitsOn(log, side)).toEqual([70]);
    expect(hitsOn(log, far)).toEqual([]);
  });

  it('combines all three upgrades (mask 7)', () => {
    const b = field();
    const berserker = up(b, 0, 'berserker', 7, 5, 5, { hp: 200 });
    put(b, 1, 'knight', 5, 6, { hp: 10 });
    const side = dummy(b, 1, 'knight', 6, 6);
    // Kill: 200 + 2 + 135; then both knights hit for 60 (the fatally hit one still acts).
    run(b, 1);
    expect(berserker.hp).toBe(217);
    expect(berserker.unstoppableLeft).toBe(1);
    berserker.hp = 200;
    run(b, 24); // side knight hits at tick 24: 140 < 180 -> invulnerable
    expect(berserker.invulnUntil).toBe(24 + 40);
    expect(side.hp).toBeLessThan(1_000_000);
  });
});

describe('Heiler', () => {
  it('Segen: healed allies deal 20 % more damage for 3 s', () => {
    const b = field();
    busyCorner(b);
    up(b, 0, 'healer', 4, 5, 5);
    const ally = post(b, 0, 'knight', 5, 7);
    ally.hp = 500_000;
    run(b, 1);
    expect(ally).toMatchObject({ hp: 500_040, dmgBonusBps: 2000, dmgBonusUntil: 60 });
  });

  it('Heilkreis: allies within r 2 of the target get 60 % of the healing', () => {
    const b = field();
    busyCorner(b);
    up(b, 0, 'healer', 1, 5, 5);
    const target = put(b, 0, 'knight', 5, 7, { hp: 100 });
    const near = put(b, 0, 'knight', 5, 9, { hp: 100 }); // 2 fields from the target
    const diagonal = put(b, 0, 'knight', 7, 9, { hp: 100 }); // outside r 2
    for (const u of [target, near, diagonal]) applyStun(u, 1000, 0);
    run(b, 1);
    expect([target.hp, near.hp, diagonal.hp]).toEqual([140, 124, 100]);
  });

  it('combines Heilkreis and Segen', () => {
    const b = field();
    busyCorner(b);
    up(b, 0, 'healer', 5, 5, 5);
    const target = put(b, 0, 'knight', 5, 7, { hp: 100 });
    const near = put(b, 0, 'knight', 6, 8, { hp: 100 });
    for (const u of [target, near]) applyStun(u, 1000, 0);
    run(b, 1);
    expect(near).toMatchObject({ hp: 124, dmgBonusBps: 2000 });
  });
});

describe('Ritter: Ansturm', () => {
  it('the first hit after moving deals double damage and stuns for 0.5 s', () => {
    const b = field();
    up(b, 0, 'knight', 2, 5, 5);
    const target = dummy(b, 1, 'knight', 5, 9); // both walk towards each other
    const hits: number[] = [];
    let firstHit = -1;
    for (let i = 0; i < 150; i++) {
      const log = run(b, 1);
      const now = hitsOn(log, target);
      if (now.length > 0 && firstHit < 0) {
        firstHit = log[0]!.tick;
        expect(target.stunUntil).toBe(firstHit + 10);
      }
      hits.push(...now);
    }
    expect(firstHit).toBeGreaterThan(0);
    expect(hits.slice(0, 2)).toEqual([120, 60]);
  });

  it('no bonus without moving first', () => {
    const b = field();
    up(b, 0, 'knight', 2, 5, 5);
    const target = post(b, 1, 'knight', 5, 6);
    const log = run(b, 30);
    expect(hitsOn(log, target)).toEqual([60, 60]);
  });
});

describe('Musketier: Bajonett', () => {
  it('stabs an adjacent target for 45 every 1.0 s instead of shooting', () => {
    const b = field();
    const musketeer = up(b, 0, 'musketeer', 4, 5, 5);
    const target = post(b, 1, 'knight', 5, 6);
    const log = run(b, 45);
    expect(eventsOf(log, 'shot').filter((e) => e.unit === musketeer.id)).toEqual([]);
    expect(hitsOn(log, target)).toEqual([45, 45, 45]);
  });

  it('keeps the headshot for the first real shot (mask 6)', () => {
    const b = field();
    up(b, 0, 'musketeer', 6, 5, 5);
    const target = post(b, 1, 'knight', 5, 9);
    expect(hitsOn(run(b, 10), target)).toEqual([420]);
  });
});

describe('Bogenschütze: Salve', () => {
  it('every 4th shot also hits the two next nearest enemies in range', () => {
    const b = field();
    const archer = up(b, 0, 'archer', 2, 5, 5);
    post(b, 1, 'knight', 5, 8);
    const second = post(b, 1, 'knight', 6, 8);
    const third = post(b, 1, 'knight', 4, 9);
    post(b, 1, 'knight', 5, 11); // out of range (6 fields)
    const shots = eventsOf(run(b, 61), 'shot').filter((e) => e.unit === archer.id);
    // Shots at 0, 20, 40 (one each), the 4th at 60 is a volley of three.
    expect(shots.map((e) => e.tick)).toEqual([0, 20, 40, 60, 60, 60]);
    expect(shots.slice(4).map((e) => e.target)).toEqual([second.id, third.id]);
  });

  it('combines all three upgrades (mask 7): +2 range, burning volley arrows', () => {
    const b = field();
    const archer = up(b, 0, 'archer', 7, 5, 5);
    expect(archer.range).toBe(7);
    post(b, 1, 'knight', 5, 11);
    const second = post(b, 1, 'knight', 6, 11);
    run(b, 61 + 12);
    expect(second.burnDps).toBe(8);
  });
});

describe('Musketier: Durchschlag', () => {
  it('also hits the enemy right behind the target with 50 %', () => {
    const b = field();
    up(b, 0, 'musketeer', 1, 5, 5);
    const target = post(b, 1, 'knight', 5, 9);
    const behind = post(b, 1, 'knight', 5, 10);
    const beside = post(b, 1, 'knight', 6, 10);
    const log = run(b, 6);
    expect(hitsOn(log, target)).toEqual([140]);
    expect(hitsOn(log, behind)).toEqual([70]);
    expect(hitsOn(log, beside)).toEqual([]);
  });

  it('combines all three upgrades (mask 7)', () => {
    const b = field();
    up(b, 0, 'musketeer', 7, 5, 5);
    const target = post(b, 1, 'knight', 5, 9);
    const behind = post(b, 1, 'knight', 5, 10);
    const log = run(b, 6);
    expect(hitsOn(log, target)).toEqual([420]); // headshot
    expect(hitsOn(log, behind)).toEqual([210]); // half of it
  });
});

describe('Todeseffekte und Beschwörungen', () => {
  it('Knochenhagel: a dying skeleton deals 15 damage to adjacent enemies', () => {
    const b = field();
    busyCorner(b);
    const skeleton = up(b, 0, 'skeleton', 2, 5, 5);
    const near = post(b, 1, 'knight', 6, 6);
    const far = post(b, 1, 'knight', 7, 7);
    run(b, 1);
    skeleton.hp = 0;
    const log = run(b, 1);
    expect(hitsOn(log, near)).toContain(15);
    expect(hitsOn(log, far)).toEqual([]);
  });

  it('Tochter-TNT: one mini TNT with 50 % HP and damage and no daughter of its own', () => {
    const b = field();
    busyCorner(b);
    const tnt = up(b, 0, 'tnt', 1, 5, 5);
    post(b, 1, 'bat', 9, 20); // keeps player 1 in the game, far away
    tnt.hp = 0;
    const log = run(b, 1);
    const summons = eventsOf(log, 'summon');
    expect(summons).toHaveLength(1);
    const daughter = b.units.find((u) => u.id === summons[0]!.unit)!;
    expect(daughter).toMatchObject({ card: 'tnt', x: 5, y: 5, maxHp: 75, powerBps: 5000 });
    expect(daughter.up & 1).toBe(0);
    expect(daughter.summonerId).toBe(tnt.id);
    // The daughter's blast hits for 125 and leaves nothing behind.
    const victim = post(b, 1, 'knight', 5, 6);
    daughter.hp = 0;
    const blast = run(b, 1);
    expect(hitsOn(blast, victim)).toEqual([125]);
    expect(eventsOf(blast, 'summon')).toEqual([]);
  });

  it('Geröll: a dying golem leaves 3 mini golems with 20 % of HP and damage', () => {
    const b = field();
    busyCorner(b);
    const golem = up(b, 0, 'golem', 4, 5, 5);
    post(b, 1, 'bat', 9, 20);
    const hp = golem.maxHp;
    golem.hp = 0;
    const log = run(b, 1);
    const minis = eventsOf(log, 'summon').map((e) => b.units.find((u) => u.id === e.unit)!);
    expect(minis).toHaveLength(3);
    for (const m of minis) {
      expect(m).toMatchObject({ card: 'golem', maxHp: (hp * 2) / 10, powerBps: 2000 });
      expect(m.up & 4).toBe(0);
    }
    // Mini golems leave no rubble.
    for (const m of minis) m.hp = 0;
    expect(eventsOf(run(b, 1), 'summon')).toEqual([]);
  });

  it('Knochenarmee: a summon every 3 s, at most 6', () => {
    const b = field();
    const necro = up(b, 0, 'necromancer', 1, 5, 5, { maxHp: 1_000_000 });
    expect(necro.summonTick).toBe(60);
    post(b, 1, 'bat', 5, 8);
    const log = run(b, 61 * 8);
    expect(eventsOf(log, 'summon').map((e) => e.tick)).toEqual([60, 120, 180, 240, 300, 360]);
  });

  it('Seelenernte: an enemy dying within r 3 gives one skeleton at once', () => {
    const b = field();
    up(b, 0, 'necromancer', 2, 5, 5, { maxHp: 1_000_000 });
    post(b, 1, 'bat', 5, 12);
    const near = post(b, 1, 'knight', 5, 8);
    const far = post(b, 1, 'knight', 9, 9);
    near.hp = 0;
    far.hp = 0;
    const log = run(b, 1);
    expect(eventsOf(log, 'summon')).toHaveLength(1);
  });
});

describe('Lauf-TNT: all three upgrades (mask 7)', () => {
  it('the daughter keeps short fuse and armored crate, halved HP, no daughter', () => {
    const b = field();
    busyCorner(b);
    const tnt = up(b, 0, 'tnt', 7, 5, 5);
    post(b, 1, 'bat', 9, 20);
    expect(tnt).toMatchObject({ maxHp: 300, speed: 160 });
    tnt.hp = 0;
    const log = run(b, 1);
    const daughter = b.units.find((u) => u.id === eventsOf(log, 'summon')[0]!.unit)!;
    expect(daughter).toMatchObject({ maxHp: 150, speed: 160, up: 6 });
  });
});

describe('Untot, Wiederbelebung, Myzel', () => {
  it('Untot: 2 s after death the skeleton rises once as a zombie with 40 % HP', () => {
    const b = field();
    busyCorner(b);
    const skeleton = up(b, 0, 'skeleton', 1, 5, 5);
    post(b, 1, 'bat', 9, 20);
    skeleton.hp = 0;
    const log = run(b, 1);
    const zombie = b.units.find((u) => u.id === eventsOf(log, 'summon')[0]!.unit)!;
    expect(zombie).toMatchObject({ x: 5, y: 5, maxHp: 24, hp: 24, up: 0 });
    expect(zombie).toMatchObject({ stunUntil: 40, untargetableUntil: 40, invulnUntil: 40 });
    zombie.hp = 0;
    expect(eventsOf(run(b, 1), 'summon')).toEqual([]); // only once
  });

  it('Wiederbelebung: the first ally dying in range returns with 50 % HP, once per round', () => {
    const b = field();
    busyCorner(b);
    const healer = up(b, 0, 'healer', 2, 5, 5);
    applyStun(healer, 1000, 0);
    post(b, 1, 'bat', 9, 20);
    const first = put(b, 0, 'knight', 5, 7);
    const second = put(b, 0, 'knight', 6, 7);
    first.hp = 0;
    const log = run(b, 1);
    const back = b.units.find((u) => u.id === eventsOf(log, 'summon')[0]!.unit)!;
    expect(back).toMatchObject({ card: 'knight', x: 5, y: 7, hp: 300, maxHp: 600 });
    expect(healer.reviveLeft).toBe(0);
    second.hp = 0;
    expect(eventsOf(run(b, 1), 'summon')).toEqual([]);
  });

  it('combines all three healer upgrades (mask 7)', () => {
    const b = field();
    busyCorner(b);
    const healer = up(b, 0, 'healer', 7, 5, 5);
    expect(healer.reviveLeft).toBe(1);
    const target = put(b, 0, 'knight', 5, 7, { hp: 100 });
    const near = put(b, 0, 'knight', 6, 8, { hp: 100 });
    for (const u of [target, near]) applyStun(u, 1000, 0);
    run(b, 1);
    expect(near).toMatchObject({ hp: 124, dmgBonusBps: 2000 });
  });

  it('Myzel: neighbouring shroomlings heal each other by 5 HP per second', () => {
    const b = field();
    busyCorner(b);
    const a = up(b, 0, 'shroomling', 4, 5, 5, { hp: 10 });
    const c = up(b, 0, 'shroomling', 4, 6, 6, { hp: 10 });
    const far = up(b, 0, 'shroomling', 4, 8, 8, { hp: 10 });
    for (const u of [a, c, far]) applyStun(u, 1000, 0);
    post(b, 1, 'bat', 9, 20);
    run(b, 40);
    expect([a.hp, c.hp, far.hp]).toEqual([20, 20, 10]);
  });
});

describe('Zeitgesteuerte Fähigkeiten', () => {
  it('Erdstoß: every 6 s 60 area damage within r 1.5 and 30 % slow for 2 s', () => {
    const b = field();
    up(b, 0, 'golem', 2, 5, 5, { maxHp: 1_000_000 });
    const bat = post(b, 1, 'bat', 5, 6); // golems cannot hit air: untouched
    const near = post(b, 1, 'knight', 6, 6);
    const far = post(b, 1, 'knight', 7, 7);
    const log = run(b, 121);
    expect(hitsOn(log, far)).toEqual([]);
    expect(hitsOn(log, bat)).toEqual([]);
    expect(near).toMatchObject({ slowBps: 3000, slowUntil: 160 });
    expect(hitsOn(log.slice(120), near)).toContain(60);
  });

  it('Frostnova: at battle start and every 12 s freezes enemies within r 2 for 1.5 s', () => {
    const b = field();
    up(b, 0, 'frost_shaman', 2, 5, 5, { maxHp: 1_000_000 });
    const knight = dummy(b, 1, 'knight', 5, 7);
    const far = dummy(b, 1, 'knight', 9, 9);
    run(b, 1);
    expect(knight.stunUntil).toBe(30);
    expect(far.stunUntil).toBe(0);
    run(b, 240);
    expect(knight.stunUntil).toBeGreaterThanOrEqual(270);
  });

  it('combines all three frost shaman upgrades (mask 7)', () => {
    const b = field();
    up(b, 0, 'frost_shaman', 7, 5, 5, { maxHp: 1_000_000 });
    const knight = dummy(b, 1, 'knight', 5, 6);
    run(b, 1); // nova at tick 0 freezes the knight before it can hit
    expect(knight).toMatchObject({ stunUntil: 30, slowUntil: 0 });
    run(b, 30); // the knight hits at tick 30 and gets slowed by the ice armour
    expect(knight.slowUntil).toBeGreaterThanOrEqual(70);
  });

  it('Wachstum: every 10 s +15 % damage, at most 3 times', () => {
    const b = field();
    const whelp = up(b, 0, 'whelp', 4, 5, 5, { maxHp: 1_000_000 });
    post(b, 1, 'knight', 5, 7);
    run(b, 201);
    expect(whelp).toMatchObject({ stacks: 1, powerBps: 11500 });
    run(b, 600);
    expect(whelp).toMatchObject({ stacks: 3, powerBps: 14500, abilityTick: -1 });
  });

  it('Meteor: every 10 s 200 damage on the largest enemy group', () => {
    const b = field();
    up(b, 0, 'pyromancer', 2, 5, 5, { maxHp: 1_000_000 });
    const lone = post(b, 1, 'knight', 5, 8);
    const g1 = post(b, 1, 'knight', 9, 14);
    const g2 = post(b, 1, 'knight', 10, 14);
    const g3 = post(b, 1, 'knight', 9, 15);
    const log = run(b, 201).slice(200);
    for (const u of [g1, g2, g3]) expect(hitsOn(log, u)).toContain(200);
    expect(hitsOn(log, lone)).not.toContain(200);
  });
});

describe('Kombinationen (mask 7)', () => {
  it('Pyromantin: inferno, meteor and heat shield together', () => {
    const b = field();
    const pyro = up(b, 0, 'pyromancer', 7, 5, 5, { maxHp: 1_000_000 });
    expect(pyro).toMatchObject({ ignoreHits: 2, abilityTick: 200 });
    dummy(b, 1, 'knight', 5, 6);
    const log = run(b, 50);
    expect(hitsOn(log, pyro)).toEqual([0, 0, 60]);
    expect(b.units.find((u) => u.card === 'knight')!.burnDps).toBe(15);
  });

  it('Steingolem: stone skin, earthquake and rubble together', () => {
    const b = field();
    busyCorner(b);
    const golem = up(b, 0, 'golem', 7, 5, 5);
    expect(golem).toMatchObject({ armorBps: 2000, abilityTick: 120 });
    post(b, 1, 'bat', 9, 20);
    golem.hp = 0;
    const log = run(b, 1);
    const minis = eventsOf(log, 'summon').map((e) => b.units.find((u) => u.id === e.unit)!);
    expect(minis).toHaveLength(3);
    // Mini golems keep stone skin and earthquake, but leave no rubble.
    for (const m of minis) expect(m).toMatchObject({ up: 3, armorBps: 2000 });
  });

  it('Skelette: undead, bone hail and rattle gang together', () => {
    expect(unitCount('skeleton', 7, false)).toBe(7);
    const b = field();
    busyCorner(b);
    const skeleton = up(b, 0, 'skeleton', 7, 5, 5);
    const near = post(b, 1, 'knight', 6, 6);
    run(b, 1);
    skeleton.hp = 0;
    const log = run(b, 1);
    expect(hitsOn(log, near)).toContain(15);
    const zombie = b.units.find((u) => u.id === eventsOf(log, 'summon')[0]!.unit)!;
    expect(zombie.up).toBe(6); // the zombie still has bone hail
  });
});

describe('Bombardierkäfer: Säurepfütze', () => {
  it('the impact leaves acid for 3 s with 25 damage per second', () => {
    const b = field();
    up(b, 0, 'beetle', 1, 5, 2, { maxHp: 1_000_000 });
    const target = post(b, 1, 'knight', 5, 12);
    const log = run(b, 120);
    const zones = eventsOf(log, 'zone');
    expect(zones.length).toBeGreaterThan(0);
    expect(zones[0]).toMatchObject({ x: 5, y: 12, radius: 1500, endTick: zones[0]!.tick + 60 });
    expect(hitsOn(log, target).filter((n) => n < 10).length).toBeGreaterThan(0);
  });
});

describe('Assassine: Schattenschritt und Rauchbombe', () => {
  it('jumps again to the farthest enemy when its target dies, then hides for 2 s', () => {
    const b = field();
    noJump(b);
    const assassin = up(b, 0, 'assassin', 7, 5, 5);
    const victim = post(b, 1, 'knight', 5, 6);
    victim.hp = 1;
    post(b, 1, 'knight', 10, 20);
    const log = run(b, 2);
    const jumps = eventsOf(log, 'jump');
    expect(jumps).toHaveLength(1);
    expect(jumps[0]).toMatchObject({ tick: 1, unit: assassin.id });
    expect(Math.abs(assassin.x - 10) + Math.abs(assassin.y - 20)).toBeLessThanOrEqual(2);
    expect(assassin).toMatchObject({ untargetableUntil: 41, jumpReadyTick: 121 });
    expect(victim.poisonUntil).toBe(80); // poison (mask 7 combines all three)
  });

  it('without Schattenschritt it walks on', () => {
    const b = field();
    noJump(b);
    up(b, 0, 'assassin', 0, 5, 5);
    post(b, 1, 'knight', 5, 6).hp = 1;
    post(b, 1, 'knight', 10, 20);
    expect(eventsOf(run(b, 5), 'jump')).toEqual([]);
  });
});

describe('Ritter: Spott', () => {
  it('enemies within r 2 must attack him if they can', () => {
    const b = field();
    const taunter = up(b, 0, 'knight', 4, 5, 8, { maxHp: 1_000_000 });
    const bait = put(b, 0, 'archer', 5, 5, { maxHp: 1_000_000 });
    applyStun(taunter, 1000, 0);
    applyStun(bait, 1000, 0);
    const enemy = dummy(b, 1, 'knight', 5, 6); // archer 1 field away, taunter 2 fields
    run(b, 1);
    expect(enemy.targetId).toBe(taunter.id);
    const bat = dummy(b, 1, 'bat', 5, 6); // in the air above the knight, same distances
    run(b, 1);
    expect(bat.targetId).toBe(taunter.id);
  });

  it('combines all three knight upgrades (mask 7)', () => {
    const b = field();
    const knight = up(b, 0, 'knight', 7, 5, 5);
    expect(knight.shield).toBe(250);
    put(b, 0, 'archer', 4, 5, { maxHp: 1_000_000 });
    const enemy = dummy(b, 1, 'knight', 5, 9);
    for (let i = 0; i < 100 && enemy.targetId !== knight.id; i++) run(b, 1);
    expect(enemy.targetId).toBe(knight.id);
  });
});

describe('Bombardierkäfer: Doppelladung', () => {
  it('two shells at two different targets, 60 % damage each', () => {
    const b = field();
    const beetle = up(b, 0, 'beetle', 2, 5, 2, { maxHp: 1_000_000 });
    const first = post(b, 1, 'knight', 5, 12);
    const second = post(b, 1, 'knight', 9, 14);
    const lobs = eventsOf(run(b, 1), 'lob').filter((e) => e.unit === beetle.id);
    expect(lobs.map((e) => [e.x, e.y])).toEqual([
      [first.x, first.y],
      [second.x, second.y],
    ]);
    expect(b.projectiles.map((p) => p.damage)).toEqual([96, 96]); // 160 * 60 %
  });

  it('combines all three beetle upgrades (mask 7)', () => {
    const b = field();
    const beetle = up(b, 0, 'beetle', 7, 5, 2, { maxHp: 1_000_000 });
    expect(beetle.maxHp).toBe(1_000_000);
    post(b, 1, 'knight', 5, 12);
    const log = run(b, 40);
    expect(eventsOf(log, 'lob')).toHaveLength(2); // both on the only target
    expect(eventsOf(log, 'zone')).toHaveLength(2);
  });
});

describe('Pilzlinge: Riesenpilz (rebuildField)', () => {
  function shroomMatch(double: boolean, mask: number): MatchState {
    const s = createMatch({
      seed: 3,
      players: [
        { deck: ['shroomling', 'knight', 'tnt', 'skeleton'], levels: {} },
        { deck: ['healer', 'musketeer', 'bat', 'assassin'], levels: {} },
      ],
    });
    const n = double ? 8 : 4;
    const unitIds = Array.from({ length: n }, (_, i) => 1 + i);
    s.army = [
      { player: 0, card: 'shroomling', level: 1, round: 1, double, unitIds },
      { player: 1, card: 'bat', level: 1, round: 1, double: false, unitIds: [20] },
    ];
    s.nextUnitId = 21;
    s.activeUpgrades[0].shroomling = mask;
    rebuildField(s);
    return s;
  }

  it('the first unit of the card becomes a giant with 3x HP and damage', () => {
    const units = shroomMatch(false, 1).battle.units.filter((u) => u.card === 'shroomling');
    expect(units.map((u) => u.giant)).toEqual([true, false, false, false]);
    expect(units[0]!.maxHp).toBe(units[1]!.maxHp * 3);
    expect(units[0]!.powerBps).toBe(30000);
  });

  it('a double pack has two giants: the 1st and the 5th unit', () => {
    const units = shroomMatch(true, 1).battle.units.filter((u) => u.card === 'shroomling');
    expect(units.filter((u) => u.giant).map((u) => u.id)).toEqual([1, 5]);
  });

  it('without the upgrade nobody is a giant', () => {
    const units = shroomMatch(false, 0).battle.units;
    expect(units.some((u) => u.giant)).toBe(false);
  });

  it('a giant deals 3x melee damage, its death cloud stays normal', () => {
    const b = field();
    busyCorner(b);
    const giant = up(b, 0, 'shroomling', 1, 5, 5);
    makeGiant(giant, 30000, 30000);
    const target = post(b, 1, 'knight', 5, 6);
    const normal = put(b, 0, 'shroomling', 9, 9);
    const first = hitsOn(run(b, 1), target)[0]!;
    giant.hp = 0;
    normal.hp = 0;
    run(b, 1);
    expect(first % 3).toBe(0);
    expect(b.zones.map((z) => z.damagePerSecond)).toEqual([15, 15]);
  });
});

describe('Pilzlinge: Ansteckend', () => {
  it('an enemy hit by a contagious cloud within 1 s releases a cloud on death', () => {
    const b = field();
    busyCorner(b);
    const shroom = up(b, 0, 'shroomling', 2, 5, 5, { level: 3 });
    const victim = post(b, 1, 'knight', 5, 6);
    post(b, 1, 'bat', 9, 20);
    shroom.hp = 0;
    run(b, 3); // cloud from tick 0; 18/s gives its first damage point in tick 2 (D-025)
    expect(b.zones[0]).toMatchObject({ owner: 0, contagiousDps: 18 });
    expect(victim.sporedUntil).toBe(2 + 20);
    victim.hp = 0;
    const log = run(b, 1);
    const zones = eventsOf(log, 'zone');
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ x: 5, y: 6, radius: 1000, endTick: 3 + 60 });
    expect(b.zones[1]).toMatchObject({ owner: 0, damagePerSecond: 18, contagiousDps: 18 });
  });

  it('chain reaction: the new cloud spores the next enemy', () => {
    const b = field();
    busyCorner(b);
    const shroom = up(b, 0, 'shroomling', 2, 5, 5);
    const first = post(b, 1, 'knight', 5, 6);
    const second = post(b, 1, 'knight', 5, 7); // only in the second cloud
    post(b, 1, 'bat', 9, 20);
    shroom.hp = 0;
    run(b, 3);
    expect(second.sporedUntil).toBe(0);
    first.hp = 0;
    run(b, 3);
    expect(second.sporedUntil).toBeGreaterThan(b.tick);
  });

  it('no cloud after 1 s without spore damage, and none without the upgrade', () => {
    const b = field();
    busyCorner(b);
    const shroom = up(b, 0, 'shroomling', 2, 5, 5);
    const victim = post(b, 1, 'knight', 5, 6);
    post(b, 1, 'bat', 9, 20);
    shroom.hp = 0;
    run(b, 2);
    victim.sporedUntil = b.tick; // as if the last spore damage was 20 ticks ago
    victim.hp = 0;
    expect(eventsOf(run(b, 1), 'zone')).toEqual([]);
    const c = field();
    busyCorner(c);
    const plain = put(c, 0, 'shroomling', 5, 5);
    const v2 = post(c, 1, 'knight', 5, 6);
    post(c, 1, 'bat', 9, 20);
    plain.hp = 0;
    run(c, 2);
    expect(v2.sporedUntil).toBe(0);
  });

  it('combines all three shroomling upgrades (mask 7)', () => {
    const b = field();
    busyCorner(b);
    const a = up(b, 0, 'shroomling', 7, 5, 5, { hp: 10 });
    const c = up(b, 0, 'shroomling', 7, 6, 6, { hp: 10 });
    for (const u of [a, c]) applyStun(u, 1000, 0);
    post(b, 1, 'knight', 9, 20);
    run(b, 20);
    expect(a.hp).toBe(15); // mycelium
    a.hp = 0;
    run(b, 1);
    expect(b.zones[0]!.contagiousDps).toBe(15);
  });
});

describe('Nekromant: Lich-Form', () => {
  it('returns once as a flying ghost with 50 % HP and keeps its skeletons', () => {
    const b = field();
    busyCorner(b);
    const necro = up(b, 0, 'necromancer', 4, 5, 5);
    post(b, 1, 'bat', 5, 9);
    run(b, 81); // first skeleton at tick 80
    const skeleton = b.units.find((u) => u.summonerId === necro.id)!;
    expect(skeleton).toBeDefined();
    const timer = necro.summonTick;
    const [nx, ny] = [necro.x, necro.y];
    necro.hp = 0;
    const log = run(b, 1);
    const ghost = b.units.find((u) => u.id === eventsOf(log, 'summon')[0]!.unit)!;
    expect(ghost).toMatchObject({ card: 'necromancer', layer: AIR, ghost: true, x: nx, y: ny });
    expect(ghost.hp).toBe(ghost.maxHp / 2);
    expect(ghost.summonTick).toBe(timer);
    expect(skeleton.summonerId).toBe(ghost.id);
    ghost.hp = 0;
    expect(eventsOf(run(b, 1), 'summon')).toEqual([]); // only once
  });

  it('takes the nearest free air cell and can only be hit by air attackers', () => {
    const b = field();
    busyCorner(b);
    const necro = up(b, 0, 'necromancer', 4, 5, 5);
    put(b, 0, 'bat', 5, 5); // air cell above it is taken
    const knight = dummy(b, 1, 'knight', 5, 6);
    necro.hp = 0;
    const log = run(b, 1);
    const ghost = b.units.find((u) => u.id === eventsOf(log, 'summon')[0]!.unit)!;
    expect(ghost.layer).toBe(AIR);
    expect(Math.abs(ghost.x - 5) <= 1 && Math.abs(ghost.y - 5) <= 1).toBe(true);
    run(b, 30);
    expect(knight.targetId).not.toBe(ghost.id);
  });

  it('combines all three necromancer upgrades (mask 7)', () => {
    const b = field();
    busyCorner(b);
    const necro = up(b, 0, 'necromancer', 7, 5, 5);
    expect(necro.summonTick).toBe(60);
    const enemy = post(b, 1, 'knight', 5, 7);
    post(b, 1, 'bat', 9, 20);
    enemy.hp = 0;
    expect(eventsOf(run(b, 1), 'summon')).toHaveLength(1); // soul harvest
    necro.hp = 0;
    const log = run(b, 1);
    expect(b.units.some((u) => u.ghost && u.id === eventsOf(log, 'summon')[0]!.unit)).toBe(true);
  });
});

describe('Drachenjunges: Feueratem', () => {
  it('cone of 45 degrees towards the main target, +1 range, no projectile', () => {
    const b = field();
    const whelp = up(b, 0, 'whelp', 1, 5, 5, { maxHp: 1_000_000 });
    expect(whelp.range).toBe(3);
    const main = post(b, 1, 'knight', 5, 7);
    const edge = post(b, 1, 'knight', 7, 7); // exactly 45 degrees, distSq 8 <= 9
    const inside = post(b, 1, 'bat', 4, 8); // ~18 degrees, distSq 10 > 9: out of range
    const side = post(b, 1, 'knight', 7, 6); // ~63 degrees: outside the cone
    const behind = post(b, 1, 'knight', 5, 3); // as near as the main target, higher id
    const near = post(b, 1, 'bat', 6, 7); // ~27 degrees, air, distSq 5
    const log = run(b, 1);
    expect(eventsOf(log, 'shot')).toEqual([]);
    expect(eventsOf(log, 'breath')).toEqual([
      {
        type: 'breath',
        unit: whelp.id,
        x: 5,
        y: 5,
        target: main.id,
        tx: 5,
        ty: 7,
        range: 3,
        tick: 0,
      },
    ]);
    for (const u of [main, edge, near]) expect(hitsOn(log, u)).toEqual([55]);
    for (const u of [inside, side, behind]) expect(hitsOn(log, u)).toEqual([]);
  });

  it('combines all three whelp upgrades (mask 7)', () => {
    const b = field();
    const whelp = up(b, 0, 'whelp', 7, 5, 5);
    expect(whelp.range).toBe(3);
    const main = post(b, 1, 'knight', 5, 8);
    whelp.powerBps = 10000;
    run(b, 201);
    expect(whelp.stacks).toBe(1);
    expect(hitsOn(run(b, 60), main).every((n) => n > 55)).toBe(true);
  });
});

describe('Nachgeschärfte Tests', () => {
  it('Spott: binds an enemy although another ally stands nearer', () => {
    const b = field();
    const taunter = up(b, 0, 'knight', 4, 5, 8, { maxHp: 1_000_000 });
    const bait = put(b, 0, 'archer', 5, 5, { maxHp: 1_000_000 });
    for (const u of [taunter, bait]) applyStun(u, 1000, 0);
    const enemy = dummy(b, 1, 'knight', 5, 6);
    const b2 = field();
    put(b2, 0, 'knight', 5, 8, { maxHp: 1_000_000 }); // same set-up without taunt
    put(b2, 0, 'archer', 5, 5, { maxHp: 1_000_000 });
    const enemy2 = dummy(b2, 1, 'knight', 5, 6);
    run(b, 1);
    run(b2, 1);
    expect(enemy.targetId).toBe(taunter.id);
    expect(enemy2.targetId).toBe(2); // the archer
  });

  it('Spott: an enemy that cannot attack the knight is not bound', () => {
    const b = field();
    const taunter = up(b, 0, 'knight', 4, 5, 7, { maxHp: 1_000_000 });
    const archer = put(b, 0, 'archer', 5, 4, { maxHp: 1_000_000 });
    for (const u of [taunter, archer]) applyStun(u, 1000, 0);
    // The beetle cannot shoot within 2 fields: the adjacent knight does not bind it.
    const beetle = dummy(b, 1, 'beetle', 5, 8);
    run(b, 1);
    expect(beetle.targetId).toBe(archer.id);
  });

  it('Säurepfütze: 25 damage per second for 3 s on a standing target (75 in total)', () => {
    const b = field();
    const beetle = up(b, 0, 'beetle', 1, 5, 2);
    const target = post(b, 1, 'knight', 5, 12);
    run(b, 1); // shell launched at tick 0, lands at tick 30
    applyStun(beetle, 100_000, b.tick); // no further shells
    const log = run(b, 100);
    const hits = hitsOn(log, target);
    expect(hits[0]).toBe(160);
    expect(hits.slice(1).reduce((a, n) => a + n, 0)).toBe(75);
  });

  it('Heiler mask 7: a real revive with 50 % HP', () => {
    const b = field();
    busyCorner(b);
    const healer = up(b, 0, 'healer', 7, 5, 5);
    applyStun(healer, 1000, 0);
    post(b, 1, 'bat', 9, 20);
    const knight = put(b, 0, 'knight', 5, 7);
    knight.hp = 0;
    const log = run(b, 1);
    const back = b.units.find((u) => u.id === eventsOf(log, 'summon')[0]!.unit)!;
    expect(back).toMatchObject({ card: 'knight', hp: 300, maxHp: 600 });
    expect(healer.reviveLeft).toBe(0);
  });
});
