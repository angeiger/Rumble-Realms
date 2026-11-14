import { describe, expect, it } from 'vitest';
import { GRID_CELLS, GRID_COLS, START_LIVES, TIME_LIMIT_TICKS } from './data/balance.ts';
import { playMatch, randomConfig, randomPicker } from './play.ts';
import { seedRng } from './rng.ts';
import type { BattleState } from './types.ts';

const START_SEED = 5005;
const MATCHES = 300;

function checkField(b: BattleState): void {
  let previousId = 0;
  const seen = new Set<number>();
  for (const u of b.units) {
    expect(u.id).toBeGreaterThan(previousId);
    previousId = u.id;
    expect(u.hp).toBeGreaterThan(0);
    expect(u.hp).toBeLessThanOrEqual(u.maxHp);
    expect(b.occ[u.layer * GRID_CELLS + u.ty * GRID_COLS + u.tx]).toBe(u.id);
    seen.add(u.id);
  }
  let occupied = 0;
  for (const id of b.occ) {
    if (id === 0) continue;
    occupied++;
    expect(seen.has(id)).toBe(true);
  }
  expect(occupied).toBe(b.units.length);
}

describe('robustness (SPEC 12)', () => {
  it(`${MATCHES} random matches run without errors and keep their invariants`, () => {
    const rng = seedRng(START_SEED, 0);
    for (let i = 0; i < MATCHES; i++) {
      const cfg = randomConfig(rng);
      let lives: [number, number] = [START_LIVES, START_LIVES];
      let rounds = 0;
      const state = playMatch(cfg, randomPicker(rng), (s) => {
        rounds++;
        const result = s.battle.result;
        expect(result, `match ${i}, seed ${cfg.seed}`).not.toBeNull();
        expect(result?.ticks).toBeLessThanOrEqual(TIME_LIMIT_TICKS);
        checkField(s.battle);
        // Lives only change in endRound; they never rise.
        expect(s.lives[0]).toBeLessThanOrEqual(lives[0]);
        expect(s.lives[1]).toBeLessThanOrEqual(lives[1]);
        lives = [s.lives[0], s.lives[1]];
      });
      expect(state.phase).toBe('finished');
      expect(state.rounds).toHaveLength(rounds);
      expect(rounds).toBeLessThanOrEqual(2 * START_LIVES - 1);
      let previous: [number, number] = [START_LIVES, START_LIVES];
      for (const r of state.rounds) {
        expect(r.lives[0]).toBeLessThanOrEqual(previous[0]);
        expect(r.lives[1]).toBeLessThanOrEqual(previous[1]);
        previous = r.lives;
      }
    }
  });
});
