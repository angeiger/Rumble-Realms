import { describe, expect, it } from 'vitest';
import raw from './golden/replay.json';
import { GOLDEN_CONFIG, createGoldenReplay } from './golden.ts';
import type { GoldenReplay } from './golden.ts';
import { simulateToEnd } from './battle/sim.ts';
import { hashState } from './hash.ts';
import { applyPick, createMatch, endRound, startBattle } from './match.ts';
import { replayMatch } from './play.ts';
import { ENGINE_VERSION } from './version.ts';

const replay = raw as unknown as GoldenReplay;

const REGENERATE =
  'Only change it deliberately: raise ENGINE_VERSION in version.ts (D-006) and regenerate the file with ' +
  '"pnpm --silent sim golden > packages/engine/src/golden/replay.json" (then run prettier on it).';

describe('golden replay', () => {
  it('has the engine version of the stored file', () => {
    expect(
      replay.engineVersion,
      `The golden replay was recorded with engine version ${replay.engineVersion}, the engine is at ${ENGINE_VERSION}. ` +
        REGENERATE,
    ).toBe(ENGINE_VERSION);
  });

  it('covers 8 different cards with mixed levels', () => {
    const cards = replay.config.players.flatMap((p) => p.deck);
    expect(new Set(cards).size).toBe(8);
    const levels = new Set(replay.config.players.flatMap((p) => Object.values(p.levels)));
    expect(levels.size).toBeGreaterThanOrEqual(3);
  });

  it('contains double packs, upgrade cards and all six M3b units', () => {
    const state = createMatch(replay.config);
    const kinds = new Set<string>();
    let i = 0;
    while (state.phase !== 'finished') {
      if (state.phase === 'draft') {
        applyPick(state, replay.picks[i++] as number);
        kinds.add(state.lastPick?.kind ?? '');
      } else {
        simulateToEnd(startBattle(state));
        endRound(state);
      }
    }
    expect([...kinds].sort()).toEqual(['double', 'spawn', 'upgrade']);
    const played = new Set(state.army.map((e) => e.card));
    for (const card of ['pyromancer', 'necromancer', 'beetle', 'golem', 'frost_shaman', 'whelp']) {
      expect(played.has(card as never), card).toBe(true);
    }
  });

  it('replays to the stored hashes', () => {
    const roundHashes: string[] = [];
    const state = replayMatch(replay.config, replay.picks, (s) => {
      roundHashes.push(hashState(s));
    });
    const hint = `The engine result changed. ${REGENERATE}`;
    expect(roundHashes, `Round hashes differ from the golden replay. ${hint}`).toEqual(
      replay.roundHashes,
    );
    expect(hashState(state), `Final hash differs from the golden replay. ${hint}`).toBe(
      replay.finalHash,
    );
    expect(state.winner).toBe(replay.winner);
    expect(state.picks).toEqual(replay.picks);
  });

  it('the stored file belongs to the current golden definition', () => {
    expect(replay.config).toEqual(GOLDEN_CONFIG);
    expect(createGoldenReplay()).toEqual(replay);
  });
});
