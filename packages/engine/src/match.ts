/**
 * Match flow: lives, rounds, draft order, offers and the growing army (SPEC 4.2, 4.3,
 * D-020, D-046, D-053).
 *
 * The state is mutated in place (D-019). Random numbers come from separate streams
 * (D-029): coin flips from `match`, offers from `offers`, center columns from `placement`,
 * so e.g. a different placement never changes the offers.
 */
import { createBattle } from './battle/state.ts';
import {
  DECK_SIZE,
  GRID_COLS,
  LOSER_BONUS_PICKS,
  MAX_LEVEL,
  OFFER_SIZE,
  PICKS_PER_ROUND,
  START_LIVES,
} from './data/balance.ts';
import { CARDS } from './data/cards.ts';
import { rebuildField } from './placement.ts';
import {
  nextInt,
  seedRng,
  shuffle,
  STREAM_BATTLE,
  STREAM_MATCH,
  STREAM_OFFERS,
  STREAM_PLACEMENT,
} from './rng.ts';
import type {
  ArmyEntry,
  BattleState,
  CardId,
  MatchConfig,
  MatchState,
  Offer,
  PlayerConfig,
  PlayerIndex,
  RoundOutcome,
} from './types.ts';
import { ENGINE_VERSION } from './version.ts';

function isCardId(value: unknown): value is CardId {
  return typeof value === 'string' && Object.hasOwn(CARDS, value);
}

function validatePlayer(p: PlayerConfig, index: number): PlayerConfig {
  const who = `player ${index}`;
  if (p === null || typeof p !== 'object') throw new Error(`createMatch: ${who} is missing`);
  if (!Array.isArray(p.deck) || p.deck.length !== DECK_SIZE) {
    throw new Error(`createMatch: ${who} needs exactly ${DECK_SIZE} cards in the deck`);
  }
  const deck: CardId[] = [];
  for (const card of p.deck as unknown[]) {
    if (!isCardId(card)) throw new Error(`createMatch: ${who} has unknown card ${String(card)}`);
    if (deck.includes(card)) throw new Error(`createMatch: ${who} has ${card} twice in the deck`);
    deck.push(card);
  }
  if (p.levels === null || typeof p.levels !== 'object' || Array.isArray(p.levels)) {
    throw new Error(`createMatch: ${who} levels must be an object`);
  }
  const levels: Partial<Record<CardId, number>> = {};
  for (const [card, level] of Object.entries(p.levels) as [string, unknown][]) {
    if (!isCardId(card))
      throw new Error(`createMatch: ${who} has a level for unknown card ${card}`);
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
      throw new Error(
        `createMatch: ${who} level of ${card} must be an integer 1..${MAX_LEVEL}, got ${String(level)}`,
      );
    }
    levels[card] = level;
  }
  return { deck, levels };
}

/** Pick order of a round: alternating, `first` begins; leftover picks go to the end. */
export function draftOrder(
  first: PlayerIndex,
  firstPicks: number,
  secondPicks: number,
): PlayerIndex[] {
  const second: PlayerIndex = first === 0 ? 1 : 0;
  const order: PlayerIndex[] = [];
  let a = firstPicks;
  let b = secondPicks;
  while (a > 0 || b > 0) {
    if (a > 0) {
      order.push(first);
      a--;
    }
    if (b > 0) {
      order.push(second);
      b--;
    }
  }
  return order;
}

function coinFlip(state: MatchState): PlayerIndex {
  return nextInt(state.rng.match, 2) === 0 ? 0 : 1;
}

/**
 * Draws the offer for the pick that is due: OFFER_SIZE distinct deck cards in random slot
 * order. Shuffles a copy of the whole deck, so every offer uses DECK_SIZE - 1 draws.
 */
function makeOffer(state: MatchState): Offer {
  const player = state.draft.order[state.draft.pickIndex] as PlayerIndex;
  const cards = [...state.config.players[player].deck];
  shuffle(state.rng.offers, cards);
  return {
    player,
    slots: cards.slice(0, OFFER_SIZE).map((card) => ({ kind: 'spawn', card })),
  };
}

/** Validates the config and sets up round 1 (coin flip, draft order, first offer, empty field). */
export function createMatch(cfg: MatchConfig): MatchState {
  if (cfg === null || typeof cfg !== 'object') throw new Error('createMatch: config is missing');
  if (!Number.isSafeInteger(cfg.seed) || cfg.seed < 0) {
    throw new Error(`createMatch: seed must be a non-negative safe integer, got ${cfg.seed}`);
  }
  if (!Array.isArray(cfg.players) || cfg.players.length !== 2) {
    throw new Error('createMatch: exactly two players are required');
  }
  const config: MatchConfig = {
    seed: cfg.seed,
    players: [validatePlayer(cfg.players[0], 0), validatePlayer(cfg.players[1], 1)],
  };
  const seed = config.seed;
  const state: MatchState = {
    engineVersion: ENGINE_VERSION,
    config,
    phase: 'draft',
    round: 1,
    lives: [START_LIVES, START_LIVES],
    draft: { order: [], pickIndex: 0, offer: null },
    picks: [],
    lastPick: null,
    rounds: [],
    rng: {
      match: seedRng(seed, STREAM_MATCH),
      offers: seedRng(seed, STREAM_OFFERS),
      placement: seedRng(seed, STREAM_PLACEMENT),
    },
    army: [],
    nextUnitId: 1,
    battle: createBattle(seedRng(seed, STREAM_BATTLE)),
    winner: null,
  };
  state.draft.order = draftOrder(coinFlip(state), PICKS_PER_ROUND, PICKS_PER_ROUND);
  state.draft.offer = makeOffer(state);
  return state;
}

function requireDraft(state: MatchState, fn: string): Offer {
  if (state.phase !== 'draft' || state.draft.offer === null) {
    throw new Error(`${fn}: only possible during the draft (phase is ${state.phase})`);
  }
  return state.draft.offer;
}

/** The player whose pick is due. Throws outside the draft. */
export function currentPlayer(state: MatchState): PlayerIndex {
  return requireDraft(state, 'currentPlayer').player;
}

/** Picks `player` still has in the current draft; 0 outside the draft. */
export function picksRemaining(state: MatchState, player: PlayerIndex): number {
  if (state.phase !== 'draft') return 0;
  let n = 0;
  for (let i = state.draft.pickIndex; i < state.draft.order.length; i++) {
    if (state.draft.order[i] === player) n++;
  }
  return n;
}

/** The cards on offer for the player whose pick is due. Throws outside the draft. */
export function getOffer(state: MatchState): Offer {
  return requireDraft(state, 'getOffer');
}

/**
 * Plays the card in `slot` of the current offer: adds it to the army with a random center
 * column (exactly one draw of the placement stream, D-030) and fresh unit ids, sets up the
 * whole field again (D-052), records the pick and moves on. After the last pick of the
 * round the phase switches to `battle`.
 */
export function applyPick(state: MatchState, slot: number): MatchState {
  const offer = requireDraft(state, 'applyPick');
  if (!Number.isInteger(slot) || slot < 0 || slot >= offer.slots.length) {
    throw new Error(`applyPick: slot must be an integer 0..${offer.slots.length - 1}, got ${slot}`);
  }
  const player = offer.player;
  const card = (offer.slots[slot] as Offer['slots'][number]).card;
  const level = state.config.players[player].levels[card] ?? 1;
  const column = nextInt(state.rng.placement, GRID_COLS);
  // Never hand out an id twice, even if the field numbered units beyond the match counter.
  let nextId = Math.max(state.nextUnitId, state.battle.nextUnitId);
  const unitIds: number[] = [];
  for (let i = 0; i < CARDS[card].count; i++) unitIds.push(nextId++);
  state.nextUnitId = nextId;
  const entry: ArmyEntry = { player, card, level, column, round: state.round, unitIds };
  state.army.push(entry);
  const forfeited = rebuildField(state);
  const spawned = unitIds.filter((id) => !forfeited.includes(id));
  state.lastPick = { player, slot, card, spawned, forfeited: unitIds.length - spawned.length };
  state.picks.push(slot);
  state.draft.pickIndex++;
  if (state.draft.pickIndex >= state.draft.order.length) {
    state.phase = 'battle';
    state.draft.offer = null;
  } else {
    state.draft.offer = makeOffer(state);
  }
  return state;
}

/** The field to simulate. Throws unless all picks of the round are done. */
export function startBattle(state: MatchState): BattleState {
  if (state.phase !== 'battle') {
    throw new Error(`startBattle: the draft is not finished (phase is ${state.phase})`);
  }
  return state.battle;
}

/**
 * Books the finished battle: the loser (both on a draw) loses a life. Ends the match when
 * somebody is out of lives (the last field stays), otherwise prepares the next round: a new
 * field with the whole army of both players at full hit points (D-053), loser bonus (or a
 * new coin flip after a draw) and the first offer.
 */
export function endRound(state: MatchState): MatchState {
  if (state.phase !== 'battle') {
    throw new Error(`endRound: no battle in progress (phase is ${state.phase})`);
  }
  const result = state.battle.result;
  if (result === null) throw new Error('endRound: the battle has no result yet');

  const lives: [number, number] = [state.lives[0], state.lives[1]];
  if (result.winner === 'draw') {
    lives[0]--;
    lives[1]--;
  } else {
    lives[result.winner === 0 ? 1 : 0]--;
  }
  lives[0] = Math.max(0, lives[0]);
  lives[1] = Math.max(0, lives[1]);
  state.lives = lives;
  const outcome: RoundOutcome = {
    round: state.round,
    result: { ...result, hp: [result.hp[0], result.hp[1]] },
    lives: [lives[0], lives[1]],
  };
  state.rounds.push(outcome);
  // Ids the battle handed out itself (e.g. summoned units, M3b) must never come back.
  state.nextUnitId = Math.max(state.nextUnitId, state.battle.nextUnitId);

  if (lives[0] === 0 || lives[1] === 0) {
    state.phase = 'finished';
    state.winner = lives[0] === 0 && lives[1] === 0 ? 'draw' : lives[0] === 0 ? 1 : 0;
    state.draft.offer = null;
    return state;
  }

  state.round++;
  // Continue the battle stream, so every round would get fresh battle random numbers.
  state.battle = createBattle(state.battle.rng);
  rebuildField(state);
  if (result.winner === 'draw') {
    state.draft.order = draftOrder(coinFlip(state), PICKS_PER_ROUND, PICKS_PER_ROUND);
  } else {
    const loser: PlayerIndex = result.winner === 0 ? 1 : 0;
    state.draft.order = draftOrder(loser, PICKS_PER_ROUND + LOSER_BONUS_PICKS, PICKS_PER_ROUND);
  }
  state.draft.pickIndex = 0;
  state.phase = 'draft';
  state.lastPick = null;
  state.draft.offer = makeOffer(state);
  return state;
}
