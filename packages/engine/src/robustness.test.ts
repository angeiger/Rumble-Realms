import { describe, expect, it } from 'vitest';
import { GRID_CELLS, GRID_COLS, START_LIVES, TIME_LIMIT_TICKS } from './data/balance.ts';
import { playMatch, randomConfig, randomPicker } from './play.ts';
import { seedRng } from './rng.ts';
import type { BattleState, MatchState } from './types.ts';

const START_SEED = 5005;
const MATCHES = 100;
/** Growing armies (D-046) make late rounds long; the default 5 s are far too short. */
const TIMEOUT_MS = 180_000;

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

/** Army ids are unique and ascending; every unit on the field belongs to the army. */
function checkArmy(s: MatchState): void {
  const ids = s.army.flatMap((e) => e.unitIds);
  for (let i = 1; i < ids.length; i++) expect(ids[i]).toBeGreaterThan(ids[i - 1] as number);
  expect(s.nextUnitId).toBeGreaterThan(ids[ids.length - 1] ?? 0);
  const owner = new Map<number, number>();
  for (const e of s.army) for (const id of e.unitIds) owner.set(id, e.player);
  for (const u of s.battle.units) expect(owner.get(u.id)).toBe(u.owner);
  // Every round adds the cards of its draft to those of all earlier rounds.
  expect(s.army.filter((e) => e.round === s.round)).toHaveLength(s.draft.order.length);
}

describe('robustness (SPEC 12)', () => {
  it(
    `${MATCHES} random matches run without errors and keep their invariants`,
    () => {
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
          checkArmy(s);
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
    },
    TIMEOUT_MS,
  );
});
