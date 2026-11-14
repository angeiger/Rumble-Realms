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

/** Hand-copied from SPEC 5.2 (Level 1). Do not copy values from cards.ts. */
const SPEC_SAMPLE = {
  archer: { count: 3, hp: 120, value: 30, arena: 1, rarity: 'common' },
  knight: { count: 2, hp: 600, value: 60, arena: 1, rarity: 'common' },
  tnt: { count: 2, hp: 150, value: 250, arena: 1, rarity: 'rare' },
  skeleton: { count: 5, hp: 60, value: 20, arena: 1, rarity: 'common' },
  healer: { count: 2, hp: 200, value: 40, arena: 1, rarity: 'rare' }, // heals 40
  musketeer: { count: 1, hp: 400, value: 140, arena: 1, rarity: 'rare' },
  bat: { count: 3, hp: 70, value: 22, arena: 1, rarity: 'common' },
  assassin: { count: 3, hp: 200, value: 40, arena: 2, rarity: 'rare' },
  berserker: { count: 1, hp: 900, value: 70, arena: 2, rarity: 'epic' },
  shroomling: { count: 4, hp: 90, value: 18, arena: 2, rarity: 'common' },
} as const;

describe('card registry', () => {
  it('has 10 unique ids that match the CARDS keys', () => {
    expect(CARD_IDS).toHaveLength(10);
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

  it('matches the SPEC 5.2 sample values for all 10 cards', () => {
    for (const id of CARD_IDS) {
      const expected = SPEC_SAMPLE[id];
      const card = CARDS[id];
      const attack = card.attack;
      const value =
        attack.kind === 'heal'
          ? attack.amount
          : attack.kind === 'melee' || attack.kind === 'ranged' || attack.kind === 'explode'
            ? attack.damage
            : Number.NaN;

      expect(card.count, `${id} count`).toBe(expected.count);
      expect(card.hp, `${id} hp`).toBe(expected.hp);
      expect(value, `${id} damage or heal`).toBe(expected.value);
      expect(card.arena, `${id} arena`).toBe(expected.arena);
      expect(card.rarity, `${id} rarity`).toBe(expected.rarity);
    }
  });

  it('gives only bat the AIR layer', () => {
    for (const id of CARD_IDS) {
      if (id === 'bat') {
        expect(CARDS[id].layer).toBe(AIR);
      } else {
        expect(CARDS[id].layer === AIR, `${id} must not be AIR`).toBe(false);
      }
    }
  });
});
