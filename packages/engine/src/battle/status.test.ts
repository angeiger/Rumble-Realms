/**
 * Status effects and the central damage function (battle/status.ts, SPEC 6.2 step 1, D-025).
 * Effects not used by any unit yet get a test of their helper, so later upgrades can rely on them.
 */
import { describe, expect, it } from 'vitest';
import type { BattleState, UnitState } from '../types.ts';
import { unitById } from './state.ts';
import {
  addShield,
  applyAttackSlow,
  applyBurn,
  applyDamage,
  applyDamageBonus,
  applyPoison,
  applySlow,
  applyStun,
  canAct,
  dotDamage,
  effectiveAttackInterval,
  effectiveMoveSpeed,
  isTargetable,
  outgoingDamage,
  setInvulnerable,
  setUntargetable,
} from './status.ts';
import { attackTicks, dummy, eventsOf, field, put, run } from './testing.ts';

/** Two stunned units far apart: the battle runs, but nobody does anything. */
function quietField(): { b: BattleState; a: UnitState; z: UnitState } {
  const b = field();
  const a = dummy(b, 0, 'knight', 0, 0);
  const z = dummy(b, 1, 'knight', 11, 23);
  applyStun(a, 100_000, 0);
  applyStun(z, 100_000, 0);
  return { b, a, z };
}

function damageSum(log: ReturnType<typeof run>, unit: number): number {
  return eventsOf(log, 'damage')
    .filter((e) => e.unit === unit)
    .reduce((n, e) => n + e.amount, 0);
}

describe('slows', () => {
  it('slow lowers move speed and attack rate by its share, renewed but not stacked', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 5); // speed 40, interval 24
    expect(effectiveMoveSpeed(k, 0)).toBe(40);
    expect(effectiveAttackInterval(k, 24, 0)).toBe(24);
    applySlow(k, 3000, 40, 10);
    expect([k.slowBps, k.slowUntil]).toEqual([3000, 50]);
    expect(effectiveMoveSpeed(k, 10)).toBe(28); // 70 %
    expect(effectiveAttackInterval(k, 24, 10)).toBe(35); // ceil(24 / 0.7)
    // Renewed later: the duration starts again, the strength does not add up.
    applySlow(k, 3000, 40, 30);
    expect([k.slowBps, k.slowUntil]).toEqual([3000, 70]);
    // A weaker slow while active keeps the stronger strength.
    applySlow(k, 1000, 10, 40);
    expect([k.slowBps, k.slowUntil]).toEqual([3000, 70]);
    expect(effectiveMoveSpeed(k, 69)).toBe(28);
    expect(effectiveMoveSpeed(k, 70)).toBe(40);
    expect(effectiveAttackInterval(k, 24, 70)).toBe(24);
  });

  it('attack slow only touches the attack rate; with both slows the stronger counts', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 5);
    applyAttackSlow(k, 2500, 40, 0);
    expect(effectiveMoveSpeed(k, 0)).toBe(40);
    expect(effectiveAttackInterval(k, 24, 0)).toBe(32); // 24 / 0.75
    applySlow(k, 3000, 40, 0);
    expect(effectiveAttackInterval(k, 24, 0)).toBe(35);
    expect(effectiveAttackInterval(k, 24, 40)).toBe(24);
  });

  it('a slowed knight attacks less often in battle', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 10);
    dummy(b, 1, 'knight', 5, 11);
    applySlow(k, 3000, 1000, 0);
    expect(attackTicks(run(b, 80), k.id)).toEqual([0, 35, 70]);
  });
});

describe('stun', () => {
  it('stops attacks and movement until it ends', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 10);
    const enemy = dummy(b, 1, 'knight', 5, 11);
    applyStun(k, 30, 0);
    applyStun(enemy, 30, 0);
    expect(canAct(k, 29)).toBe(false);
    expect(canAct(k, 30)).toBe(true);
    const log = run(b, 31);
    expect(attackTicks(log, k.id)).toEqual([30]);
    expect(attackTicks(log, enemy.id)).toEqual([30]);
  });

  it('freezes a unit in mid-step', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 2);
    dummy(b, 1, 'knight', 5, 20);
    run(b, 1);
    expect(k.moveProgress).toBe(40);
    applyStun(k, 10, b.tick);
    run(b, 10);
    expect(k.moveProgress).toBe(40);
    run(b, 1);
    expect(k.moveProgress).toBe(80);
  });
});

describe('damage over time (D-025)', () => {
  it('dotDamage spreads X per second without rounding loss', () => {
    let sum = 0;
    for (let t = 0; t <= 100; t++) sum += dotDamage(8, 10, 70, t);
    expect(sum).toBe(24); // 8/s for 3 s
    expect(dotDamage(8, 10, 70, 10)).toBe(0);
    expect(dotDamage(8, 10, 70, 71)).toBe(0);
    let poison = 0;
    for (let t = 1; t <= 80; t++) poison += dotDamage(12, 0, 80, t);
    expect(poison).toBe(48);
  });

  it('burn and poison run side by side in the battle', () => {
    const { b, z } = quietField();
    applyBurn(z, 8, 60, 0); // 24 in total
    applyPoison(z, 12, 80, 0); // 48 in total
    const log = run(b, 100);
    expect(damageSum(log, z.id)).toBe(72);
    // The first damage falls in the tick after the application.
    expect(eventsOf(log, 'damage')[0]?.tick).toBeGreaterThan(0);
  });

  it('renewing a burn restarts its duration', () => {
    const { b, z } = quietField();
    applyBurn(z, 20, 20, 0); // 20 per second for 1 s
    run(b, 11); // ticks 0..10: 10 per 10 ticks
    applyBurn(z, 20, 20, b.tick);
    const log = run(b, 40);
    expect(damageSum(log, z.id)).toBe(20);
  });
});

describe('applyDamage', () => {
  it('shield points absorb first, then hit points', () => {
    const b = field();
    const k = put(b, 0, 'knight', 0, 0);
    addShield(k, 50);
    const events: Parameters<typeof applyDamage>[3] = [];
    expect(applyDamage(k, 30, 0, events)).toBe(0);
    expect([k.shield, k.hp]).toEqual([20, k.maxHp]);
    expect(applyDamage(k, 30, 0, events)).toBe(10);
    expect([k.shield, k.hp]).toEqual([0, k.maxHp - 10]);
    expect(events).toEqual([
      { type: 'damage', unit: k.id, amount: 0 },
      { type: 'damage', unit: k.id, amount: 10 },
    ]);
  });

  it('invulnerability blocks all damage without an event', () => {
    const b = field();
    const k = put(b, 0, 'knight', 0, 0);
    setInvulnerable(k, 40, 10);
    const events: Parameters<typeof applyDamage>[3] = [];
    expect(applyDamage(k, 100, 49, events)).toBe(0);
    expect(k.hp).toBe(k.maxHp);
    expect(events).toEqual([]);
    applyDamage(k, 100, 50, events);
    expect(k.hp).toBe(k.maxHp - 100);
  });

  it('armour reduces damage, rounded down; the removed HP are capped at the remaining HP', () => {
    const b = field();
    const k = put(b, 0, 'knight', 0, 0, { hp: 50 });
    k.armorBps = 2000;
    expect(applyDamage(k, 90, 0, undefined)).toBe(50);
    expect(k.hp).toBe(50 - 72);
  });
});

describe('targeting and damage bonus', () => {
  it('untargetable units are skipped by target selection but hit by area damage', () => {
    const b = field();
    const archer = put(b, 0, 'archer', 5, 5);
    const near = dummy(b, 1, 'knight', 5, 7);
    const far = dummy(b, 1, 'knight', 5, 9);
    applyStun(near, 1000, 0);
    applyStun(far, 1000, 0);
    setUntargetable(near, 20, 0);
    expect(isTargetable(near, 19)).toBe(false);
    expect(isTargetable(near, 20)).toBe(true);
    run(b, 1);
    expect(archer.targetId).toBe(far.id);
    run(b, 20); // retargets after 0.5 s once the effect is over
    expect(archer.targetId).toBe(near.id);

    const c = field();
    const tnt = put(c, 0, 'tnt', 5, 10);
    const hidden = dummy(c, 1, 'knight', 5, 11);
    setUntargetable(hidden, 1000, 0);
    dummy(c, 1, 'knight', 5, 14);
    tnt.hp = 0; // blows up at the end of tick 0
    const log = run(c, 1);
    expect(eventsOf(log, 'damage').filter((e) => e.unit === hidden.id)).toHaveLength(1);
  });

  it('damage bonus raises outgoing damage while active', () => {
    const b = field();
    const k = put(b, 0, 'knight', 5, 10);
    const enemy = dummy(b, 1, 'knight', 5, 11);
    applyDamageBonus(k, 2000, 20, 0);
    expect(outgoingDamage(k, 60, 19)).toBe(72);
    expect(outgoingDamage(k, 60, 20)).toBe(60);
    const log = run(b, 25);
    const hits = eventsOf(log, 'damage').filter((e) => e.unit === enemy.id);
    expect(hits.map((e) => e.amount)).toEqual([72, 60]);
    expect(unitById(b, enemy.id)?.hp).toBe(1_000_000 - 132);
  });
});
