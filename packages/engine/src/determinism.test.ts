import { describe, expect, it } from 'vitest';
import { cloneState } from './battle/state.ts';
import { simulateToEnd } from './battle/sim.ts';
import { hashState } from './hash.ts';
import { applyPick, createMatch, endRound, startBattle } from './match.ts';
import { playMatch, randomConfig, randomPicker, replayMatch } from './play.ts';
import { seedRng } from './rng.ts';
import type { MatchConfig, MatchState } from './types.ts';

const START_SEED = 1001;
const MATCHES = 200;

function simulate(cfg: MatchConfig, pickSeed: number): { hashes: string[]; state: MatchState } {
  const hashes: string[] = [];
  const state = playMatch(cfg, randomPicker(seedRng(pickSeed, 9)), (s) => {
    hashes.push(hashState(s));
  });
  hashes.push(hashState(state));
  return { hashes, state };
}

describe('determinism (SPEC 12)', () => {
  it(`${MATCHES} random matches give identical hashes when simulated twice`, () => {
    const rng = seedRng(START_SEED, 0);
    for (let i = 0; i < MATCHES; i++) {
      const cfg = randomConfig(rng);
      const pickSeed = i;
      const a = simulate(cfg, pickSeed);
      const b = simulate(cfg, pickSeed);
      expect(b.hashes, `match ${i}, seed ${cfg.seed}`).toEqual(a.hashes);
      expect(b.state.picks).toEqual(a.state.picks);
    }
  });

  it('a different seed changes the final hash', () => {
    const rng = seedRng(START_SEED + 1, 0);
    for (let i = 0; i < 20; i++) {
      const cfg = randomConfig(rng);
      const other: MatchConfig = { ...cfg, seed: cfg.seed === 0 ? 1 : cfg.seed - 1 };
      const a = playMatch(cfg, randomPicker(seedRng(i, 9)));
      const b = playMatch(other, randomPicker(seedRng(i, 9)));
      expect(hashState(b)).not.toBe(hashState(a));
    }
  });

  it('a single different pick changes the final hash', () => {
    const rng = seedRng(START_SEED + 2, 0);
    for (let i = 0; i < 20; i++) {
      const cfg = randomConfig(rng);
      const original = playMatch(cfg, randomPicker(rng));
      // Change one pick in the first round (index 0..5); every pick is a real choice of 3.
      const index = i % 6;
      const picks = [...original.picks];
      picks[index] = ((picks[index] as number) + 1) % 3;
      // The changed pick alters the field, so later offers/picks may be shorter or longer:
      // pad with the original continuation and ignore surplus.
      let n = 0;
      const changed = playMatch(cfg, () => {
        const p = n < picks.length ? (picks[n] as number) : 0;
        n++;
        return p;
      });
      expect(hashState(changed)).not.toBe(hashState(original));
    }
  });

  it('a copy made mid-draft continues exactly like the original', () => {
    const rng = seedRng(START_SEED + 3, 0);
    for (let i = 0; i < 20; i++) {
      const cfg = randomConfig(rng);
      const original = createMatch(cfg);
      const pickRng = seedRng(i, 9);
      const picker = randomPicker(pickRng);
      // Advance a few picks (stays inside the first draft: 6 picks, plus offers).
      const early = 1 + (i % 4);
      for (let k = 0; k < early; k++) applyPick(original, picker(original));
      const copy = cloneState(original);
      expect(hashState(copy)).toBe(hashState(original));

      const finish = (state: MatchState, pickerFn: () => number): MatchState => {
        while (state.phase !== 'finished') {
          if (state.phase === 'draft') applyPick(state, pickerFn());
          else {
            simulateToEnd(startBattle(state));
            endRound(state);
          }
        }
        return state;
      };
      const pickRngCopy: ReturnType<typeof seedRng> = [...pickRng];
      const a = finish(original, () => randomPicker(pickRng)(original));
      const b = finish(copy, () => randomPicker(pickRngCopy)(copy));
      expect(hashState(b), `match ${i}`).toBe(hashState(a));
      expect(hashState(replayMatch(cfg, a.picks))).toBe(hashState(a));
    }
  });
});
