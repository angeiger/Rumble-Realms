/**
 * Match flow: lives, rounds, draft order, offers with special cards, upgrades and the
 * growing army (SPEC 4.2, 4.3, 4.5, D-020, D-046, D-053).
 *
 * The state is mutated in place (D-019). Random numbers come from separate streams
 * (D-029): coin flips from `match`, offers from `offers`, the battle from its own
 * stream. The formation is not random (D-070).
 */
import { createBattle } from './battle/state.ts';
import {
  DECK_SIZE,
  LOSER_BONUS_PICKS,
  MAX_LEVEL,
  OFFER_SIZE,
  PICKS_PER_ROUND,
  START_LIVES,
} from './data/balance.ts';
import { CARDS } from './data/cards.ts';
import {
  DOUBLE_CHANCE_BPS,
  MAX_SPECIALS_PER_OFFER,
  SPECIAL_ROLL_RANGE,
  UPGRADE_CHANCE_BPS,
  UPGRADE_ROLL_RANGE,
} from './data/specials.ts';
import { ALL_UPGRADES_MASK } from './data/upgrades.ts';
import { rebuildField } from './placement.ts';
import { nextInt, seedRng, shuffle, STREAM_BATTLE, STREAM_MATCH, STREAM_OFFERS } from './rng.ts';
import type {
  ArmyEntry,
  BattleState,
  CardId,
  MatchConfig,
  MatchState,
  Offer,
  OfferSlot,
  PickInfo,
  PlayerConfig,
  PlayerIndex,
  RoundOutcome,
} from './types.ts';
import { selectableUpgrades, unitCount } from './upgrades.ts';
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
  const result: PlayerConfig = { deck, levels };
  if (p.upgrades !== undefined) {
    if (p.upgrades === null || typeof p.upgrades !== 'object' || Array.isArray(p.upgrades)) {
      throw new Error(`createMatch: ${who} upgrades must be an object`);
    }
    const upgrades: Partial<Record<CardId, number>> = {};
    for (const [card, mask] of Object.entries(p.upgrades) as [string, unknown][]) {
      if (!isCardId(card)) {
        throw new Error(`createMatch: ${who} has upgrades for unknown card ${card}`);
      }
      if (
        typeof mask !== 'number' ||
        !Number.isInteger(mask) ||
        mask < 0 ||
        mask > ALL_UPGRADES_MASK
      ) {
        throw new Error(
          `createMatch: ${who} upgrades of ${card} must be a bit mask 0..${ALL_UPGRADES_MASK}, got ${String(mask)}`,
        );
      }
      upgrades[card] = mask;
    }
    result.upgrades = upgrades;
  }
  return result;
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
 * Draws the offer for the pick that is due (SPEC 4.3): OFFER_SIZE distinct deck cards in
 * random slot order (a shuffled copy of the whole deck: DECK_SIZE - 1 draws), then exactly
 * two draws per slot, used or not: the kind roll (below DOUBLE_CHANCE_BPS a double pack,
 * below DOUBLE_CHANCE_BPS + UPGRADE_CHANCE_BPS an upgrade card) and the upgrade roll (index
 * into the selectable upgrades, modulo their number). Without a selectable upgrade the slot
 * stays a normal card; after MAX_SPECIALS_PER_OFFER special cards all further slots do.
 * So every offer uses the same number of draws and never depends on the field.
 */
function makeOffer(state: MatchState): Offer {
  const player = state.draft.order[state.draft.pickIndex] as PlayerIndex;
  const rng = state.rng.offers;
  const cfg = state.config.players[player];
  const cards = [...cfg.deck];
  shuffle(rng, cards);
  const unlocked = cfg.upgrades ?? {};
  const active = state.activeUpgrades[player];
  const slots: OfferSlot[] = [];
  let specials = 0;
  for (const card of cards.slice(0, OFFER_SIZE)) {
    const kindRoll = nextInt(rng, SPECIAL_ROLL_RANGE);
    const upgradeRoll = nextInt(rng, UPGRADE_ROLL_RANGE);
    let slot: OfferSlot = { kind: 'spawn', card };
    if (specials < MAX_SPECIALS_PER_OFFER) {
      if (kindRoll < DOUBLE_CHANCE_BPS) {
        slot = { kind: 'double', card };
      } else if (kindRoll < DOUBLE_CHANCE_BPS + UPGRADE_CHANCE_BPS) {
        const options = selectableUpgrades(card, unlocked[card] ?? 0, active[card] ?? 0);
        const upgrade = options[upgradeRoll % Math.max(1, options.length)];
        if (upgrade !== undefined) slot = { kind: 'upgrade', card, upgrade };
      }
    }
    if (slot.kind !== 'spawn') specials++;
    slots.push(slot);
  }
  return { player, slots };
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
    },
    army: [],
    activeUpgrades: [{}, {}],
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
 * Plays the card in `slot` of the current offer and moves on; after the last pick of the
 * round the phase switches to `battle`.
 * - normal card / double pack: adds it to the army; a double pack has twice the units
 *   (SPEC 4.5).
 * - upgrade card: activates the upgrade for the rest of the match (SPEC 4.5); no new army
 *   entry.
 * Then every army entry gets fresh unit ids up to its current unit count (new cards, or
 * more units through an upgrade) and the whole field is set up again (D-070).
 */
export function applyPick(state: MatchState, slot: number): MatchState {
  const offer = requireDraft(state, 'applyPick');
  if (!Number.isInteger(slot) || slot < 0 || slot >= offer.slots.length) {
    throw new Error(`applyPick: slot must be an integer 0..${offer.slots.length - 1}, got ${slot}`);
  }
  const player = offer.player;
  const chosen = offer.slots[slot] as OfferSlot;
  const card = chosen.card;
  if (chosen.kind === 'upgrade') {
    const active = state.activeUpgrades[player];
    active[card] = (active[card] ?? 0) | (1 << chosen.upgrade);
  } else {
    const entry: ArmyEntry = {
      player,
      card,
      level: state.config.players[player].levels[card] ?? 1,
      round: state.round,
      double: chosen.kind === 'double',
      unitIds: [],
    };
    state.army.push(entry);
  }
  const added = reserveUnitIds(state);
  const forfeited = rebuildField(state);
  const spawned = added.filter((id) => !forfeited.includes(id));
  const pick: PickInfo = {
    player,
    slot,
    kind: chosen.kind,
    card,
    spawned,
    forfeited: added.length - spawned.length,
  };
  if (chosen.kind === 'upgrade') pick.upgrade = chosen.upgrade;
  state.lastPick = pick;
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

/**
 * Gives every army entry as many unit ids as it needs now (`unitCount` with the owner's
 * active upgrades), in army order, with fresh ids that were never used in this match.
 * Returns the new ids in the order they were handed out.
 */
function reserveUnitIds(state: MatchState): number[] {
  // Never hand out an id twice, even if the field numbered units beyond the match counter.
  let nextId = Math.max(state.nextUnitId, state.battle.nextUnitId);
  const added: number[] = [];
  for (const entry of state.army) {
    const mask = state.activeUpgrades[entry.player][entry.card] ?? 0;
    const need = unitCount(entry.card, mask, entry.double);
    while (entry.unitIds.length < need) {
      entry.unitIds.push(nextId);
      added.push(nextId++);
    }
  }
  state.nextUnitId = nextId;
  return added;
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
