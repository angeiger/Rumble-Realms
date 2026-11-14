import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, DECK_SIZE, START_LIVES } from './data/balance.ts';
import { CARD_IDS } from './data/cards.ts';
import { hashState } from './hash.ts';
import { playMatch, randomConfig, randomPicker, replayMatch } from './play.ts';
import { seedRng } from './rng.ts';

describe('play helpers', () => {
  it('randomConfig makes valid, varied configs', () => {
    const rng = seedRng(1, 100);
    const seeds = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const cfg = randomConfig(rng);
      expect(Number.isSafeInteger(cfg.seed) && cfg.seed >= 0).toBe(true);
      seeds.add(cfg.seed);
      for (const p of cfg.players) {
        expect(p.deck).toHaveLength(DECK_SIZE);
        expect(new Set(p.deck).size).toBe(DECK_SIZE);
        for (const card of p.deck) {
          expect(CARD_IDS).toContain(card);
          const level = p.levels[card] as number;
          expect(level).toBeGreaterThanOrEqual(1);
          expect(level).toBeLessThanOrEqual(MAX_LEVEL);
        }
      }
    }
    expect(seeds.size).toBe(50);
  });

  it('a match always ends with a winner or a draw', () => {
    const rng = seedRng(2, 100);
    for (let i = 0; i < 20; i++) {
      const state = playMatch(randomConfig(rng), randomPicker(rng));
      expect(state.phase).toBe('finished');
      expect([0, 1, 'draw']).toContain(state.winner);
      expect(state.rounds.length).toBeGreaterThanOrEqual(START_LIVES);
    }
  });

  it('calls onRound once per battle, before endRound', () => {
    const rng = seedRng(3, 100);
    const seen: (number | undefined)[] = [];
    const state = playMatch(randomConfig(rng), randomPicker(rng), (s) => {
      expect(s.phase).toBe('battle');
      seen.push(s.battle.result?.ticks);
    });
    expect(seen).toHaveLength(state.rounds.length);
    expect(seen).toEqual(state.rounds.map((r) => r.result.ticks));
  });

  it('replayMatch reproduces the original match', () => {
    const rng = seedRng(4, 100);
    for (let i = 0; i < 10; i++) {
      const cfg = randomConfig(rng);
      const original = playMatch(cfg, randomPicker(rng));
      const replay = replayMatch(cfg, original.picks);
      expect(hashState(replay)).toBe(hashState(original));
    }
  });

  it('replayMatch throws on missing or surplus picks', () => {
    const rng = seedRng(5, 100);
    const cfg = randomConfig(rng);
    const original = playMatch(cfg, randomPicker(rng));
    expect(() => replayMatch(cfg, original.picks.slice(0, -1))).toThrow(/too short/);
    expect(() => replayMatch(cfg, [])).toThrow(/too short/);
    expect(() => replayMatch(cfg, [...original.picks, 0])).toThrow(/unused/);
    expect(() => replayMatch(cfg, [...original.picks.slice(0, -1), 3])).toThrow(/slot/);
  });
});
