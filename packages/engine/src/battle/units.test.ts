/**
 * Abilities of the ten base units (SPEC 5.2, 5.3, D-022, D-023, D-027, D-028).
 * Knight and skeleton have no special rules; their attack timing is covered in sim.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { CardId } from '../types.ts';
import { AIR, GROUND } from '../types.ts';
import { unitById } from './state.ts';
import {
  attackTicks,
  busyCorner,
  cornerPocket,
  dummy,
  eventsOf,
  field,
  put,
  run,
} from './testing.ts';

function d2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

describe('Lauf-TNT', () => {
  it('runs to the nearest ground enemy and ignores air units', () => {
    const b = field();
    const tnt = put(b, 0, 'tnt', 5, 5);
    put(b, 1, 'bat', 5, 7);
    const knight = put(b, 1, 'knight', 5, 15);
    run(b, 1);
    expect(tnt.targetId).toBe(knight.id);
  });

  it('explodes on diagonal contact and destroys itself', () => {
    const b = field();
    const tnt = put(b, 0, 'tnt', 5, 10);
    const enemy = put(b, 1, 'knight', 6, 11);
    const log = run(b, 1);
    expect(eventsOf(log, 'explosion')).toEqual([
      { type: 'explosion', unit: tnt.id, x: 5, y: 10, radius: 1500, tick: 0 },
    ]);
    expect(eventsOf(log, 'death').map((e) => e.unit)).toEqual([tnt.id]);
    expect(unitById(b, tnt.id)).toBeUndefined();
    expect(enemy.hp).toBe(350);
  });

  it('walks up to an enemy and explodes there', () => {
    const b = field();
    const tnt = put(b, 0, 'tnt', 5, 5);
    const enemy = put(b, 1, 'knight', 5, 12);
    const log = run(b, 100);
    expect(eventsOf(log, 'explosion').map((e) => e.unit)).toEqual([tnt.id]);
    expect(enemy.hp).toBe(350);
  });

  it('hits the 3 x 3 cells around it (r 1.5) and nothing farther', () => {
    const b = field();
    put(b, 0, 'tnt', 5, 10);
    const hit = [put(b, 1, 'knight', 5, 11), put(b, 1, 'knight', 4, 9), put(b, 1, 'knight', 6, 10)];
    const missed = [
      put(b, 1, 'knight', 5, 12), // distance 2
      put(b, 1, 'knight', 7, 11), // distSq 5
      put(b, 1, 'knight', 7, 10), // distSq 4
      put(b, 1, 'knight', 3, 8), // distSq 8
    ];
    run(b, 1);
    expect(hit.map((u) => u.hp)).toEqual([350, 350, 350]);
    expect(missed.map((u) => u.hp)).toEqual([600, 600, 600, 600]);
  });

  it('spares allies and air units', () => {
    const b = field();
    put(b, 0, 'tnt', 5, 10);
    const ally = put(b, 0, 'knight', 4, 9); // in the blast, not next to the enemy knight
    const allyBat = put(b, 0, 'bat', 5, 10);
    const enemyBat = put(b, 1, 'bat', 6, 10);
    const trigger = put(b, 1, 'knight', 5, 11);
    run(b, 1);
    expect(trigger.hp).toBe(350);
    expect(ally.hp).toBe(600);
    expect(allyBat.hp).toBe(70);
    // The enemy bat only took the hit of the allied bat (22), not the blast (250).
    expect(enemyBat.hp).toBe(48);
  });

  it('is not set off by an air unit, but explodes when killed by damage', () => {
    const b = field();
    const tnt = put(b, 0, 'tnt', 5, 10);
    const bat = put(b, 1, 'bat', 5, 10); // right above it
    const first = run(b, 1);
    expect(eventsOf(first, 'explosion')).toEqual([]);
    expect(tnt.targetId).toBe(0); // no ground enemy: it waits
    const log = run(b, 150);
    const [death] = eventsOf(log, 'death');
    expect(death?.unit).toBe(tnt.id);
    expect(eventsOf(log, 'explosion')).toEqual([
      { type: 'explosion', unit: tnt.id, x: 5, y: 10, radius: 1500, tick: death!.tick },
    ]);
    expect(bat.hp).toBe(70); // and the blast cannot hurt the bat
  });

  it('sets off a chain reaction in the same tick', () => {
    const b = field();
    const enemyTnt = put(b, 1, 'tnt', 5, 12);
    const knight = put(b, 0, 'knight', 5, 11);
    // Next to the enemy TNT only, which has already blown up when this one acts.
    const ownTnt = put(b, 0, 'tnt', 6, 13);
    const far = put(b, 1, 'knight', 9, 17);
    const log = run(b, 1);
    expect(eventsOf(log, 'explosion').map((e) => [e.unit, e.tick])).toEqual([
      [enemyTnt.id, 0],
      [ownTnt.id, 0],
    ]);
    expect(eventsOf(log, 'damage').filter((e) => e.unit === ownTnt.id)).toEqual([
      { type: 'damage', unit: ownTnt.id, amount: 250, tick: 0 },
    ]);
    expect(knight.hp).toBe(350);
    expect(far.hp).toBe(600);
    expect(b.units.map((u) => u.id)).toEqual([knight.id, far.id]);
  });

  it('scales its blast with the level', () => {
    const b = field();
    put(b, 0, 'tnt', 5, 10, { level: 3 });
    const enemy = dummy(b, 1, 'knight', 5, 11);
    run(b, 1);
    expect(enemy.maxHp - enemy.hp).toBe(300);
  });
});

describe('Heiler', () => {
  it('heals the ally with the lowest HP share in range 3', () => {
    const b = field();
    const h = put(b, 0, 'healer', 5, 5);
    const half = put(b, 0, 'knight', 5, 7, { hp: 300 }); // 50 %
    put(b, 0, 'skeleton', 6, 6, { hp: 40 }); // 67 %
    put(b, 0, 'knight', 5, 9, { hp: 60 }); // 10 %, but out of range (distSq 16)
    put(b, 1, 'knight', 0, 23);
    const log = run(b, 1);
    expect(eventsOf(log, 'heal')).toEqual([
      { type: 'heal', unit: h.id, target: half.id, amount: 40, tick: 0 },
    ]);
    expect(half.hp).toBe(340);
  });

  it('never heals above the maximum', () => {
    const b = field();
    put(b, 0, 'healer', 5, 5);
    const ally = put(b, 0, 'knight', 5, 6, { hp: 590 });
    put(b, 1, 'knight', 0, 23);
    const log = run(b, 1);
    expect(eventsOf(log, 'heal').map((e) => e.amount)).toEqual([10]);
    expect(ally.hp).toBe(600);
  });

  it('scales healing with the level', () => {
    const b = field();
    put(b, 0, 'healer', 5, 5, { level: 5 });
    const ally = put(b, 0, 'knight', 5, 6, { hp: 300 });
    put(b, 1, 'knight', 0, 23);
    run(b, 1);
    expect(ally.hp).toBe(356); // 40 * 140 %
  });

  it('heals every 1.5 s (30 ticks)', () => {
    const b = field();
    const h = put(b, 0, 'healer', 5, 5);
    // Stays injured and in place: it fights a punching bag right next to it.
    put(b, 0, 'knight', 5, 6, { maxHp: 10_000, hp: 1000 });
    dummy(b, 1, 'skeleton', 5, 7);
    const heals = eventsOf(run(b, 100), 'heal').filter((e) => e.unit === h.id);
    expect(heals.map((e) => e.tick)).toEqual([0, 30, 60, 90]);
  });

  it('does not heal itself', () => {
    const b = field();
    const h = put(b, 0, 'healer', 5, 5, { hp: 100 });
    const ally = put(b, 0, 'knight', 5, 7);
    put(b, 1, 'knight', 0, 23);
    const log = run(b, 40);
    expect(eventsOf(log, 'heal')).toEqual([]);
    expect(h.hp).toBe(100);
    expect([h.mode, h.targetId]).toEqual(['follow', ally.id]);
  });

  it('heals other healers', () => {
    const b = field();
    const hurt = put(b, 0, 'healer', 5, 5, { hp: 100 });
    const other = put(b, 0, 'healer', 5, 6);
    put(b, 0, 'knight', 5, 7);
    put(b, 1, 'knight', 0, 23);
    const log = run(b, 1);
    expect(eventsOf(log, 'heal').map((e) => [e.unit, e.target])).toEqual([[other.id, hurt.id]]);
    expect(hurt.hp).toBe(140);
  });

  it('walks to the nearest injured ally if nobody in range needs healing', () => {
    const b = field();
    const h = put(b, 0, 'healer', 5, 5);
    // Injured, but busy with a punching bag, so it stays where it is.
    const near = put(b, 0, 'knight', 5, 12, { maxHp: 10_000, hp: 5000 }); // distSq 49
    dummy(b, 1, 'skeleton', 5, 13);
    put(b, 0, 'knight', 11, 0, { hp: 10 }); // lower share, but farther (distSq 61)
    run(b, 1);
    expect([h.mode, h.targetId]).toEqual(['heal', near.id]);
    const log = run(b, 150);
    const first = eventsOf(log, 'heal')[0];
    expect(first?.target).toBe(near.id);
    expect(d2(h.x, h.y, near.x, near.y)).toBeLessThanOrEqual(9);
  });

  it('follows the nearest ally at a distance of 2 while nobody is hurt', () => {
    const b = field();
    const ally = put(b, 0, 'knight', 5, 3);
    const h = put(b, 0, 'healer', 5, 0);
    put(b, 1, 'knight', 5, 23);
    for (let t = 0; t < 190; t++) {
      const wasStanding = h.moveCost === 0;
      run(b, 1);
      expect([h.mode, h.targetId]).toEqual(['follow', ally.id]);
      if (wasStanding && h.moveCost === 0) {
        // It only waits once it is within 2 fields of the ally (or of the ally's next cell).
        const close = d2(h.x, h.y, ally.x, ally.y) <= 4 || d2(h.x, h.y, ally.tx, ally.ty) <= 4;
        expect(close).toBe(true);
      }
      expect(d2(h.x, h.y, ally.x, ally.y)).toBeLessThanOrEqual(16);
    }
    expect(ally.y).toBeGreaterThan(8);
  });

  it('does not attack while a non-healer ally is left', () => {
    const b = field();
    const h = put(b, 0, 'healer', 5, 10);
    put(b, 0, 'knight', 0, 0);
    put(b, 1, 'knight', 5, 11);
    expect(attackTicks(run(b, 30), h.id)).toEqual([]);
  });

  it('attacks the nearest ground enemy for 10 once only healers are left', () => {
    const b = field();
    const h = put(b, 0, 'healer', 5, 10);
    const enemy = dummy(b, 1, 'knight', 5, 11);
    const log = run(b, 1);
    expect(attackTicks(log, h.id)).toEqual([0]);
    expect(enemy.maxHp - enemy.hp).toBe(10);

    const c = field();
    const h1 = put(c, 0, 'healer', 4, 10);
    const h2 = put(c, 0, 'healer', 6, 10);
    const e = dummy(c, 1, 'knight', 5, 11);
    const both = run(c, 1);
    expect([attackTicks(both, h1.id), attackTicks(both, h2.id)]).toEqual([[0], [0]]);
    expect(e.maxHp - e.hp).toBe(20);
  });

  it('switches to attacking as soon as the last fighter dies', () => {
    const b = field();
    const h = dummy(b, 0, 'healer', 5, 10);
    const fighter = put(b, 0, 'knight', 0, 0);
    const enemy = dummy(b, 1, 'knight', 5, 11);
    run(b, 5);
    expect(h.mode).toBe('follow');
    fighter.hp = 0; // leaves the field at the end of the next tick
    run(b, 2);
    expect([h.mode, h.targetId]).toEqual(['attack', enemy.id]);
    expect(attackTicks(run(b, 100), h.id).length).toBeGreaterThan(0);
  });

  it('cannot hit air units with its emergency attack', () => {
    const b = field();
    const h = put(b, 0, 'healer', 5, 10);
    put(b, 1, 'bat', 5, 11);
    const log = run(b, 30);
    expect(attackTicks(log, h.id)).toEqual([]);
    expect(h.targetId).toBe(0);
  });
});

describe('Assassine', () => {
  it('charges for 2 s without acting, but can be attacked meanwhile', () => {
    const b = field();
    const s = put(b, 0, 'assassin', 5, 10);
    const enemy = put(b, 1, 'knight', 5, 11);
    const charging = run(b, 40); // ticks 0..39
    expect(attackTicks(charging, s.id)).toEqual([]);
    expect([s.x, s.y, s.tx, s.ty]).toEqual([5, 10, 5, 10]);
    expect(s.hp).toBe(200 - 2 * 60); // hit in ticks 0 and 24
    // Already next to the only enemy: it stays and fights.
    const after = run(b, 2);
    expect(eventsOf(after, 'jump')).toEqual([]);
    expect(attackTicks(after, s.id)[0]).toBeGreaterThanOrEqual(40);
    expect(enemy.hp).toBeLessThan(600);
  });

  it('jumps next to the farthest ground enemy after 2 s', () => {
    const b = field();
    const s = put(b, 0, 'assassin', 5, 5);
    put(b, 1, 'knight', 5, 14);
    const far = put(b, 1, 'knight', 0, 23);
    run(b, 40);
    expect([s.x, s.y]).toEqual([5, 5]);
    const log = run(b, 1);
    const jumps = eventsOf(log, 'jump');
    expect(jumps).toHaveLength(1);
    expect(jumps[0]).toMatchObject({ unit: s.id, fromX: 5, fromY: 5, x: s.x, y: s.y, tick: 40 });
    // Lands on a free cell right next to (the occupied cell of) that enemy.
    expect(d2(s.x, s.y, far.tx, far.ty)).toBe(1);
    expect(s.targetId).toBe(far.id);
  });

  it('takes the nearest free cell if no neighbouring cell is free', () => {
    const b = field();
    const s = put(b, 0, 'assassin', 5, 5);
    const { knight, healers } = cornerPocket(b);
    expect(eventsOf(run(b, 41), 'jump')).toHaveLength(1);
    expect([knight.x, knight.y]).toEqual([0, 23]);
    expect(healers.map((h) => [h.x, h.y])).toEqual([
      [1, 23],
      [0, 22],
      [1, 22],
    ]);
    // All neighbours are taken; the closest free cells are two fields away.
    expect(d2(s.x, s.y, 0, 23)).toBe(4);
    expect(s.targetId).toBe(knight.id);
  });

  it('does not jump without a ground enemy', () => {
    const b = field();
    const s = put(b, 0, 'assassin', 5, 5);
    put(b, 1, 'bat', 5, 15);
    const log = run(b, 100);
    expect(eventsOf(log, 'jump')).toEqual([]);
    expect([s.x, s.y]).toEqual([5, 5]);
  });

  it('fights normally after the jump', () => {
    const b = field();
    const s = put(b, 0, 'assassin', 5, 5);
    const far = dummy(b, 1, 'knight', 0, 23);
    const log = run(b, 80);
    const ticks = attackTicks(log, s.id);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[0]).toBeGreaterThan(40);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBe(18);
    expect(far.maxHp - far.hp).toBe(40 * ticks.length);
  });
});

describe('Bogenschütze und Musketier', () => {
  it.each([
    ['archer', 5, 30],
    ['musketeer', 8, 140],
  ] as const)('%s shoots ground and air at range %i for %i damage', (card, range, damage) => {
    const ground = field();
    put(ground, 0, card, 5, 2);
    const g = put(ground, 1, 'knight', 5, 2 + range);
    run(ground, 15);
    expect(g.maxHp - g.hp).toBe(damage);

    const air = field();
    put(air, 0, card, 5, 2);
    const bat = put(air, 1, 'bat', 5, 2 + range, { maxHp: 1000 });
    const log = run(air, 1);
    expect(eventsOf(log, 'shot').map((e) => e.target)).toEqual([bat.id]);
    run(air, 15);
    expect(bat.maxHp - bat.hp).toBe(damage);
  });

  it('gives the musketeer less damage per second than three archers (SPEC 5.3)', () => {
    const dealt = (card: CardId, count: number): number => {
      const b = field();
      for (let i = 0; i < count; i++) dummy(b, 0, card, 3 + 2 * i, 10);
      const target = dummy(b, 1, 'knight', 5, 13);
      run(b, 200);
      return target.maxHp - target.hp;
    };
    // 10 s: musketeer 4 shots (56/s), three archers 30 shots (90/s).
    expect(dealt('musketeer', 1)).toBe(4 * 140);
    expect(dealt('archer', 3)).toBe(30 * 30);
  });
});

describe('Fledermäuse', () => {
  it('fly on the air layer', () => {
    const b = field();
    const bat = put(b, 0, 'bat', 5, 5);
    expect(bat.layer).toBe(AIR);
    expect(b.occ[288 + 5 * 12 + 5]).toBe(bat.id);
    expect(b.occ[5 * 12 + 5]).toBe(0);
  });

  it('attack ground units, also the one directly below', () => {
    for (const [x, y] of [
      [5, 11],
      [5, 10],
    ] as const) {
      const b = field();
      put(b, 0, 'bat', 5, 10);
      const k = put(b, 1, 'knight', x, y);
      run(b, 1);
      expect(k.hp).toBe(578);
    }
  });

  it('attack air units', () => {
    const b = field();
    const own = put(b, 0, 'bat', 5, 10);
    const other = put(b, 1, 'bat', 5, 11);
    run(b, 1);
    expect([own.hp, other.hp]).toEqual([48, 48]);
  });

  it.each(['knight', 'skeleton', 'tnt', 'assassin', 'berserker', 'shroomling', 'healer'] as const)(
    'cannot be attacked by the ground melee unit %s',
    (card) => {
      const b = field();
      const bat = dummy(b, 0, 'bat', 5, 10);
      const u = dummy(b, 1, card, 5, 11);
      run(b, 60);
      expect(u.targetId).toBe(0);
      expect(bat.hp).toBe(bat.maxHp);
      expect(u.layer).toBe(GROUND);
    },
  );
});

describe('Berserker', () => {
  /** Ticks between the first two attacks when starting with `hp` of 900. */
  function firstInterval(hp: number): number {
    const b = field();
    const berserker = put(b, 0, 'berserker', 5, 10, { hp });
    dummy(b, 1, 'knight', 5, 11);
    const ticks = attackTicks(run(b, 40), berserker.id);
    expect(ticks[0]).toBe(0);
    return ticks[1]! - ticks[0]!;
  }

  it('attacks faster the more HP it misses: 1.4 s at full HP, linearly down to 0.6 s', () => {
    const intervals: number[] = [];
    for (const hp of [900, 675, 450, 225, 90]) {
      const interval = firstInterval(hp);
      // 1.4 s - 0.8 s * missing share, in ticks: 28 - 16 * missing / max. The share may be
      // taken before or after the lifesteal of the same hit (+17), and rounded either way.
      const exact = (h: number) => 28 - (16 * (900 - Math.min(900, h))) / 900;
      expect(interval).toBeGreaterThanOrEqual(Math.floor(exact(hp)));
      expect(interval).toBeLessThanOrEqual(Math.ceil(exact(hp + 17)));
      expect(interval).toBeGreaterThanOrEqual(12);
      expect(interval).toBeLessThanOrEqual(28);
      intervals.push(interval);
    }
    expect(intervals[0]).toBe(28);
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]!).toBeLessThan(intervals[i - 1]!);
    }
  });

  it.each([
    [1000, 17], // full hit of 70 removed: 25 % = 17.5, rounded down
    [60, 15], // only 60 HP were left to remove
    [20, 5],
  ] as const)('steals 25 %% of the damage it removes (target HP %i -> +%i)', (targetHp, steal) => {
    const b = field();
    const berserker = put(b, 0, 'berserker', 5, 10, { hp: 500 });
    put(b, 1, 'skeleton', 5, 11, { maxHp: 1000, hp: targetHp }); // hits back for 20
    run(b, 1);
    expect(berserker.hp).toBe(500 + steal - 20);
  });

  // D-031: a berserker hit fatally earlier in the tick still attacks (D-024), but its
  // lifesteal does not bring it back.
  it('gets no lifesteal once it has been hit fatally in the same tick', () => {
    const b = field();
    put(b, 1, 'knight', 5, 11); // lower id: strikes first, 60 damage
    const berserker = put(b, 0, 'berserker', 5, 10, { hp: 50 });
    const log = run(b, 1);
    expect(attackTicks(log, berserker.id)).toEqual([0]); // it still strikes back
    expect(unitById(b, berserker.id)).toBeUndefined(); // +17 does not save it (50 - 60 + 17 > 0)
  });

  it('never steals above its maximum HP', () => {
    const b = field();
    const berserker = put(b, 0, 'berserker', 5, 10, { hp: 895 });
    put(b, 1, 'skeleton', 5, 11, { maxHp: 1000 });
    run(b, 1);
    // Acts before the skeleton (lower id): 895 + 17 is capped at 900, then 20 damage.
    expect(berserker.hp).toBe(880);
  });
});

describe('Pilzlinge', () => {
  it('leave a spore cloud (r 1 = cross of 5 cells) with 15 damage per second for 3 s', () => {
    const b = field();
    const p = put(b, 0, 'shroomling', 5, 10, { hp: 0 }); // dies in tick 0
    busyCorner(b);
    // Player 1 knights cannot hit the only other player 0 unit (a bat), so they stand still.
    const cross = [
      put(b, 1, 'knight', 5, 11),
      put(b, 1, 'knight', 4, 10),
      put(b, 1, 'knight', 6, 10),
      put(b, 1, 'knight', 5, 9),
    ];
    const outside = [put(b, 1, 'knight', 6, 11), put(b, 1, 'knight', 5, 12)];
    const log = run(b, 1);
    expect(eventsOf(log, 'death').map((e) => e.unit)).toEqual([p.id]);
    const [zone] = eventsOf(log, 'zone');
    expect(zone).toMatchObject({ x: 5, y: 10, radius: 1000, endTick: 60, tick: 0 });

    const taken = () => cross.map((u) => u.maxHp - u.hp);
    run(b, 20);
    expect(taken()).toEqual([15, 15, 15, 15]);
    run(b, 20);
    expect(taken()).toEqual([30, 30, 30, 30]);
    run(b, 20);
    expect(taken()).toEqual([45, 45, 45, 45]);
    run(b, 40);
    expect(taken()).toEqual([45, 45, 45, 45]); // the cloud is gone
    expect(b.zones).toEqual([]);
    expect(outside.map((u) => u.hp)).toEqual([600, 600]);
  });

  it('spread the cloud damage evenly: exactly 15 after every full second (D-025)', () => {
    const b = field();
    put(b, 0, 'shroomling', 5, 10, { hp: 0 });
    busyCorner(b);
    const victim = put(b, 1, 'knight', 5, 11);
    run(b, 1);
    for (let t = 1; t <= 60; t++) {
      run(b, 1);
      const taken = victim.maxHp - victim.hp;
      expect(taken).toBe(Math.floor((15 * t) / 20));
    }
  });

  it('only hurt enemies on the ground', () => {
    const b = field();
    put(b, 0, 'shroomling', 5, 10, { hp: 0 });
    const ally = put(b, 0, 'knight', 5, 9); // in the cloud
    const bait = put(b, 0, 'knight', 5, 12); // keeps the enemy bat busy, outside the cloud
    const enemyBat = put(b, 1, 'bat', 5, 11); // in the cloud, but in the air
    run(b, 70);
    expect(ally.hp).toBe(600);
    expect(enemyBat.hp).toBe(70);
    expect(bait.hp).toBeLessThan(600);
  });

  it('attack in melee like the others', () => {
    const b = field();
    const p = dummy(b, 0, 'shroomling', 5, 10);
    const enemy = dummy(b, 1, 'knight', 5, 11);
    const ticks = attackTicks(run(b, 60), p.id);
    expect(ticks).toEqual([0, 20, 40]);
    expect(enemy.maxHp - enemy.hp).toBe(54);
  });
});
