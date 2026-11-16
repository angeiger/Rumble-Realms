import { describe, expect, it } from 'vitest';
import { CARD_IDS, CARDS } from './cards.ts';
import { AIR } from '../types.ts';

/** Collects every numeric leaf of a value (recursively). */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(numbersIn);
  }
  return [];
}

/**
 * Snapshot of the card table (level 1): values after the first balance round, D-078.
 * Written out on purpose; a later balance round changes this table together with cards.ts.
 */
const SPEC_SAMPLE = {
  archer: { count: 3, hp: 120, value: 24, arena: 1, rarity: 'common' },
  knight: { count: 2, hp: 560, value: 60, arena: 1, rarity: 'common' },
  tnt: { count: 3, hp: 180, value: 250, arena: 1, rarity: 'rare' },
  skeleton: { count: 5, hp: 210, value: 27, arena: 1, rarity: 'common' },
  healer: { count: 2, hp: 230, value: 50, arena: 1, rarity: 'rare' }, // heals 50
  musketeer: { count: 1, hp: 360, value: 105, arena: 1, rarity: 'rare' },
  bat: { count: 3, hp: 90, value: 26, arena: 1, rarity: 'common' },
  assassin: { count: 3, hp: 250, value: 46, arena: 2, rarity: 'rare' },
  berserker: { count: 1, hp: 900, value: 70, arena: 2, rarity: 'epic' },
  shroomling: { count: 4, hp: 200, value: 28, arena: 2, rarity: 'common' },
  pyromancer: { count: 1, hp: 250, value: 58, arena: 2, rarity: 'rare' },
  necromancer: { count: 1, hp: 300, value: 25, arena: 2, rarity: 'epic' },
  beetle: { count: 1, hp: 350, value: 110, arena: 3, rarity: 'epic' },
  golem: { count: 1, hp: 1600, value: 90, arena: 3, rarity: 'epic' },
  frost_shaman: { count: 1, hp: 360, value: 54, arena: 4, rarity: 'rare' },
  whelp: { count: 1, hp: 400, value: 44, arena: 5, rarity: 'epic' },
} as const;

/** Further SPEC 5.2 columns of the six units added in M3b (engine units: ticks, fields). */
const SPEC_M3B = {
  pyromancer: { role: 'mage', zone: 'back', interval: 36, range: 4, speed: 45, air: true },
  necromancer: { role: 'summoner', zone: 'back', interval: 24, range: 3, speed: 40, air: true },
  beetle: { role: 'artillery', zone: 'back', interval: 120, range: 0, speed: 20, air: false },
  golem: { role: 'tank', zone: 'front', interval: 40, range: 1, speed: 25, air: false },
  frost_shaman: { role: 'support', zone: 'back', interval: 24, range: 5, speed: 45, air: true },
  whelp: { role: 'flyer', zone: 'mid', interval: 36, range: 2, speed: 55, air: true },
} as const;

describe('card registry', () => {
  it('has 16 unique ids in the order of SPEC 5.2 that match the CARDS keys', () => {
    expect(CARD_IDS).toHaveLength(16);
    expect(CARD_IDS).toEqual(Object.keys(SPEC_SAMPLE));
    expect(new Set(CARD_IDS).size).toBe(CARD_IDS.length);
    expect(Object.keys(CARDS).sort()).toEqual([...CARD_IDS].sort());
    for (const id of CARD_IDS) {
      expect(CARDS[id].id).toBe(id);
    }
  });

  it('has only integers greater than 0 in every card', () => {
    for (const id of CARD_IDS) {
      // `layer` is an enum (GROUND = 0, AIR = 1), not a quantity, so it is checked separately.
      const { layer, ...quantities } = CARDS[id];
      expect(Number.isInteger(layer), `${id} layer`).toBe(true);
      const values = numbersIn(quantities);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it('matches the SPEC 5.2 sample values for all 16 cards', () => {
    for (const id of CARD_IDS) {
      const expected = SPEC_SAMPLE[id];
      const card = CARDS[id];
      const attack = card.attack;
      const value = attack.kind === 'heal' ? attack.amount : attack.damage;

      expect(card.count, `${id} count`).toBe(expected.count);
      expect(card.hp, `${id} hp`).toBe(expected.hp);
      expect(value, `${id} damage or heal`).toBe(expected.value);
      expect(card.arena, `${id} arena`).toBe(expected.arena);
      expect(card.rarity, `${id} rarity`).toBe(expected.rarity);
    }
  });

  it('matches role, zone, interval, range, speed and targets of the six M3b units', () => {
    for (const [id, expected] of Object.entries(SPEC_M3B)) {
      const card = CARDS[id as keyof typeof SPEC_M3B];
      const atk = card.attack;
      expect([card.role, card.zone], id).toEqual([expected.role, expected.zone]);
      expect(atk.kind === 'explode' ? 0 : atk.intervalTicks, id).toBe(expected.interval);
      const range = atk.kind === 'ranged' ? atk.range : atk.kind === 'melee' ? 1 : 0;
      expect(range, id).toBe(expected.range);
      expect(card.moveSpeed, id).toBe(expected.speed);
      expect(card.targets, id).toEqual({ ground: true, air: expected.air });
    }
    const pyro = CARDS.pyromancer.attack;
    const whelp = CARDS.whelp.attack;
    expect(pyro.kind === 'ranged' && pyro.splashRadius).toBe(1000);
    expect(whelp.kind === 'ranged' && whelp.splashRadius).toBe(1000);
    expect(CARDS.beetle.attack).toEqual({
      kind: 'artillery',
      damage: 110,
      radius: 1000,
      intervalTicks: 120,
      minRange: 2,
      flightTicks: 30,
    });
    const frost = CARDS.frost_shaman.attack;
    expect(frost.kind === 'ranged' && frost.slow).toEqual({ bps: 3000, durationTicks: 40 });
    expect(CARDS.necromancer.summon).toEqual({
      card: 'skeleton',
      intervalTicks: 80,
      max: 4,
      hpBps: 3000, // D-077
      damageBps: 7500,
    });
  });

  it('gives only bat and whelp the AIR layer', () => {
    for (const id of CARD_IDS) {
      if (id === 'bat' || id === 'whelp') {
        expect(CARDS[id].layer).toBe(AIR);
      } else {
        expect(CARDS[id].layer === AIR, `${id} must not be AIR`).toBe(false);
      }
    }
  });
});
