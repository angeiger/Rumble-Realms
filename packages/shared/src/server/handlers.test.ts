import { describe, expect, it } from 'vitest';
import {
  ALL_UPGRADES_MASK,
  applyPick,
  BOT_LEVELS,
  BOT_PROFILES,
  CARDS,
  createMatch,
  ELO,
  endRound,
  ENGINE_VERSION,
  FREE_RENAMES,
  getOffer,
  JOKERS_PER_COPY,
  LEVEL_UP_COSTS,
  LOSS_GOLD,
  MAX_LEVEL,
  nextInt,
  OFFER_SIZE,
  seedRng,
  simulateToEnd,
  STARTER_DECK,
  startBattle,
  UPGRADE_UNLOCK_GOLD,
  UPGRADE_UNLOCK_LEVELS,
  WELCOME_PACK,
} from '../../../engine/src/index.ts';
import type { BotLevelId } from '../../../engine/src/index.ts';
import { BOT, matchConfigOf, nextBotPick, outcomeOf } from '../match.ts';
import { arenaForElo, packRewardValid } from '../progression.ts';
import type { ApiError, ApiResponse, MatchOutcome, MatchTicket } from '../protocol.ts';
import {
  handleApiBody,
  handleApiCall,
  handleCreateMatch,
  handleLevelUpCard,
  handleOpenPack,
  handleReportMatch,
  handleSetDeck,
  handleSetUsername,
  handleSpendJokers,
  handleUnlockUpgrade,
  ticketOfMatch,
} from './handlers.ts';
import { createMemoryStore, type MemoryStore } from './memoryStore.ts';
import type { ServerEnv, Store } from './store.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const A = 'user-a';
const B = 'user-b';
const UNKNOWN_ID = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
/** Most human seeds tried to reach a wanted outcome. */
const MAX_TRIES = 40;

/** Deterministic env: the engine's seeded generator and a clock that only moves on demand. */
function makeEnv(seed = 1): ServerEnv & { clock: { ms: number } } {
  const rng = seedRng(seed, 0);
  const clock = { ms: 0 };
  return { randInt: (n) => nextInt(rng, n), now: () => clock.ms, clock };
}

/** Two players A and B; with names unless `named` is false. */
async function world(named = true, seed = 1) {
  const store = createMemoryStore();
  store.addUser(A);
  store.addUser(B);
  const env = makeEnv(seed);
  let welcomeA: string | null = null;
  if (named) {
    welcomeA = data(await handleSetUsername(store, env, A, { username: 'Alice' })).welcomePackId;
    data(await handleSetUsername(store, env, B, { username: 'Bob' }));
  }
  return { store, env, welcomeA };
}

function data<T>(r: ApiResponse<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code} (${r.error.detail ?? ''})`);
  return r.data;
}

function failure(r: ApiResponse<unknown>): ApiError {
  if (r.ok) throw new Error(`expected an error, got ${JSON.stringify(r.data)}`);
  return r.error;
}

async function profile(store: Store, user: string) {
  const p = await store.getProfile(user);
  if (p === null) throw new Error('no profile');
  return p;
}

async function card(store: Store, user: string, id: string) {
  return (await store.getCards(user)).find((c) => c.card_id === id);
}

/** A store with some methods replaced (the MemoryStore's methods do not use `this`). */
function override(store: MemoryStore, methods: Partial<Store>): Store {
  return { ...store, ...methods };
}

/** Every deck card at the highest level with all upgrades (test helper). */
function maxOutDeck(store: MemoryStore, user: string): void {
  for (const id of STARTER_DECK) {
    store.patchCard(user, id, { level: MAX_LEVEL, unlocked_upgrades: ALL_UPGRADES_MASK });
  }
}

async function newMatch(store: Store, env: ServerEnv, user: string, botLevel: BotLevelId) {
  return data(
    await handleCreateMatch(store, env, user, { botLevel, engineVersion: ENGINE_VERSION }),
  ).ticket;
}

interface Played {
  picks: number[];
  outcome: MatchOutcome;
  /** Index into `picks` and offer size of every bot decision. */
  bot: { index: number; slots: number }[];
}

/** An honest client: the human picks at random, the bot with `nextBotPick`. */
function playHonest(ticket: MatchTicket, humanSeed: number): Played {
  const cfg = matchConfigOf(ticket);
  if (cfg === null) throw new Error('playHonest: bad ticket');
  const state = createMatch(cfg);
  const rng = seedRng(humanSeed, 0);
  const bot: Played['bot'] = [];
  while (state.phase !== 'finished') {
    if (state.phase !== 'draft') {
      simulateToEnd(startBattle(state));
      endRound(state);
      continue;
    }
    const offer = getOffer(state);
    if (offer.player === BOT) {
      bot.push({ index: state.picks.length, slots: offer.slots.length });
      applyPick(state, nextBotPick(state, ticket));
    } else {
      applyPick(state, nextInt(rng, offer.slots.length));
    }
  }
  if (state.winner === null) throw new Error('playHonest: no winner');
  return { picks: [...state.picks], outcome: outcomeOf(state.winner), bot };
}

/** The first honest play of the ticket with the wanted outcome. */
function playFor(ticket: MatchTicket, want: MatchOutcome): Played {
  for (let seed = 1; seed <= MAX_TRIES; seed++) {
    const played = playHonest(ticket, seed);
    if (played.outcome === want) return played;
  }
  throw new Error(`playFor: no ${want} in ${MAX_TRIES} tries`);
}

function report(store: Store, env: ServerEnv, user: string, matchId: string, picks: number[]) {
  return handleReportMatch(store, env, user, { matchId, picks });
}

/** Elo change of a fresh account (1000, no games: K = 48 / 2) against each bot level. */
const FRESH_ELO_DELTA: Record<BotLevelId, Record<MatchOutcome, number>> = {
  easy: { win: 6, draw: -6, loss: -18 },
  medium: { win: 12, draw: 0, loss: -12 },
  hard: { win: 19, draw: 7, loss: -5 },
};

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

describe('handleApiBody / handleApiCall', () => {
  it('rejects bodies that are not a valid call', async () => {
    const { store, env } = await world();
    for (const body of [null, 'x', {}, { action: 'nope' }, { action: 'set_deck', cards: ['x'] }]) {
      expect(failure(await handleApiBody(store, env, A, body)).code).toBe('bad_request');
    }
  });

  it('dispatches every action', async () => {
    const { store, env, welcomeA } = await world();
    const r = await handleApiBody(store, env, A, { action: 'open_pack', packId: welcomeA });
    expect(data(r)).toEqual({ reward: { kind: 'cards', ...WELCOME_PACK }, cardUnlocked: true });
    const deck = await handleApiCall(store, env, A, {
      action: 'set_deck',
      cards: ['archer', 'knight', 'bat', 'musketeer'],
    });
    expect(data(deck)).toEqual({ cards: ['archer', 'knight', 'bat', 'musketeer'] });
  });

  it('answers a missing profile with unauthorized', async () => {
    const { store, env } = await world();
    const ghost = 'ghost';
    for (const body of [
      { action: 'set_username', username: 'Ghosty' },
      { action: 'set_deck', cards: [...STARTER_DECK] },
      { action: 'level_up_card', card: 'archer' },
      { action: 'unlock_upgrade', card: 'archer', upgrade: 0 },
      { action: 'spend_jokers', card: 'archer', copies: 1 },
      { action: 'create_match', botLevel: 'easy', engineVersion: ENGINE_VERSION },
      { action: 'report_match', matchId: UNKNOWN_ID, picks: [] },
      { action: 'open_pack', packId: UNKNOWN_ID },
    ]) {
      expect(failure(await handleApiBody(store, env, ghost, body)).code, body.action).toBe(
        'unauthorized',
      );
    }
  });

  it('maps unexpected store errors to internal and lets exceptions through', async () => {
    const { store, env } = await world();
    const broken = override(store, {
      setDeck: async () => ({ ok: false, code: 'bad_request' }),
      getPendingMatch: async () => {
        throw new Error('database down');
      },
    });
    const e = failure(await handleSetDeck(broken, env, A, { cards: [...STARTER_DECK] }));
    expect(e.code).toBe('internal');
    expect(e.detail).toContain('bad_request');
    await expect(
      handleCreateMatch(broken, env, A, { botLevel: 'easy', engineVersion: ENGINE_VERSION }),
    ).rejects.toThrow('database down');
  });
});

// ---------------------------------------------------------------------------
// Profile and collection
// ---------------------------------------------------------------------------

describe('set_username', () => {
  it('sets the name with a welcome pack, allows FREE_RENAMES renames, then locks', async () => {
    const { store, env } = await world(false);
    const first = data(await handleSetUsername(store, env, A, { username: 'Alice' }));
    expect(first.username).toBe('Alice');
    expect(first.welcomePackId).toMatch(/^[0-9a-f-]{36}$/);
    const packs = await store.listPacks(A);
    expect(packs).toEqual([
      { id: first.welcomePackId, kind: 'welcome', match_id: null, opened: false, contents: null },
    ]);

    // The same name again changes nothing.
    expect(data(await handleSetUsername(store, env, A, { username: 'Alice' }))).toEqual({
      username: 'Alice',
      welcomePackId: null,
    });
    expect((await profile(store, A)).username_changes).toBe(0);

    for (let i = 1; i <= FREE_RENAMES; i++) {
      const renamed = data(await handleSetUsername(store, env, A, { username: `Alice${i}` }));
      expect(renamed).toEqual({ username: `Alice${i}`, welcomePackId: null });
    }
    expect(failure(await handleSetUsername(store, env, A, { username: 'Zora' })).code).toBe(
      'username_locked',
    );
    expect((await store.listPacks(A)).length).toBe(1);
  });

  it('rejects invalid, blocked and taken names', async () => {
    const { store, env } = await world(false);
    data(await handleSetUsername(store, env, A, { username: 'Alice' }));
    const code = async (username: string) =>
      failure(await handleSetUsername(store, env, B, { username })).code;
    expect(await code('ab')).toBe('username_invalid');
    expect(await code('Hans Peter')).toBe('username_invalid');
    expect(await code('Shitlord')).toBe('username_blocked');
    expect(await code('aLiCe')).toBe('username_taken');
    expect((await profile(store, B)).username).toBeNull();
  });
});

describe('set_deck', () => {
  it('saves four different owned cards', async () => {
    const { store, env } = await world();
    const cards = ['bat', 'tnt', 'archer', 'knight'] as const;
    expect(data(await handleSetDeck(store, env, A, { cards: [...cards] }))).toEqual({
      cards: [...cards],
    });
    expect(await store.getDeck(A)).toEqual({ cards: [...cards] });
  });

  it('rejects wrong counts, duplicates and cards not owned', async () => {
    const { store, env } = await world();
    for (const cards of [
      ['archer', 'knight', 'bat'],
      ['archer', 'knight', 'bat', 'tnt', 'healer'],
      ['archer', 'archer', 'bat', 'tnt'],
      ['archer', 'knight', 'bat', 'musketeer'],
    ] as const) {
      expect(failure(await handleSetDeck(store, env, A, { cards: [...cards] })).code).toBe(
        'deck_invalid',
      );
    }
    expect(await store.getDeck(A)).toEqual({ cards: [...STARTER_DECK] });
  });
});

describe('level_up_card', () => {
  const cost = LEVEL_UP_COSTS[0]!;
  const copies = cost.copies[CARDS.archer.rarity];

  it('takes copies and gold', async () => {
    const { store, env } = await world();
    store.patchCard(A, 'archer', { copies: copies + 2 });
    store.patchProfile(A, { gold: cost.gold + 7 });
    expect(data(await handleLevelUpCard(store, env, A, { card: 'archer' }))).toEqual({
      card: 'archer',
      level: 2,
      copies: 2,
      gold: 7,
    });
  });

  it('checks ownership, level, copies and gold in this order', async () => {
    const { store, env } = await world();
    const code = async () =>
      failure(await handleLevelUpCard(store, env, A, { card: 'archer' })).code;
    expect(failure(await handleLevelUpCard(store, env, A, { card: 'musketeer' })).code).toBe(
      'card_not_owned',
    );
    expect(await code()).toBe('not_enough_copies');
    store.patchCard(A, 'archer', { copies });
    expect(await code()).toBe('not_enough_gold');
    store.patchProfile(A, { gold: cost.gold });
    store.patchCard(A, 'archer', { level: MAX_LEVEL });
    expect(await code()).toBe('max_level');
    expect(await card(store, A, 'archer')).toMatchObject({ level: MAX_LEVEL, copies });
    expect((await profile(store, A)).gold).toBe(cost.gold);
  });

  it('checks again once after a concurrent level-up, then gives up', async () => {
    const { store, env } = await world();
    store.patchCard(A, 'archer', { copies });
    store.patchProfile(A, { gold: cost.gold });
    let stale = 1;
    const racy = override(store, {
      levelUpCard: (...args) =>
        stale-- > 0 ? Promise.resolve({ ok: false, code: 'stale' }) : store.levelUpCard(...args),
    });
    expect(data(await handleLevelUpCard(racy, env, A, { card: 'archer' })).level).toBe(2);

    const alwaysStale = override(store, {
      levelUpCard: async () => ({ ok: false, code: 'stale' }),
    });
    store.patchCard(A, 'archer', { copies: 100 });
    store.patchProfile(A, { gold: 10000 });
    expect(failure(await handleLevelUpCard(alwaysStale, env, A, { card: 'archer' })).code).toBe(
      'internal',
    );
  });
});

describe('unlock_upgrade', () => {
  it('unlocks for gold from the required level on', async () => {
    const { store, env } = await world();
    const code = async (upgrade: 0 | 1 | 2) =>
      failure(await handleUnlockUpgrade(store, env, A, { card: 'archer', upgrade })).code;
    expect(
      failure(await handleUnlockUpgrade(store, env, A, { card: 'musketeer', upgrade: 0 })).code,
    ).toBe('card_not_owned');
    store.patchProfile(A, { gold: UPGRADE_UNLOCK_GOLD[0] + 5 });
    expect(await code(0)).toBe('level_too_low');
    store.patchCard(A, 'archer', { level: UPGRADE_UNLOCK_LEVELS[1] });
    store.patchProfile(A, { gold: 0 });
    expect(await code(0)).toBe('not_enough_gold');
    store.patchProfile(A, { gold: UPGRADE_UNLOCK_GOLD[0] + 5 });
    expect(data(await handleUnlockUpgrade(store, env, A, { card: 'archer', upgrade: 0 }))).toEqual({
      card: 'archer',
      unlockedUpgrades: 1,
      gold: 5,
    });
    expect(await code(0)).toBe('upgrade_already_unlocked');
  });
});

describe('spend_jokers', () => {
  it('adds copies to an owned card and unlocks a new one', async () => {
    const { store, env } = await world();
    store.patchProfile(A, { jokers: 20 });
    const common = 2 * JOKERS_PER_COPY[CARDS.archer.rarity];
    expect(data(await handleSpendJokers(store, env, A, { card: 'archer', copies: 2 }))).toEqual({
      card: 'archer',
      copies: 3,
      jokers: 20 - common,
    });
    const rare = JOKERS_PER_COPY[CARDS.musketeer.rarity];
    expect(data(await handleSpendJokers(store, env, A, { card: 'musketeer', copies: 1 }))).toEqual({
      card: 'musketeer',
      copies: 1,
      jokers: 20 - common - rare,
    });
    expect(await card(store, A, 'musketeer')).toEqual({
      card_id: 'musketeer',
      level: 1,
      copies: 1,
      unlocked_upgrades: 0,
    });
  });

  it('rejects cards of locked arenas, missing jokers and bad amounts', async () => {
    const { store, env } = await world();
    expect(CARDS.assassin.arena).toBeGreaterThan(1);
    const spend = async (cardId: 'archer' | 'assassin', copies: number) =>
      handleSpendJokers(store, env, A, { card: cardId, copies });
    expect(failure(await spend('archer', 1)).code).toBe('not_enough_jokers');
    store.patchProfile(A, { jokers: 100 });
    expect(failure(await spend('assassin', 1)).code).toBe('card_not_in_pool');
    expect(failure(await spend('archer', 0)).code).toBe('bad_request');
    store.patchProfile(A, { highest_arena: CARDS.assassin.arena });
    expect(data(await spend('assassin', 1)).copies).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

describe('create_match', () => {
  it('creates a ticket from the deck snapshot', async () => {
    const { store, env } = await world();
    store.patchCard(A, 'knight', { level: 3, unlocked_upgrades: 3 });
    const r = data(
      await handleCreateMatch(store, env, A, { botLevel: 'medium', engineVersion: ENGINE_VERSION }),
    );
    expect(r.resumed).toBe(false);
    const t = r.ticket;
    expect(t.engineVersion).toBe(ENGINE_VERSION);
    expect(t.botLevel).toBe('medium');
    expect(BOT_PROFILES.find((p) => p.id === t.botProfile)?.level).toBe('medium');
    expect(Number.isSafeInteger(t.seed) && t.seed >= 0).toBe(true);
    expect(t.player.deck).toEqual([...STARTER_DECK]);
    expect(t.player.levels.knight).toBe(3);
    expect(t.player.upgrades?.knight).toBe(3);
    expect(matchConfigOf(t)).not.toBeNull();
  });

  it('rejects another engine version and players without a name', async () => {
    const { store, env } = await world(false);
    expect(
      failure(
        await handleCreateMatch(store, env, A, {
          botLevel: 'easy',
          engineVersion: ENGINE_VERSION + 1,
        }),
      ).code,
    ).toBe('engine_mismatch');
    expect(
      failure(
        await handleCreateMatch(store, env, A, { botLevel: 'easy', engineVersion: ENGINE_VERSION }),
      ).code,
    ).toBe('username_missing');
    expect(await store.getPendingMatch(A)).toBeNull();
  });

  it('resumes the pending match', async () => {
    const { store, env } = await world();
    const first = await newMatch(store, env, A, 'easy');
    const again = data(
      await handleCreateMatch(store, env, A, { botLevel: 'hard', engineVersion: ENGINE_VERSION }),
    );
    expect(again).toEqual({ ticket: first, resumed: true });
  });

  it('books a forfeit as a loss without gold and starts a new match', async () => {
    const { store, env } = await world();
    const first = await newMatch(store, env, A, 'easy');
    const r = data(
      await handleCreateMatch(store, env, A, {
        botLevel: 'medium',
        engineVersion: ENGINE_VERSION,
        pending: 'forfeit',
      }),
    );
    expect(r.resumed).toBe(false);
    expect(r.ticket.matchId).not.toBe(first.matchId);
    expect(r.ticket.botLevel).toBe('medium');
    expect(await store.getMatch(A, first.matchId)).toMatchObject({
      result: 'b_won',
      elo_delta_a: FRESH_ELO_DELTA.easy.loss,
    });
    expect(await profile(store, A)).toMatchObject({
      elo: ELO.start + FRESH_ELO_DELTA.easy.loss,
      games_played: 1,
      gold: 0,
    });
  });

  it('drops a pending match of another engine version without booking', async () => {
    const { store, env } = await world();
    const old = await store.createMatch(A, 'easy', BOT_PROFILES[0]!.id, 7, ENGINE_VERSION - 1);
    if (!old.ok) throw new Error(old.code);
    const r = data(
      await handleCreateMatch(store, env, A, { botLevel: 'easy', engineVersion: ENGINE_VERSION }),
    );
    expect(r.resumed).toBe(false);
    expect(r.ticket.matchId).not.toBe(old.value.id);
    expect((await store.getMatch(A, old.value.id))?.result).toBe('abandoned');
    expect(await profile(store, A)).toMatchObject({ elo: ELO.start, games_played: 0 });
  });

  it('returns the match a concurrent request created', async () => {
    const { store, env } = await world();
    const ticket = await newMatch(store, env, A, 'easy');
    let calls = 0;
    const racy = override(store, {
      // The first read misses the match the other request is just creating.
      getPendingMatch: (user) =>
        calls++ === 0 ? Promise.resolve(null) : store.getPendingMatch(user),
    });
    expect(
      data(
        await handleCreateMatch(racy, env, A, { botLevel: 'easy', engineVersion: ENGINE_VERSION }),
      ),
    ).toEqual({ ticket, resumed: true });
  });
});

describe('report_match', () => {
  it('books a win with Elo and a pack, a repeat books nothing', async () => {
    const { store, env } = await world();
    const ticket = await newMatch(store, env, A, 'easy');
    const played = playFor(ticket, 'win');
    const r = data(await report(store, env, A, ticket.matchId, played.picks));
    const delta = FRESH_ELO_DELTA.easy.win;
    expect(r).toMatchObject({
      outcome: 'win',
      eloDelta: delta,
      elo: ELO.start + delta,
      highestArena: 1,
      arenaUnlocked: false,
      gold: 0,
      repeated: false,
    });
    expect(r.packId).not.toBeNull();
    expect(await store.getMatch(A, ticket.matchId)).toMatchObject({
      result: 'a_won',
      elo_delta_a: delta,
    });
    const before = store.snapshot();

    const again = data(await report(store, env, A, ticket.matchId, played.picks));
    expect(again).toEqual({ ...r, repeated: true });
    // Also with other picks: the booked result counts.
    expect(data(await report(store, env, A, ticket.matchId, []))).toEqual(again);
    expect(store.snapshot()).toEqual(before);
  });

  it('books a loss with consolation gold and no pack', async () => {
    const { store, env } = await world();
    const ticket = await newMatch(store, env, A, 'medium');
    const played = playFor(ticket, 'loss');
    const r = data(await report(store, env, A, ticket.matchId, played.picks));
    const delta = FRESH_ELO_DELTA.medium.loss;
    expect(r).toEqual({
      outcome: 'loss',
      eloDelta: delta,
      elo: ELO.start + delta,
      highestArena: 1,
      arenaUnlocked: false,
      gold: LOSS_GOLD,
      packId: null,
      repeated: false,
    });
    expect(await profile(store, A)).toMatchObject({ gold: LOSS_GOLD, games_played: 1 });
    expect(await store.listPacks(A)).toHaveLength(1); // only the welcome pack
    expect(data(await report(store, env, A, ticket.matchId, played.picks))).toEqual({
      ...r,
      repeated: true,
    });
    expect((await profile(store, A)).gold).toBe(LOSS_GOLD);
  });

  it('books the Elo change against easy and medium for both outcomes', async () => {
    for (const level of ['easy', 'medium'] as const) {
      for (const outcome of ['win', 'loss'] as const) {
        const { store, env } = await world(true, 3);
        // A random human at level 1 rarely beats medium; card strength does not enter Elo.
        if (outcome === 'win') maxOutDeck(store, A);
        const ticket = await newMatch(store, env, A, level);
        const r = data(await report(store, env, A, ticket.matchId, playFor(ticket, outcome).picks));
        expect(r.eloDelta, `${level} ${outcome}`).toBe(FRESH_ELO_DELTA[level][outcome]);
        expect(r.elo).toBe(ELO.start + FRESH_ELO_DELTA[level][outcome]);
      }
    }
  });

  it('books the Elo change against hard (one whole match)', { timeout: 60000 }, async () => {
    const { store, env } = await world(true, 5);
    const ticket = await newMatch(store, env, A, 'hard');
    const played = playHonest(ticket, 1);
    const r = data(await report(store, env, A, ticket.matchId, played.picks));
    expect(r.outcome).toBe(played.outcome);
    expect(r.eloDelta).toBe(FRESH_ELO_DELTA.hard[played.outcome]);
    expect(BOT_LEVELS.hard.elo).toBe(1250);
  });

  it('uses the smaller K after the provisional games', async () => {
    const { store, env } = await world();
    store.patchProfile(A, { games_played: ELO.provisionalGames });
    const ticket = await newMatch(store, env, A, 'easy');
    const r = data(await report(store, env, A, ticket.matchId, playFor(ticket, 'loss').picks));
    expect(r.eloDelta).toBe(-12);
    expect((await profile(store, A)).games_played).toBe(ELO.provisionalGames + 1);
  });

  it('unlocks arena 2 when the Elo passes 1100', async () => {
    const { store, env } = await world();
    expect(arenaForElo(1100)).toBe(2);
    store.patchProfile(A, { elo: 1099, games_played: ELO.provisionalGames });
    const ticket = await newMatch(store, env, A, 'easy');
    const played = playFor(ticket, 'win');
    const r = data(await report(store, env, A, ticket.matchId, played.picks));
    expect(r).toMatchObject({ eloDelta: 2, elo: 1101, highestArena: 2, arenaUnlocked: true });
    expect((await profile(store, A)).highest_arena).toBe(2);
    const again = data(await report(store, env, A, ticket.matchId, played.picks));
    expect(again).toMatchObject({ highestArena: 2, arenaUnlocked: false, repeated: true });
  });

  it('keeps an incomplete match pending, so the client can report again', async () => {
    const { store, env } = await world();
    const ticket = await newMatch(store, env, A, 'easy');
    const played = playHonest(ticket, 2);
    const e = failure(await report(store, env, A, ticket.matchId, played.picks.slice(0, -1)));
    expect(e).toEqual({ code: 'match_rejected', detail: 'incomplete' });
    expect((await store.getMatch(A, ticket.matchId))?.result).toBe('pending');
    expect(await profile(store, A)).toMatchObject({ elo: ELO.start, games_played: 0, gold: 0 });
    expect(data(await report(store, env, A, ticket.matchId, played.picks)).repeated).toBe(false);
  });

  /** The honest picks of a match with one bot decision changed (a choice the bot did not make). */
  function fakeBotPick(played: Played): number[] {
    const pick = played.bot.find((b) => b.slots > 1);
    if (pick === undefined) throw new Error('no bot pick with a choice');
    const picks = [...played.picks];
    picks[pick.index] = ((picks[pick.index] as number) + 1) % pick.slots;
    return picks;
  }

  for (const level of ['easy', 'medium'] as const) {
    it(`books a manipulated bot pick of ${level} as a loss without gold`, async () => {
      const { store, env } = await world();
      const ticket = await newMatch(store, env, A, level);
      const played = playHonest(ticket, 1);
      const picks = fakeBotPick(played);
      const e = failure(await report(store, env, A, ticket.matchId, picks));
      expect(e).toEqual({ code: 'match_rejected', detail: 'bot_mismatch' });
      const delta = FRESH_ELO_DELTA[level].loss;
      expect(await store.getMatch(A, ticket.matchId)).toMatchObject({
        result: 'b_won',
        elo_delta_a: delta,
      });
      expect(store.snapshot().matches.find((m) => m.id === ticket.matchId)?.picks).toEqual(picks);
      expect(await profile(store, A)).toMatchObject({
        elo: ELO.start + delta,
        games_played: 1,
        gold: 0,
      });
      expect(await store.listPacks(A)).toHaveLength(1); // only the welcome pack
      expect(await store.getPendingMatch(A)).toBeNull();

      // The honest picks are too late now: nothing is booked again. Known gap (bookedResult):
      // the answer is the stored loss with the usual consolation gold, although 0 was booked.
      const before = store.snapshot();
      expect(data(await report(store, env, A, ticket.matchId, played.picks))).toEqual({
        outcome: 'loss',
        eloDelta: delta,
        elo: ELO.start + delta,
        highestArena: 1,
        arenaUnlocked: false,
        gold: LOSS_GOLD,
        packId: null,
        repeated: true,
      });
      expect(store.snapshot()).toEqual(before);
    });
  }

  const BROKEN_REPORTS = [
    {
      label: 'picks after the end',
      reason: 'leftover',
      picks: (honest: number[]) => [...honest, 0],
    },
    // Directly, past parseApiCall, which would refuse the slot already.
    { label: 'only an invalid pick', reason: 'bad_picks', picks: () => [99] },
    {
      label: 'an invalid pick in the middle',
      reason: 'bad_picks',
      picks: (honest: number[]) => [...honest.slice(0, 3), OFFER_SIZE, ...honest.slice(4)],
    },
    {
      label: 'a faked bot pick',
      reason: 'bot_mismatch',
      picks: (_: number[], played: Played) => fakeBotPick(played),
    },
  ] as const;

  for (const { label, reason, picks: brokenPicks } of BROKEN_REPORTS) {
    it(`books a report with ${label} (${reason}) like a lost match, but without gold`, async () => {
      // Two identical worlds (same seeds, so the same ticket), past the provisional games.
      const honest = await world(true, 3);
      const broken = await world(true, 3);
      for (const w of [honest, broken]) {
        w.store.patchProfile(A, { elo: 1234, games_played: ELO.provisionalGames + 2, gold: 50 });
      }
      const ticket = await newMatch(honest.store, honest.env, A, 'medium');
      expect(await newMatch(broken.store, broken.env, A, 'medium')).toEqual(ticket);
      const lost = playFor(ticket, 'loss');
      const ok = data(await report(honest.store, honest.env, A, ticket.matchId, lost.picks));
      expect(ok.eloDelta).toBeLessThan(0);

      const sent = brokenPicks(lost.picks, lost);
      const e = failure(await report(broken.store, broken.env, A, ticket.matchId, sent));
      expect(e).toEqual({ code: 'match_rejected', detail: reason });
      const after = await profile(broken.store, A);
      const reference = await profile(honest.store, A);
      expect(after.elo).toBe(reference.elo);
      expect(after.elo).toBe(1234 + ok.eloDelta);
      expect(after.games_played).toBe(reference.games_played);
      expect(after.games_played).toBe(ELO.provisionalGames + 3);
      expect(after.highest_arena).toBe(reference.highest_arena);
      expect(after.gold).toBe(50);
      expect(reference.gold).toBe(50 + LOSS_GOLD);
      expect(await broken.store.getMatch(A, ticket.matchId)).toMatchObject({
        result: 'b_won',
        elo_delta_a: ok.eloDelta,
      });
      expect(await broken.store.listPacks(A)).toHaveLength(1); // only the welcome pack
    });
  }

  it('books two concurrent broken reports only once', async () => {
    const { store, env } = await world();
    const ticket = await newMatch(store, env, A, 'easy');
    const played = playHonest(ticket, 1);
    const broken = [...played.picks, 0];
    const [r1, r2] = await Promise.all([
      report(store, env, A, ticket.matchId, broken),
      report(store, env, A, ticket.matchId, broken),
    ]);
    expect(failure(r1)).toEqual({ code: 'match_rejected', detail: 'leftover' });
    // The second one answers with its own rejection, or with the booking of the first one.
    if (!r2.ok) expect(r2.error).toEqual({ code: 'match_rejected', detail: 'leftover' });
    else expect(r2.data).toMatchObject({ outcome: 'loss', repeated: true });
    const delta = FRESH_ELO_DELTA.easy.loss;
    expect(await profile(store, A)).toMatchObject({
      elo: ELO.start + delta,
      games_played: 1,
      gold: 0,
    });
  });

  it('a broken report that lost the race against another report books nothing', async () => {
    const { store, env } = await world();
    const ticket = await newMatch(store, env, A, 'easy');
    const played = playHonest(ticket, 1);
    failure(await report(store, env, A, ticket.matchId, [...played.picks, 0]));
    let calls = 0;
    const racy = override(store, {
      // The second request read the match before the first one booked it.
      getMatch: async (user, id) => {
        const m = await store.getMatch(user, id);
        return calls++ === 0 && m !== null ? { ...m, result: 'pending', elo_delta_a: null } : m;
      },
    });
    const before = store.snapshot();
    expect(failure(await report(racy, env, A, ticket.matchId, [99]))).toEqual({
      code: 'match_rejected',
      detail: 'bad_picks',
    });
    expect(store.snapshot()).toEqual(before);
  });

  it('closes a match of another engine version or with an unknown bot without booking', async () => {
    const { store, env } = await world();
    const unchanged = { elo: ELO.start, games_played: 0, gold: 0 };
    const old = await store.createMatch(A, 'easy', BOT_PROFILES[0]!.id, 7, ENGINE_VERSION + 1);
    if (!old.ok) throw new Error(old.code);
    expect(failure(await report(store, env, A, old.value.id, [])).code).toBe('engine_mismatch');
    expect((await store.getMatch(A, old.value.id))?.result).toBe('abandoned');
    expect(await profile(store, A)).toMatchObject(unchanged);

    const odd = await store.createMatch(A, 'easy', 'nobody', 7, ENGINE_VERSION);
    if (!odd.ok) throw new Error(odd.code);
    const e = failure(await report(store, env, A, odd.value.id, []));
    expect(e.code).toBe('internal');
    expect(e.detail).toContain('bad_ticket');
    expect((await store.getMatch(A, odd.value.id))?.result).toBe('abandoned');
    expect(await profile(store, A)).toMatchObject(unchanged);
    expect(failure(await report(store, env, A, odd.value.id, []))).toEqual({
      code: 'match_rejected',
      detail: 'abandoned',
    });
  });

  it('closes a match with a bot level the engine does not know without booking', async () => {
    // The database allows levels the engine does not have yet (e.g. 'master'); invalid picks
    // are found before the ticket is looked at, but the broken ticket is not the player's fault.
    const { store, env } = await world();
    const ticket = await newMatch(store, env, A, 'easy');
    const masterly = override(store, {
      getMatch: async (user, id) => {
        const m = await store.getMatch(user, id);
        return m === null ? null : { ...m, bot_level: 'master' as BotLevelId };
      },
    });
    const e = failure(await report(masterly, env, A, ticket.matchId, [99]));
    expect(e.code).toBe('internal');
    expect(e.detail).toContain('unknown bot level master');
    expect((await store.getMatch(A, ticket.matchId))?.result).toBe('abandoned');
    expect(await profile(store, A)).toMatchObject({ elo: ELO.start, games_played: 0, gold: 0 });
  });

  it('answers a concurrent second report with the booked result', async () => {
    const { store, env } = await world();
    const ticket = await newMatch(store, env, A, 'easy');
    const played = playHonest(ticket, 1);
    const first = data(await report(store, env, A, ticket.matchId, played.picks));
    let calls = 0;
    const racy = override(store, {
      // The second request read the match before the first one booked it.
      getMatch: async (user, id) => {
        const m = await store.getMatch(user, id);
        return calls++ === 0 && m !== null ? { ...m, result: 'pending', elo_delta_a: null } : m;
      },
    });
    const before = store.snapshot();
    expect(data(await report(racy, env, A, ticket.matchId, played.picks))).toEqual({
      ...first,
      arenaUnlocked: false,
      repeated: true,
    });
    expect(store.snapshot()).toEqual(before);
  });

  it('does not know matches of other players', async () => {
    const { store, env } = await world();
    const ticketB = await newMatch(store, env, B, 'easy');
    expect(failure(await report(store, env, A, ticketB.matchId, [])).code).toBe('match_not_found');
    expect(failure(await report(store, env, A, UNKNOWN_ID, [])).code).toBe('match_not_found');
    // A's own match is a new one, B's stays untouched.
    const ticketA = await newMatch(store, env, A, 'easy');
    expect(ticketA.matchId).not.toBe(ticketB.matchId);
    expect(await store.getPendingMatch(B)).toEqual(
      expect.objectContaining({ id: ticketB.matchId, result: 'pending' }),
    );
    const resumed = data(
      await handleCreateMatch(store, env, A, { botLevel: 'easy', engineVersion: ENGINE_VERSION }),
    );
    expect(resumed.ticket.matchId).toBe(ticketA.matchId);
  });
});

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

describe('open_pack', () => {
  it('opens the welcome pack once, with the musketeer', async () => {
    const { store, env, welcomeA } = await world();
    const packId = welcomeA as string;
    expect(data(await handleOpenPack(store, env, A, { packId }))).toEqual({
      reward: { kind: 'cards', card: WELCOME_PACK.card, copies: WELCOME_PACK.copies },
      cardUnlocked: true,
    });
    expect((await card(store, A, WELCOME_PACK.card))?.copies).toBe(WELCOME_PACK.copies);
    expect(failure(await handleOpenPack(store, env, A, { packId })).code).toBe(
      'pack_already_opened',
    );
    expect((await card(store, A, WELCOME_PACK.card))?.copies).toBe(WELCOME_PACK.copies);
  });

  it('rolls the reward of a match pack', async () => {
    const { store, env } = await world();
    const ticket = await newMatch(store, env, A, 'easy');
    const r = data(await report(store, env, A, ticket.matchId, playFor(ticket, 'win').picks));
    const opened = data(await handleOpenPack(store, env, A, { packId: r.packId as string }));
    expect(packRewardValid(opened.reward)).toBe(true);
    expect((await store.getPack(A, r.packId as string))?.contents).toEqual(opened.reward);
  });

  it('does not know packs of other players', async () => {
    const { store, env, welcomeA } = await world();
    const packId = welcomeA as string;
    expect(failure(await handleOpenPack(store, env, B, { packId })).code).toBe('pack_not_found');
    expect(failure(await handleOpenPack(store, env, A, { packId: UNKNOWN_ID })).code).toBe(
      'pack_not_found',
    );
    expect((await store.getPack(A, packId))?.opened).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The whole way of a new player
// ---------------------------------------------------------------------------

describe('a new player', () => {
  async function journey(want: MatchOutcome) {
    const store = createMemoryStore();
    const env = makeEnv(11);
    store.addUser(A);
    store.addUser(B);
    const name = data(await handleSetUsername(store, env, A, { username: 'Neuling' }));
    const welcome = data(
      await handleOpenPack(store, env, A, { packId: name.welcomePackId as string }),
    );
    expect(welcome.reward).toEqual({ kind: 'cards', ...WELCOME_PACK });

    const ticket = await newMatch(store, env, A, 'easy');
    const result = data(await report(store, env, A, ticket.matchId, playFor(ticket, want).picks));
    expect(result.outcome).toBe(want);
    if (want === 'win') {
      const opened = data(await handleOpenPack(store, env, A, { packId: result.packId as string }));
      expect(packRewardValid(opened.reward)).toBe(true);
    } else {
      expect(result.gold).toBe(LOSS_GOLD);
      expect((await profile(store, A)).gold).toBe(LOSS_GOLD);
    }

    // Top up until a level-up is affordable, then level up.
    const cost = LEVEL_UP_COSTS[0]!;
    const needed = cost.copies[CARDS.archer.rarity];
    const p = await profile(store, A);
    const archer = await card(store, A, 'archer');
    store.patchCard(A, 'archer', { copies: Math.max(needed, archer?.copies ?? 0) });
    store.patchProfile(A, { gold: Math.max(cost.gold, p.gold) });
    const up = data(await handleLevelUpCard(store, env, A, { card: 'archer' }));
    expect(up.level).toBe(2);

    // The next match uses the new level; B saw none of this.
    const next = await newMatch(store, env, A, 'easy');
    expect(next.player.levels.archer).toBe(2);
    expect(await profile(store, B)).toMatchObject({ username: null, elo: ELO.start, gold: 0 });
    expect(await store.listPacks(B)).toEqual([]);
    return store;
  }

  it('plays through to a win and a level-up', async () => {
    await journey('win');
  });

  it('plays through to a loss and a level-up', async () => {
    const store = await journey('loss');
    // The state survives a save and load (the client's local mode).
    const json = JSON.parse(JSON.stringify(store.snapshot())) as unknown;
    const restored = createMemoryStore({ data: json });
    expect(restored.snapshot()).toEqual(store.snapshot());
    const env = makeEnv(12);
    const pending = await restored.getPendingMatch(A);
    expect(pending).not.toBeNull();
    const resumed = data(
      await handleCreateMatch(restored, env, A, {
        botLevel: 'easy',
        engineVersion: ENGINE_VERSION,
      }),
    );
    expect(resumed).toEqual({ ticket: ticketOfMatch(pending!), resumed: true });
  });
});
