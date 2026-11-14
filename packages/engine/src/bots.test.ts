import { describe, expect, it } from 'vitest';
import { chooseBotPick } from './bots.ts';
import { BOT_LEVELS, BOT_PROFILES } from './data/bots.ts';
import { DECK_SIZE, OFFER_SIZE } from './data/balance.ts';
import { CARDS } from './data/cards.ts';
import { applyPick, createMatch, getOffer } from './match.ts';
import { seedRng } from './rng.ts';
import type { MatchState } from './types.ts';

function matchFor(deck: (typeof BOT_PROFILES)[number]['deck'], seed = 7): MatchState {
  return createMatch({
    seed,
    players: [
      { deck: ['archer', 'knight', 'skeleton', 'healer'], levels: {} },
      { deck, levels: {} },
    ],
  });
}

describe('bot data', () => {
  it('has easy level with Elo 800 and card level 1', () => {
    expect(BOT_LEVELS.easy).toEqual({ elo: 800, cardLevel: 1 });
  });

  it('has three easy profiles with unique ids and names', () => {
    expect(BOT_PROFILES).toHaveLength(3);
    expect(new Set(BOT_PROFILES.map((p) => p.id)).size).toBe(3);
    expect(new Set(BOT_PROFILES.map((p) => p.name)).size).toBe(3);
    for (const p of BOT_PROFILES) expect(p.level).toBe('easy');
  });

  it('has valid decks from the arena 1 pool that createMatch accepts', () => {
    for (const p of BOT_PROFILES) {
      expect(p.deck).toHaveLength(DECK_SIZE);
      expect(new Set(p.deck).size).toBe(DECK_SIZE);
      for (const card of p.deck) expect(CARDS[card].arena).toBe(1);
      expect(() => matchFor(p.deck)).not.toThrow();
    }
  });
});

describe('chooseBotPick', () => {
  it('always returns a valid slot', () => {
    const state = matchFor(BOT_PROFILES[0]!.deck);
    const rng = seedRng(1, 5);
    for (let i = 0; i < 200; i++) {
      const slot = chooseBotPick(state, 'easy', rng);
      expect(Number.isInteger(slot)).toBe(true);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(getOffer(state).slots.length);
    }
  });

  it('is deterministic for the same RNG state', () => {
    const state = matchFor(BOT_PROFILES[1]!.deck);
    const a = seedRng(99, 5);
    const b = seedRng(99, 5);
    const picksA = Array.from({ length: 50 }, () => chooseBotPick(state, 'easy', a));
    const picksB = Array.from({ length: 50 }, () => chooseBotPick(state, 'easy', b));
    expect(picksA).toEqual(picksB);
  });

  it('uses every slot over many calls', () => {
    const state = matchFor(BOT_PROFILES[2]!.deck);
    const rng = seedRng(3, 5);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(chooseBotPick(state, 'easy', rng));
    expect([...seen].sort()).toEqual(Array.from({ length: OFFER_SIZE }, (_, i) => i));
  });

  it('does not touch the match state', () => {
    const state = matchFor(BOT_PROFILES[0]!.deck);
    const before = JSON.stringify(state);
    chooseBotPick(state, 'easy', seedRng(1, 5));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('throws outside the draft', () => {
    const state = matchFor(BOT_PROFILES[0]!.deck);
    while (state.phase === 'draft') applyPick(state, 0);
    expect(() => chooseBotPick(state, 'easy', seedRng(1, 5))).toThrow();
  });

  it('throws for an unknown level', () => {
    const state = matchFor(BOT_PROFILES[0]!.deck);
    expect(() => chooseBotPick(state, 'nope' as never, seedRng(1, 5))).toThrow();
  });
});
