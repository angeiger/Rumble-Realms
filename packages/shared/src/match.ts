/**
 * Bot matches of M4 (SPEC 8.1, 14.2, D-084): building the match from the server's ticket,
 * the bot's decision and the server's check of a reported match.
 *
 * Client and server run exactly the same code: the client plays the bot with `nextBotPick`,
 * the server replays the reported picks with `verifyBotMatch`. Every bot decision has its own
 * random stream (`botPickRng`), so the server can recompute any single decision without the
 * ones before it, and check only a share of the expensive hard decisions.
 *
 * No runtime dependencies besides the engine; runs in the browser, in Node and in Deno.
 */
import {
  applyPick,
  BOT_LEVELS,
  BOT_PROFILES,
  botPickRng,
  chooseBotPick,
  cloneMatchState,
  createMatch,
  endRound,
  ENGINE_VERSION,
  getOffer,
  OFFER_SIZE,
  simulateToEnd,
  startBattle,
  upgradesForLevel,
} from '../../engine/src/index.ts';
import type {
  BotLevelId,
  BotProfile,
  CardId,
  MatchConfig,
  MatchState,
  PlayerConfig,
  PlayerIndex,
  Winner,
} from '../../engine/src/index.ts';
import { HARD_CHECK_MAX, MAX_REPORTED_PICKS, VERIFY_BUDGET_MS } from './data/server.ts';
import type { MatchOutcome, MatchTicket } from './protocol.ts';

/** The human is always engine player 0, the bot player 1 (MatchTicket). */
export const HUMAN: PlayerIndex = 0;
export const BOT: PlayerIndex = 1;

/** Uniform integer in [0, n); the caller's source of randomness (server: crypto). */
export type RandomInt = (n: number) => number;

// ---------------------------------------------------------------------------
// Profiles and match setup
// ---------------------------------------------------------------------------

/** The bot profile with this id, or null. */
export function botProfileOf(id: string): BotProfile | null {
  if (typeof id !== 'string') return null;
  return BOT_PROFILES.find((p) => p.id === id) ?? null;
}

/**
 * Engine setup of a bot: the profile's deck, every card at the card level of its bot level
 * and with every upgrade that level allows (D-073).
 */
export function botPlayerConfig(profile: BotProfile): PlayerConfig {
  const level = BOT_LEVELS[profile.level].cardLevel;
  const mask = upgradesForLevel(level);
  const levels: Partial<Record<CardId, number>> = {};
  const upgrades: Partial<Record<CardId, number>> = {};
  for (const card of profile.deck) {
    levels[card] = level;
    upgrades[card] = mask;
  }
  return { deck: [...profile.deck], levels, upgrades };
}

/** A random profile of `level`. Throws if the level has no profile or `randInt` is out of range. */
export function pickBotProfile(level: BotLevelId, randInt: RandomInt): BotProfile {
  const candidates = BOT_PROFILES.filter((p) => p.level === level);
  if (candidates.length === 0) throw new Error(`pickBotProfile: no profile for level ${level}`);
  const i = randInt(candidates.length);
  const profile = Number.isInteger(i) ? candidates[i] : undefined;
  if (profile === undefined) throw new Error(`pickBotProfile: randInt returned ${i}`);
  return profile;
}

/**
 * Engine config of a ticket (human = player 0, bot = player 1), or null if the ticket names
 * an unknown profile or one of another level than `ticket.botLevel`. Seed and the human's
 * setup are checked by `createMatch`.
 */
export function matchConfigOf(ticket: MatchTicket): MatchConfig | null {
  const profile = botProfileOf(ticket.botProfile);
  if (profile === null || profile.level !== ticket.botLevel) return null;
  const human = ticket.player;
  const player: PlayerConfig = { deck: [...human.deck], levels: { ...human.levels } };
  if (human.upgrades !== undefined) player.upgrades = { ...human.upgrades };
  return { seed: ticket.seed, players: [player, botPlayerConfig(profile)] };
}

/** Result of the match from the human's point of view. */
export function outcomeOf(winner: Winner): MatchOutcome {
  if (winner === 'draw') return 'draw';
  return winner === HUMAN ? 'win' : 'loss';
}

/**
 * The bot's slot for the pick that is due: its strategy with the stream of exactly this
 * decision (`botPickRng(seed, state.picks.length)`). Client and server both use this
 * function. Does not change `state`. Throws outside the draft.
 */
export function nextBotPick(state: MatchState, ticket: MatchTicket): number {
  return chooseBotPick(state, ticket.botLevel, botPickRng(ticket.seed, state.picks.length));
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface BotCheckInfo {
  /** Index of the pick in the match (into `picks`). */
  pickIndex: number;
  /** Number of bot decisions before this one (0 = the bot's first pick). */
  botDecision: number;
  /** Milliseconds since `verifyBotMatch` started, by `now`. */
  elapsedMs: number;
}

/**
 * Checks a random sample of the bot's decisions after the replay (for expensive bots): the
 * replay keeps a copy of the state before every bot decision, then the decisions are checked
 * in random order (`randInt` shuffles) until `maxChecks` are done or `budgetMs` have passed
 * since `verifyBotMatch` started. The budget is looked at before every check, but the first
 * check always runs (if the bot made a decision and `maxChecks` >= 1). Every decision of the
 * match has the same chance, early or late.
 */
export interface SampleCheck {
  randInt: RandomInt;
  budgetMs: number;
  maxChecks: number;
}

export interface VerifyOptions {
  /**
   * Whether this bot decision is recomputed and compared, asked in pick order during the
   * replay. Default: every decision. Ignored with `sample`.
   */
  check?: (info: BotCheckInfo) => boolean;
  /** Check a random sample after the replay instead (see SampleCheck). */
  sample?: SampleCheck;
  /** Clock in milliseconds for `elapsedMs` and the budget. Default: always 0. */
  now?: () => number;
}

export type VerifyFailure = 'bad_picks' | 'incomplete' | 'leftover' | 'bot_mismatch' | 'bad_ticket';

export type VerifyResult =
  | {
      ok: true;
      winner: Winner;
      outcome: MatchOutcome;
      rounds: number;
      /** Bot decisions in the match. */
      botPicks: number;
      /** Bot decisions that were recomputed and matched. */
      botPicksChecked: number;
    }
  | { ok: false; reason: VerifyFailure; detail: string };

function fail(reason: VerifyFailure, detail: string): VerifyResult {
  return { ok: false, reason, detail };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mismatch(pickIndex: number, expected: number, reported: number): VerifyResult {
  return fail('bot_mismatch', `pick ${pickIndex}: the bot picks ${expected}, reported ${reported}`);
}

/** A bot decision kept for the sample check: the state before it and the reported slot. */
interface KeptDecision {
  pickIndex: number;
  slot: number;
  state: MatchState;
}

/**
 * Checks `kept` in random order (partial Fisher-Yates with `plan.randInt`) until
 * `plan.maxChecks` are done or the budget is used up; the first check always runs. Returns
 * the number of matching checks, or the failure of the first mismatch.
 */
function checkSample(
  kept: KeptDecision[],
  ticket: MatchTicket,
  plan: SampleCheck,
  elapsed: () => number,
): number | VerifyResult {
  const limit = Math.min(kept.length, Math.max(0, plan.maxChecks));
  let checked = 0;
  for (let k = 0; k < limit; k++) {
    if (k > 0 && elapsed() > plan.budgetMs) break;
    const r = plan.randInt(kept.length - k);
    if (!Number.isInteger(r) || r < 0 || r >= kept.length - k) {
      throw new Error(`sample check: randInt returned ${r}`);
    }
    const chosen = kept[k + r] as KeptDecision;
    kept[k + r] = kept[k] as KeptDecision;
    kept[k] = chosen;
    const expected = nextBotPick(chosen.state, ticket);
    if (expected !== chosen.slot) return mismatch(chosen.pickIndex, expected, chosen.slot);
    checked++;
  }
  return checked;
}

/**
 * Replays a reported bot match and checks it:
 * - `picks` is an array of at most MAX_REPORTED_PICKS integers 0..OFFER_SIZE-1 (`bad_picks`),
 * - the ticket gives a valid match of this engine version (`bad_ticket`),
 * - every pick is a slot of the offer that is due (`bad_picks`),
 * - the match is finished after the last pick (`incomplete`) and no picks are left
 *   (`leftover`),
 * - the checked bot decisions equal `nextBotPick` (`bot_mismatch`): without options all of
 *   them, else those `options.check` selects during the replay, or with `options.sample` a
 *   random sample after the replay.
 * Never throws: an engine error during the replay (or an invalid callback result) is
 * reported as `bad_picks`.
 */
export function verifyBotMatch(
  ticket: MatchTicket,
  picks: unknown,
  options?: VerifyOptions,
): VerifyResult {
  if (!Array.isArray(picks)) return fail('bad_picks', 'picks must be an array');
  if (picks.length > MAX_REPORTED_PICKS) {
    return fail('bad_picks', `more than ${MAX_REPORTED_PICKS} picks (${picks.length})`);
  }
  const slots: number[] = [];
  for (const [i, pick] of (picks as unknown[]).entries()) {
    if (typeof pick !== 'number' || !Number.isInteger(pick) || pick < 0 || pick >= OFFER_SIZE) {
      return fail('bad_picks', `pick ${i} must be an integer 0..${OFFER_SIZE - 1}`);
    }
    slots.push(pick);
  }

  let state: MatchState;
  try {
    if (ticket === null || typeof ticket !== 'object') return fail('bad_ticket', 'no ticket');
    if (ticket.engineVersion !== ENGINE_VERSION) {
      return fail(
        'bad_ticket',
        `ticket of engine version ${String(ticket.engineVersion)}, this is ${ENGINE_VERSION}`,
      );
    }
    const cfg = matchConfigOf(ticket);
    if (cfg === null) {
      return fail(
        'bad_ticket',
        `unknown bot profile ${String(ticket.botProfile)} for level ${String(ticket.botLevel)}`,
      );
    }
    state = createMatch(cfg);
  } catch (error) {
    return fail('bad_ticket', message(error));
  }

  const sample = options?.sample;
  const check = options?.check ?? (() => true);
  const now = options?.now ?? (() => 0);
  /** Sample mode: the states before the bot decisions (only those are copied). */
  const kept: KeptDecision[] = [];
  let index = 0;
  let botPicks = 0;
  let botPicksChecked = 0;
  try {
    const start = now();
    const elapsed = (): number => now() - start;
    while (state.phase !== 'finished') {
      if (state.phase !== 'draft') {
        simulateToEnd(startBattle(state));
        endRound(state);
        continue;
      }
      const slot = slots[index];
      if (slot === undefined) {
        return fail('incomplete', `the match needs more than ${slots.length} picks`);
      }
      const offer = getOffer(state);
      if (slot >= offer.slots.length) {
        return fail('bad_picks', `pick ${index}: slot ${slot} is not on offer`);
      }
      if (offer.player === BOT) {
        if (sample !== undefined) {
          if (sample.maxChecks > 0) {
            kept.push({ pickIndex: index, slot, state: cloneMatchState(state) });
          }
        } else if (check({ pickIndex: index, botDecision: botPicks, elapsedMs: elapsed() })) {
          const expected = nextBotPick(state, ticket);
          if (expected !== slot) return mismatch(index, expected, slot);
          botPicksChecked++;
        }
        botPicks++;
      }
      applyPick(state, slot);
      index++;
    }
    if (index < slots.length) {
      return fail('leftover', `${slots.length - index} picks after the end of the match`);
    }
    if (sample !== undefined) {
      const sampled = checkSample(kept, ticket, sample, elapsed);
      if (typeof sampled !== 'number') return sampled;
      botPicksChecked = sampled;
    }
  } catch (error) {
    return fail('bad_picks', `pick ${index}: ${message(error)}`);
  }

  const winner = state.winner;
  if (winner === null) return fail('bad_picks', 'finished match without a winner');
  return {
    ok: true,
    winner,
    outcome: outcomeOf(winner),
    rounds: state.rounds.length,
    botPicks,
    botPicksChecked,
  };
}

/**
 * The server's check plan (D-084): every decision of the easy and medium bots, in one pass
 * (they are cheap). The hard bot (and any other, future level) is checked by a random sample
 * after the replay: at most HARD_CHECK_MAX decisions, in random order, none started after
 * VERIFY_BUDGET_MS, but always at least one.
 */
export function serverCheckPolicy(
  level: BotLevelId,
  randInt: RandomInt,
  now: () => number,
): VerifyOptions {
  if (level === 'easy' || level === 'medium') return { check: () => true, now };
  return { sample: { randInt, budgetMs: VERIFY_BUDGET_MS, maxChecks: HARD_CHECK_MAX }, now };
}
