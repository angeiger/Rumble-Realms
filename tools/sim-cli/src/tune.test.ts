import { describe, expect, it } from 'vitest';
import { CARDS, CARD_IDS, unitStats } from '@rumble-realms/engine';
import {
  nextFactors,
  readValues,
  runTune,
  scaledValues,
  snapshotValues,
  withCardValues,
} from './tune.ts';
import type { CardValues, TuneOptions, UpdateOptions } from './tune.ts';

const UPDATE: UpdateOptions = { gain: 2, maxStep: 0.25, min: 0.6, max: 1.6 };

describe('nextFactors', () => {
  it('weakens strong cards, strengthens weak ones and keeps the mean', () => {
    // Steps: 1 + 2 * (0.5 - rate) = 0.8, 1.2, 1.0; mean 1.0.
    expect(nextFactors([1, 1, 1], [0.6, 0.4, 0.5], UPDATE)).toEqual([0.8, 1.2, 1]);
  });

  it('limits the step per iteration (damping)', () => {
    // Raw steps 0.2 and 1.8, limited to 0.8 and 1.25; mean 1.025.
    const f = nextFactors([1, 1], [0.9, 0.1], UPDATE);
    expect(f).toEqual([Math.round((0.8 / 1.025) * 1000) / 1000, 1.22]);
  });

  it('normalises to mean 1 before clamping to the range', () => {
    // 1.5 * 1.2 = 1.8 and 0.7 * 0.8 = 0.56, mean 1.18: 1.525 and 0.475, clamped to 1.525 and 0.6.
    const f = nextFactors([1.5, 0.7], [0.4, 0.6], UPDATE);
    expect(f).toEqual([1.525, 0.6]);
    const wide = { ...UPDATE, min: 0.4, max: 1.2 };
    // Mean 3.8 / 3: 1.263, 1.263 and 0.474, the first two clamped to 1.2.
    expect(nextFactors([1.6, 1.6, 0.6], [0.5, 0.5, 0.5], wide)).toEqual([1.2, 1.2, 0.474]);
  });

  it('leaves balanced factors alone and rounds to three decimals', () => {
    expect(nextFactors([1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5], UPDATE)).toEqual([1, 1, 1, 1]);
    const f = nextFactors([1, 1, 1], [0.51234, 0.5, 0.48766], UPDATE);
    for (const x of f) expect(Math.round(x * 1000) / 1000).toBe(x);
  });

  it('does not move the factors with gain 0', () => {
    expect(nextFactors([0.9, 1.1], [0.2, 0.8], { ...UPDATE, gain: 0 })).toEqual([0.9, 1.1]);
  });
});

describe('scaledValues', () => {
  it('splits the factor evenly between HP and damage and rounds to integers', () => {
    expect(scaledValues({ hp: 600, damage: 60 }, 1.21)).toEqual({ hp: 660, damage: 66 });
    expect(scaledValues({ hp: 90, damage: 18, cloudDps: 15 }, 0.64)).toEqual({
      hp: 72,
      damage: 14,
      cloudDps: 12,
    });
    expect(scaledValues({ hp: 1, damage: 1 }, 0.6)).toEqual({ hp: 1, damage: 1 });
  });
});

describe('withCardValues', () => {
  const snapshot = (): string => JSON.stringify(CARDS);

  it('reaches the engine and restores the cards afterwards', () => {
    const before = snapshot();
    const cloud = CARDS.shroomling.deathCloud!.damagePerSecond;
    const base = snapshotValues();
    const values = base.map((v) => scaledValues(v, 1.44));
    const knight = CARD_IDS.indexOf('knight');
    const healer = CARD_IDS.indexOf('healer');
    const shroom = CARD_IDS.indexOf('shroomling');
    withCardValues(values, () => {
      expect(unitStats('knight', 1, 0).maxHp).toBe((values[knight] as CardValues).hp);
      expect(CARDS.knight.attack.kind === 'melee' && CARDS.knight.attack.damage).toBe(72);
      const heal = CARDS.healer.attack;
      expect(heal.kind === 'heal' && heal.amount).toBe((values[healer] as CardValues).damage);
      // The healer's emergency melee stays as it is.
      expect(heal.kind === 'heal' && heal.fallbackDamage).toBe(10);
      expect(CARDS.shroomling.deathCloud?.damagePerSecond).toBe(Math.round(cloud * 1.2));
      expect(readValues('shroomling')).toEqual(values[shroom]);
    });
    expect(snapshot()).toBe(before);
  });

  it('restores the cards when the callback throws', () => {
    const before = snapshot();
    const values = snapshotValues().map((v) => scaledValues(v, 0.5));
    expect(() =>
      withCardValues(values, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(snapshot()).toBe(before);
  });
});

describe('runTune', () => {
  const options = (): TuneOptions => ({
    ...UPDATE,
    seed: 3,
    iterations: 2,
    matches: 3,
    level: 1,
    duels: 1,
    picks: 1,
    out: undefined,
    log: () => {},
  });

  it('changes CARDS only during the run and is deterministic', () => {
    const before = JSON.stringify(CARDS);
    const a = runTune(options());
    expect(JSON.stringify(CARDS)).toBe(before);
    const b = runTune(options());
    expect(b.markdown).toBe(a.markdown);
    // Two iterations plus the final check.
    expect(a.rates).toHaveLength(3);
    expect(a.factors).toHaveLength(3);
    expect(a.factors[0]).toEqual(CARD_IDS.map(() => 1));
    expect(a.original).toEqual(snapshotValues());
    a.proposed.forEach((v, i) => {
      expect(v).toEqual(scaledValues(a.original[i] as CardValues, a.factors[2]?.[i] as number));
    });
    expect(a.duelBefore).toHaveLength(CARD_IDS.length);
    expect(a.markdown).toContain('# Tuning-Vorschlag');
    expect(a.markdown).toContain('## Nebenwirkung: Karte gegen Karte (1 Pick)');
  }, 60_000);
});
