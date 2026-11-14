/**
 * Whole-match helpers for tests, bots and the CLI: play, replay and random configs.
 * Built only on the public flow functions (createMatch, applyPick, simulateToEnd, endRound).
 */
import { simulateToEnd } from './battle/sim.ts';
import { CARD_IDS } from './data/cards.ts';
import { DECK_SIZE, MAX_LEVEL, OFFER_SIZE } from './data/balance.ts';
import { ALL_UPGRADES_MASK } from './data/upgrades.ts';
import { applyPick, createMatch, endRound, startBattle } from './match.ts';
import { nextInt, nextU32 } from './rng.ts';
import type { CardId, MatchConfig, MatchState, PlayerConfig, RngState } from './types.ts';

/** Chooses the slot (0..OFFER_SIZE-1) for the player whose pick is due. */
export type Picker = (state: MatchState) => number;

const TWO_POW_21 = 2097152;
const TWO_POW_32 = 4294967296;

/**
 * Plays a whole match. `onRound` is called after every battle, before `endRound`
 * (the state then holds `battle.result`).
 */
export function playMatch(
  cfg: MatchConfig,
  picker: Picker,
  onRound?: (state: MatchState) => void,
): MatchState {
  const state = createMatch(cfg);
  while (state.phase !== 'finished') {
    if (state.phase === 'draft') {
      applyPick(state, picker(state));
    } else {
      simulateToEnd(startBattle(state));
      if (onRound !== undefined) onRound(state);
      endRound(state);
    }
  }
  return state;
}

/** Picks every slot with equal probability. */
export function randomPicker(rng: RngState): Picker {
  return () => nextInt(rng, OFFER_SIZE);
}

/** Replays a stored pick list (like `state.picks`). Throws if picks are missing or left over. */
export function replayMatch(
  cfg: MatchConfig,
  picks: readonly number[],
  onRound?: (state: MatchState) => void,
): MatchState {
  let index = 0;
  const pick: Picker = () => {
    if (index >= picks.length) {
      throw new Error(`replayMatch: the pick list is too short (${picks.length} picks)`);
    }
    return picks[index++] as number;
  };
  const state = playMatch(cfg, pick, onRound);
  if (index < picks.length) {
    throw new Error(
      `replayMatch: ${picks.length - index} unused picks left (match used ${index} picks)`,
    );
  }
  return state;
}

function randomPlayer(rng: RngState): PlayerConfig {
  const pool: CardId[] = [...CARD_IDS];
  const deck: CardId[] = [];
  for (let i = 0; i < DECK_SIZE; i++)
    deck.push(pool.splice(nextInt(rng, pool.length), 1)[0] as CardId);
  const levels: Partial<Record<CardId, number>> = {};
  for (const card of deck) levels[card] = 1 + nextInt(rng, MAX_LEVEL);
  const upgrades: Partial<Record<CardId, number>> = {};
  for (const card of deck) upgrades[card] = nextInt(rng, ALL_UPGRADES_MASK + 1);
  return { deck, levels, upgrades };
}

/**
 * Random seed (up to 2^53 - 1), 4 distinct cards per player, random levels 1..MAX_LEVEL and
 * random unlocked upgrades (mask 0..7) per deck card.
 */
export function randomConfig(rng: RngState): MatchConfig {
  const seed = nextInt(rng, TWO_POW_21) * TWO_POW_32 + nextU32(rng);
  return { seed, players: [randomPlayer(rng), randomPlayer(rng)] };
}
