/**
 * Golden replay: a fixed match whose hashes are stored in `golden/replay.json`.
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

/**
 * Two decks of four cards each: the six M3b units plus skeletons and TNT, mixed levels and
 * unlocked upgrades. With these picks the match contains double packs and four upgrade
 * cards (golden.test.ts checks that).
 */
export const GOLDEN_CONFIG: MatchConfig = {
  seed: 20261114,
  players: [
    {
      deck: ['necromancer', 'beetle', 'skeleton', 'tnt'],
      levels: { necromancer: 3, beetle: 2, skeleton: 1, tnt: 4 },
      upgrades: { skeleton: 7, tnt: 7, necromancer: 7 },
    },
    {
      deck: ['pyromancer', 'frost_shaman', 'whelp', 'golem'],
      levels: { pyromancer: 2, frost_shaman: 5, whelp: 1, golem: 3 },
      upgrades: { whelp: 7, golem: 7 },
    },
  ],
};

/** Seed of the random picks of the golden match. */
export const GOLDEN_PICK_SEED = 10;

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
