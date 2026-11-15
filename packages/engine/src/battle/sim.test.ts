/**
 * Battle core: target selection, reach, attacks, deaths, end of round, events, determinism.
 * Expected values come from SPEC 4.2, 5.2, 6 and DECISIONS D-020 to D-025, not from sim.ts.
 */
import { describe, expect, it } from 'vitest';
import { CARD_IDS, CARDS } from '../data/cards.ts';
import type { BattleEvent, BattleState, CardId } from '../types.ts';
import { simulateToEnd, stepTick } from './sim.ts';
import { cloneState, unitById } from './state.ts';
import {
  attackTicks,
  dummy,
  eventsOf,
  field,
  put,
  randomBattle,
  run,
  type TickLog,
} from './testing.ts';

// Rule values (SPEC 4.2 / 6.1 / 6.2), written out on purpose instead of imported.
const SUDDEN_DEATH_TICK = 1200; // 60 s
const TIME_LIMIT = 1800; // 90 s
const RETARGET = 10; // 0.5 s

// Card values come from the data, so a balance round does not break the rules tested here.
const KNIGHT_HP = CARDS.knight.hp;
const KNIGHT_HIT = 60; // the knight's damage (unchanged by the balance rounds)

/** Damage of a level 1 attack of `card`, from the card data. */
function hitOf(card: CardId): number {
  const a = CARDS[card].attack;
  if (!('damage' in a)) throw new Error(`${card} has no damage`);
  return a.damage;
}

const ARCHER_HIT = hitOf('archer');

/** Level scaling of SPEC 6.3: +10 % per level, rounded down. */
function atLevel(base: number, level: number): number {
  return Math.floor((base * (9 + level)) / 10);
}

function d2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

/** Damage values taken by one unit, per tick. */
function damageTo(log: TickLog[], unit: number): { tick: number; amount: number }[] {
  return eventsOf(log, 'damage')
    .filter((e) => e.unit === unit)
    .map((e) => ({ tick: e.tick, amount: e.amount }));
}

describe('target selection (SPEC 6.2)', () => {
  it('picks the nearest attackable enemy', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 5);
    put(b, 1, 'knight', 5, 10); // distSq 25
    const near = put(b, 1, 'knight', 7, 8); // distSq 13
    run(b, 1);
    expect(k.targetId).toBe(near.id);
  });

  it('breaks a distance tie by the smaller row distance', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 5);
    put(b, 1, 'knight', 6, 8); // distSq 10, 3 rows, smaller id
    const sameRow = put(b, 1, 'knight', 8, 6); // distSq 10, 1 row
    run(b, 1);
    expect(k.targetId).toBe(sameRow.id);
  });

  it('breaks a full tie by the smaller unit id', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 5);
    const first = put(b, 1, 'knight', 7, 8);
    put(b, 1, 'knight', 3, 8);
    run(b, 1);
    expect(k.targetId).toBe(first.id);

    // Same for player 1 looking at player 0.
    const c = field();
    const firstA = put(c, 0, 'knight', 7, 10);
    put(c, 0, 'knight', 3, 10);
    const k1 = put(c, 1, 'knight', 5, 13);
    run(c, 1);
    expect(k1.targetId).toBe(firstA.id);
  });

  it('re-evaluates the target every 10 ticks', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 5);
    const far = put(b, 1, 'knight', 5, 17);
    run(b, 1);
    expect(k.targetId).toBe(far.id);
    const near = put(b, 1, 'knight', 5, 9); // appears after tick 0
    run(b, RETARGET - 1); // ticks 1..9
    expect(k.targetId).toBe(far.id);
    run(b, 1); // tick 10
    expect(k.targetId).toBe(near.id);
  });

  it('re-targets at once when the target dies', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 5);
    const weak = put(b, 1, 'skeleton', 5, 6, { hp: 1 });
    const other = put(b, 1, 'knight', 5, 17);
    run(b, 1);
    expect(k.targetId).toBe(weak.id);
    expect(unitById(b, weak.id)).toBeUndefined();
    run(b, 1); // tick 1, long before the regular re-evaluation
    expect(k.targetId).toBe(other.id);
  });

  it('lets ground melee units ignore air units', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 5);
    put(b, 1, 'bat', 5, 6);
    const ground = put(b, 1, 'knight', 5, 12);
    run(b, 1);
    expect(k.targetId).toBe(ground.id);
  });

  it('lets ranged units target air units', () => {
    const b = field();
    const a = put(b, 0, 'archer', 5, 5);
    const bat = put(b, 1, 'bat', 5, 8);
    put(b, 1, 'knight', 5, 15);
    const log = run(b, 1);
    expect(a.targetId).toBe(bat.id);
    expect(eventsOf(log, 'shot').map((e) => e.target)).toEqual([bat.id]);
  });

  it('keeps a unit without attackable target standing still', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 5);
    put(b, 1, 'bat', 5, 15);
    for (let t = 0; t < 200; t++) {
      run(b, 1);
      expect([k.x, k.y, k.tx, k.ty, k.targetId]).toEqual([5, 5, 5, 5, 0]);
    }
    expect(k.hp).toBeLessThan(KNIGHT_HP); // the bat arrived and attacked meanwhile
  });
});

describe('reach (D-022)', () => {
  const neighbours = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ] as const;

  it.each(neighbours)('melee hits the neighbour at offset (%i, %i)', (dx, dy) => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 10);
    const e = put(b, 1, 'knight', 5 + dx, 10 + dy);
    run(b, 1);
    expect(e.hp).toBe(KNIGHT_HP - KNIGHT_HIT);
    expect(k.hp).toBe(KNIGHT_HP - KNIGHT_HIT);
  });

  it.each([
    [2, 0],
    [0, 2],
    [2, 2],
    [1, 2],
    [-2, 1],
  ] as const)('melee does not reach offset (%i, %i)', (dx, dy) => {
    const b = field();
    put(b, 0, 'knight', 5, 10);
    const e = put(b, 1, 'knight', 5 + dx, 10 + dy);
    const log = run(b, 1);
    expect(e.hp).toBe(KNIGHT_HP);
    expect(eventsOf(log, 'attack')).toEqual([]);
  });

  it('ranged r 5 reaches offset (3, 4) but not (4, 4)', () => {
    const inRange = field();
    put(inRange, 0, 'archer', 2, 2);
    put(inRange, 1, 'knight', 5, 6);
    expect(eventsOf(run(inRange, 1), 'shot')).toHaveLength(1);

    const outOfRange = field();
    put(outOfRange, 0, 'archer', 2, 2);
    put(outOfRange, 1, 'knight', 6, 6);
    expect(eventsOf(run(outOfRange, 1), 'shot')).toHaveLength(0);
  });

  it('ranged r 8 reaches offset (0, 8) but not (1, 8)', () => {
    const inRange = field();
    put(inRange, 0, 'musketeer', 2, 2);
    put(inRange, 1, 'knight', 2, 10);
    expect(eventsOf(run(inRange, 1), 'shot')).toHaveLength(1);

    const outOfRange = field();
    put(outOfRange, 0, 'musketeer', 2, 2);
    put(outOfRange, 1, 'knight', 3, 10);
    expect(eventsOf(run(outOfRange, 1), 'shot')).toHaveLength(0);
  });
});

describe('attacks (D-024)', () => {
  // Interval in ticks from SPEC 5.2 (seconds * 20).
  it.each([
    ['knight', 24],
    ['skeleton', 14],
    ['bat', 16],
    ['shroomling', 20],
    ['archer', 20],
    ['musketeer', 50],
  ] as const)('%s attacks at once and then every %i ticks', (card, interval) => {
    const b = field();
    const a = dummy(b, 0, card, 5, 10);
    dummy(b, 1, 'knight', 5, 11);
    const ticks = attackTicks(run(b, 200), a.id);
    expect(ticks[0]).toBe(0);
    expect(ticks).toHaveLength(Math.floor(199 / interval) + 1);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBe(interval);
  });

  it('scales hit points with the level (+10 % per level, rounded down)', () => {
    for (const card of CARD_IDS) {
      for (let level = 1; level <= 5; level++) {
        const b = field();
        const u = put(b, 0, card, 5, 5, { level });
        const expected = Math.floor((CARDS[card].hp * (9 + level)) / 10);
        expect(u.maxHp).toBe(expected);
        expect(u.hp).toBe(expected);
      }
    }
    expect(put(field(), 0, 'knight', 0, 0, { level: 5 }).maxHp).toBe(Math.floor(KNIGHT_HP * 1.4)); // 140 %
  });

  it.each([
    ['knight', 1],
    ['knight', 2],
    ['knight', 3],
    ['knight', 5],
    ['bat', 2],
    ['skeleton', 4],
    ['archer', 4],
    ['musketeer', 3],
  ] as const)('%s level %i deals the level 1 damage plus 10 % per level per hit', (card, level) => {
    const damage = atLevel(hitOf(card), level);
    const b = field();
    put(b, 0, card, 5, 10, { level });
    const target = dummy(b, 1, 'knight', 5, 11);
    run(b, 12); // one melee hit or one landed shot; every next attack comes later
    expect(target.maxHp - target.hp).toBe(damage);
  });

  it('lands a shot after its flight time if the target is alive', () => {
    const b = field();
    const a = put(b, 0, 'archer', 5, 2);
    const target = put(b, 1, 'knight', 5, 7); // 5 fields
    const [shot] = eventsOf(run(b, 1), 'shot');
    expect(shot).toBeDefined();
    expect(shot!.unit).toBe(a.id);
    // 5 fields at 12 fields/s (D-024) = 8.3 ticks.
    const flight = shot!.impactTick - shot!.tick;
    expect(flight).toBeGreaterThanOrEqual(8);
    expect(flight).toBeLessThanOrEqual(9);
    run(b, shot!.impactTick - b.tick);
    expect(target.hp).toBe(KNIGHT_HP);
    const log = run(b, 1);
    expect(target.hp).toBe(KNIGHT_HP - ARCHER_HIT);
    expect(damageTo(log, target.id)).toEqual([{ tick: shot!.impactTick, amount: ARCHER_HIT }]);
    expect(b.projectiles).toEqual([]);
  });

  it('lets a shot fizzle if its target died before impact', () => {
    const b = field();
    const a = put(b, 0, 'archer', 5, 2);
    put(b, 0, 'knight', 5, 6);
    const victim = put(b, 1, 'skeleton', 5, 7, { hp: 1 }); // killed by the knight in tick 0
    put(b, 1, 'knight', 11, 23);
    const first = run(b, 1);
    expect(eventsOf(first, 'shot').map((e) => [e.unit, e.target])).toEqual([[a.id, victim.id]]);
    expect(unitById(b, victim.id)).toBeUndefined();
    const later = run(b, 15);
    expect(eventsOf(later, 'damage')).toEqual([]);
    expect(b.projectiles).toEqual([]);
  });

  it('lets a shot hit even if its shooter has died', () => {
    const b = field();
    const a = put(b, 0, 'archer', 5, 2);
    put(b, 0, 'knight', 11, 0); // keeps player 0 in the game
    const target = put(b, 1, 'knight', 5, 7);
    const [shot] = eventsOf(run(b, 1), 'shot');
    a.hp = 0; // the archer is killed right after firing
    run(b, shot!.impactTick - b.tick + 1);
    expect(unitById(b, a.id)).toBeUndefined();
    expect(target.hp).toBe(KNIGHT_HP - ARCHER_HIT);
  });
});

describe('deaths (SPEC 6.1)', () => {
  it('lets units that are hit fatally still act in the same tick', () => {
    const b = field();
    const first = put(b, 0, 'knight', 5, 10, { hp: 500 });
    const second = put(b, 1, 'knight', 5, 11, { hp: 60 });
    const log = run(b, 1);
    // `first` kills `second` (lower id acts first), yet `second` strikes back in that tick.
    expect(attackTicks(log, second.id)).toEqual([0]);
    expect(first.hp).toBe(440);
    expect(eventsOf(log, 'death').map((e) => e.unit)).toEqual([second.id]);
  });

  // D-031: a unit hit fatally earlier in the tick cannot be saved by a heal in the same tick.
  it('does not let a heal save a unit that was hit fatally in the same tick', () => {
    const b = field();
    const ally = put(b, 0, 'knight', 5, 10, { hp: 1 });
    put(b, 1, 'knight', 5, 11);
    put(b, 0, 'healer', 5, 8); // acts after the enemy knight (higher id)
    const log = run(b, 1);
    expect(eventsOf(log, 'heal')).toEqual([]);
    expect(unitById(b, ally.id)).toBeUndefined();
  });

  it.each([0, 1] as const)(
    'ends in a draw if the last units die in the same tick',
    (firstOwner) => {
      const b = field();
      put(b, firstOwner, 'knight', 5, 10, { hp: 60 });
      put(b, firstOwner === 0 ? 1 : 0, 'knight', 5, 11, { hp: 60 });
      run(b, 1);
      expect(b.units).toEqual([]);
      expect(b.result).toEqual({ winner: 'draw', reason: 'elimination', ticks: 1, hp: [0, 0] });
    },
  );
});

describe('end of round (SPEC 4.2)', () => {
  it('declares the side with units left the winner', () => {
    const b = field();
    put(b, 0, 'knight', 5, 10);
    put(b, 1, 'skeleton', 5, 11, { hp: 1 });
    run(b, 1);
    const skeletonHit = hitOf('skeleton');
    expect(b.result).toEqual({
      winner: 0,
      reason: 'elimination',
      ticks: 1,
      hp: [KNIGHT_HP - skeletonHit, 0],
    });

    const c = field();
    put(c, 0, 'skeleton', 5, 10, { hp: 1 });
    put(c, 1, 'knight', 5, 11);
    expect(simulateToEnd(c)).toEqual({
      winner: 1,
      reason: 'elimination',
      ticks: 1,
      hp: [0, KNIGHT_HP - skeletonHit],
    });
  });

  function suddenDeathField(startTick: number): BattleState {
    const b = field();
    b.tick = startTick;
    return b;
  }

  it('adds 50 % to melee damage from tick 1200 on', () => {
    for (const [tick, expected] of [
      [SUDDEN_DEATH_TICK - 1, 60],
      [SUDDEN_DEATH_TICK, 90],
    ] as const) {
      const b = suddenDeathField(tick);
      dummy(b, 0, 'knight', 5, 10);
      const target = dummy(b, 1, 'knight', 5, 11);
      run(b, 1);
      expect(target.maxHp - target.hp).toBe(expected);
    }
  });

  it('adds 50 % to shots fired in sudden death', () => {
    for (const [tick, expected] of [
      [SUDDEN_DEATH_TICK - 50, ARCHER_HIT],
      [SUDDEN_DEATH_TICK, Math.floor(ARCHER_HIT * 1.5)],
    ] as const) {
      const b = suddenDeathField(tick);
      dummy(b, 0, 'archer', 5, 10);
      const target = dummy(b, 1, 'knight', 5, 11);
      run(b, 5);
      expect(target.maxHp - target.hp).toBe(expected);
    }
  });

  it('counts a shot by the tick it lands: fired before tick 1200, landing after', () => {
    // "Jeder Schaden +50 %" from 60 s on; the projectile stores its damage without the bonus.
    const b = suddenDeathField(SUDDEN_DEATH_TICK - 1);
    dummy(b, 0, 'archer', 5, 10);
    const target = dummy(b, 1, 'knight', 5, 11);
    const [shot] = eventsOf(run(b, 1), 'shot');
    expect(shot!.impactTick).toBeGreaterThanOrEqual(SUDDEN_DEATH_TICK);
    run(b, 3);
    expect(target.maxHp - target.hp).toBe(Math.floor(ARCHER_HIT * 1.5));
  });

  it('adds 50 % to explosions in sudden death', () => {
    const b = suddenDeathField(SUDDEN_DEATH_TICK);
    put(b, 0, 'tnt', 5, 10);
    const target = dummy(b, 1, 'knight', 5, 11);
    run(b, 26); // the fuse burns 25 ticks (D-050)
    expect(target.maxHp - target.hp).toBe(375);
  });

  it('adds 50 % to zone damage in sudden death', () => {
    const b = suddenDeathField(SUDDEN_DEATH_TICK);
    put(b, 0, 'shroomling', 5, 10, { hp: 0 }); // dies in the first tick, leaves its cloud
    put(b, 0, 'bat', 0, 1); // keeps player 0 in the game, busy with the bait
    put(b, 1, 'knight', 0, 0); // bait
    const victim = put(b, 1, 'knight', 5, 11); // cannot attack anything, stands in the cloud
    run(b, 70);
    // Cloud damage over 3 s, +50 %; rounding may cost or add a point per second.
    const cloud = CARDS.shroomling.deathCloud!.damagePerSecond * 3 * 1.5;
    expect(victim.maxHp - victim.hp).toBeGreaterThanOrEqual(cloud - 2);
    expect(victim.maxHp - victim.hp).toBeLessThanOrEqual(cloud + 1);
  });

  it('ends at the time limit with the higher HP sum as winner', () => {
    const b = field();
    dummy(b, 0, 'knight', 5, 5); // a bat cannot be hit by a knight: nobody can win early
    put(b, 1, 'bat', 5, 15);
    const result = simulateToEnd(b);
    expect(result.reason).toBe('timeout');
    expect(result.ticks).toBe(TIME_LIMIT);
    expect(result.winner).toBe(0);
    expect(b.tick).toBe(TIME_LIMIT);
  });

  it.each([
    [[600], [600], 'draw'],
    [[301, 300], [600], 0],
    [[300, 299], [600], 1],
    [[600], [100, 100, 100, 100, 100, 101], 1],
  ] as const)('compares HP sums %j vs %j at the time limit -> %s', (hpA, hpB, winner) => {
    const b = field();
    b.tick = TIME_LIMIT - 1;
    hpA.forEach((hp, i) => put(b, 0, 'knight', i, 0, { hp }));
    hpB.forEach((hp, i) => put(b, 1, 'knight', i, 23, { hp }));
    stepTick(b);
    const sum = (list: readonly number[]) => list.reduce((s, v) => s + v, 0);
    expect(b.result).toEqual({
      winner,
      reason: 'timeout',
      ticks: TIME_LIMIT,
      hp: [sum(hpA), sum(hpB)],
    });
  });

  it('does not change anything after the end', () => {
    const b = field();
    put(b, 0, 'knight', 5, 10);
    put(b, 1, 'skeleton', 5, 11);
    simulateToEnd(b);
    const before = JSON.stringify(b);
    const log = run(b, 10);
    expect(JSON.stringify(b)).toBe(before);
    expect(log.flatMap((l) => l.events)).toEqual([]);
  });

  it('always terminates within the time limit, with a consistent result', () => {
    for (let seed = 0; seed < 120; seed++) {
      const b = randomBattle(seed);
      const result = simulateToEnd(b);
      expect(result.ticks).toBeLessThanOrEqual(TIME_LIMIT);
      expect(result.ticks).toBe(b.tick);
      const left = [0, 0];
      const hp = [0, 0];
      for (const u of b.units) {
        left[u.owner]!++;
        hp[u.owner]! += u.hp;
      }
      expect(result.hp).toEqual(hp);
      if (result.reason === 'elimination') {
        expect(left[0] === 0 || left[1] === 0).toBe(true);
        const expected = left[0]! > 0 ? 0 : left[1]! > 0 ? 1 : 'draw';
        expect(result.winner).toBe(expected);
      } else {
        expect(result.ticks).toBe(TIME_LIMIT);
        expect(result.winner).toBe(hp[0]! > hp[1]! ? 0 : hp[1]! > hp[0]! ? 1 : 'draw');
      }
    }
  });
});

describe('events (D-020)', () => {
  /** Runs a battle to the end, checking every event against the state around it. */
  function checkEvents(b: BattleState, seen: Set<BattleEvent['type']>): void {
    while (b.result === null) {
      const before = new Map(b.units.map((u) => [u.id, { ...u }]));
      const tick = b.tick;
      const events: BattleEvent[] = [];
      stepTick(b, events);
      const died = new Set<number>();
      const jumped = new Set<number>();
      for (const e of events) {
        if (e.type === 'death') died.add(e.unit);
        if (e.type === 'jump') jumped.add(e.unit);
        // Summoned in this tick: count as present (area damage may already hit them).
        if (e.type === 'summon') {
          const u = b.units.find((x) => x.id === e.unit) ?? { id: e.unit, card: e.card };
          before.set(e.unit, { ...(u as (typeof b.units)[number]) });
        }
      }
      for (const e of events) {
        seen.add(e.type);
        switch (e.type) {
          case 'death':
            expect(before.has(e.unit)).toBe(true);
            expect(unitById(b, e.unit)).toBeUndefined();
            break;
          case 'damage':
            expect(before.has(e.unit)).toBe(true);
            expect(e.amount).toBeGreaterThan(0);
            break;
          case 'attack': {
            const u = before.get(e.unit)!;
            const t = before.get(e.target)!;
            expect(u.owner).not.toBe(t.owner);
            // A target that jumped in this tick (assassin) is no longer where it was before.
            if (!jumped.has(t.id)) expect(d2(u.x, u.y, t.x, t.y)).toBeLessThanOrEqual(2);
            break;
          }
          case 'shot': {
            const u = before.get(e.unit)!;
            expect(u.owner).not.toBe(before.get(e.target)!.owner);
            expect(e.impactTick).toBeGreaterThan(tick);
            expect(CARDS[u.card].attack.kind).toBe('ranged');
            break;
          }
          case 'heal': {
            const u = before.get(e.unit)!;
            expect(u.card).toBe('healer');
            expect(e.target).not.toBe(e.unit);
            expect(before.get(e.target)!.owner).toBe(u.owner);
            expect(e.amount).toBeGreaterThan(0);
            break;
          }
          case 'explosion':
            expect(before.get(e.unit)!.card).toBe('tnt');
            expect(died.has(e.unit)).toBe(true);
            break;
          case 'jump':
            expect(before.get(e.unit)!.card).toBe('assassin');
            expect([e.fromX, e.fromY]).not.toEqual([e.x, e.y]);
            break;
          case 'zone':
            expect(e.endTick).toBe(tick + 60);
            break;
          case 'lob': {
            const u = before.get(e.unit)!;
            expect(u.card).toBe('beetle');
            expect(e.impactTick).toBe(tick + 30);
            break;
          }
          case 'impact':
            expect(e.radius).toBeGreaterThan(0);
            expect(e.x >= 0 && e.y >= 0).toBe(true);
            break;
          case 'summon': {
            expect(before.get(e.summoner)!.card).toBe('necromancer');
            expect(e.card).toBe('skeleton');
            expect(e.unit).toBeGreaterThan(e.summoner);
            break;
          }
        }
      }
    }
  }

  it('reports plausible events of every kind', () => {
    const seen = new Set<BattleEvent['type']>();
    for (let seed = 0; seed < 60; seed++) checkEvents(randomBattle(seed), seen);
    expect([...seen].sort()).toEqual(
      [
        'attack',
        'damage',
        'death',
        'explosion',
        'heal',
        'impact',
        'jump',
        'lob',
        'shot',
        'summon',
        'zone',
      ].sort(),
    );
  });

  it('does not influence the simulation', () => {
    for (let seed = 0; seed < 40; seed++) {
      const withEvents = randomBattle(seed);
      const without = cloneState(withEvents);
      while (withEvents.result === null) stepTick(withEvents, []);
      simulateToEnd(without);
      expect(JSON.stringify(withEvents)).toBe(JSON.stringify(without));
    }
  });
});

describe('determinism (SPEC 6.1)', () => {
  it('gives identical results for 100 random fields simulated twice', () => {
    for (let seed = 0; seed < 100; seed++) {
      const first = randomBattle(seed);
      expect(JSON.stringify(randomBattle(seed))).toBe(JSON.stringify(first));
      const second = cloneState(first);
      // Interleave both runs tick by tick: shared work arrays must not leak between them.
      while (first.result === null || second.result === null) {
        stepTick(first);
        stepTick(second);
      }
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });

  it('keeps every number an integer', () => {
    const b = randomBattle(3);
    const check = (value: unknown): void => {
      if (typeof value === 'number') expect(Number.isInteger(value)).toBe(true);
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(check);
    };
    while (b.result === null) {
      stepTick(b);
      check(b);
    }
  });

  it('uses random fields that contain all 16 units', () => {
    // Guard for the generator used above: otherwise some units would never be covered.
    const cards = new Set<CardId>();
    for (let seed = 0; seed < 100; seed++)
      for (const u of randomBattle(seed).units) cards.add(u.card);
    expect([...cards].sort()).toEqual([...CARD_IDS].sort());
  });
});
