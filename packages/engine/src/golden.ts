/**
 * Golden replay: a fixed match whose hashes are stored in `golden/replay-v1.json`.
 * The file is regenerated with `pnpm sim golden` (see golden.test.ts).
 */
import { hashState } from './hash.ts';
import { playMatch, randomPicker } from './play.ts';
import { seedRng } from './rng.ts';
import type { MatchConfig, Winner } from './types.ts';
import { ENGINE_VERSION } from './version.ts';

export interface GoldenReplay {
  engineVersion: number;
  config: MatchConfig;
  picks: number[];
  /** `hashState` of the match after each battle, before `endRound`. */
  roundHashes: string[];
  finalHash: string;
  winner: Winner;
}

/** Two decks of four cards each; together 8 of the 10 cards (all special mechanics), mixed levels. */
export const GOLDEN_CONFIG: MatchConfig = {
  seed: 20261114,
  players: [
    {
      deck: ['berserker', 'healer', 'tnt', 'bat'],
      levels: { berserker: 3, healer: 2, tnt: 1, bat: 5 },
    },
    {
      deck: ['assassin', 'shroomling', 'musketeer', 'knight'],
      levels: { assassin: 4, shroomling: 2, musketeer: 5, knight: 1 },
    },
  ],
};

/** Seed of the random picks of the golden match. */
export const GOLDEN_PICK_SEED = 7;

/** Plays the golden match with the current engine and records everything the test compares. */
export function createGoldenReplay(): GoldenReplay {
  const roundHashes: string[] = [];
  const state = playMatch(
    GOLDEN_CONFIG,
    randomPicker(seedRng(GOLDEN_PICK_SEED, 0)),
    (s) => void roundHashes.push(hashState(s)),
  );
  return {
    engineVersion: ENGINE_VERSION,
    config: GOLDEN_CONFIG,
    picks: state.picks,
    roundHashes,
    finalHash: hashState(state),
    winner: state.winner as Winner,
  };
}
