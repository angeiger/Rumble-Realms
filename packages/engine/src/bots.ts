/**
 * Bot decisions (SPEC 8.1). A bot only chooses a slot of the offer; applying it is up to
 * the caller. Random numbers come from the caller's own stream, so a bot never shifts the
 * match streams. Medium and hard bots follow in M3: add the level to `BotLevelId` and a
 * function to `STRATEGIES`.
 */
import type { BotLevelId } from './data/bots.ts';
import { getOffer } from './match.ts';
import { nextInt } from './rng.ts';
import type { MatchState, Offer, RngState } from './types.ts';

/** Stream number for bot decisions; 1..4 are used by the match (rng.ts). */
export const STREAM_BOT = 5;

type Strategy = (state: MatchState, offer: Offer, rng: RngState) => number;

const STRATEGIES: Record<BotLevelId, Strategy> = {
  /** Easy: every slot with equal probability. */
  easy: (_state, offer, rng) => nextInt(rng, offer.slots.length),
};

/** Slot (index into the current offer) the bot picks. Throws outside the draft. */
export function chooseBotPick(state: MatchState, level: BotLevelId, rng: RngState): number {
  const offer = getOffer(state);
  const strategy = Object.hasOwn(STRATEGIES, level) ? STRATEGIES[level] : undefined;
  if (strategy === undefined) throw new Error(`chooseBotPick: unknown bot level ${String(level)}`);
  return strategy(state, offer, rng);
}
