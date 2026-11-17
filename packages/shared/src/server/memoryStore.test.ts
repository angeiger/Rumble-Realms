import { describe, expect, it } from 'vitest';
import {
  ALL_UPGRADES_MASK,
  BOT_PROFILES,
  DECK_SIZE,
  ELO,
  ENGINE_VERSION,
  MAX_LEVEL,
  STARTER_CARDS,
  STARTER_COPIES,
  STARTER_DECK,
} from '../../../engine/src/index.ts';
import type { BotLevelId } from '../../../engine/src/index.ts';
import type { PackReward } from '../protocol.ts';
import { parseApiCall } from '../validate.ts';
import {
  createMemoryStore,
  emptyMemoryStoreData,
  loadMemoryStoreData,
  MEMORY_STORE_FORMAT,
  sequentialId,
  type MemoryMatchRow,
  type MemoryStore,
  type MemoryStoreData,
} from './memoryStore.ts';
import type { FinishMatchInput, MatchResult, StoreResult } from './store.ts';

const A = 'user-a';
const B = 'user-b';
const PROFILE = BOT_PROFILES[0]!.id;
const LEVEL: BotLevelId = BOT_PROFILES[0]!.level;
const WIN: FinishMatchInput = {
  result: 'a_won',
  picks: [0, 1, 2],
  eloDelta: 10,
  arena: 1,
  gold: 0,
  withPack: true,
};
const ABANDON: FinishMatchInput = {
  result: 'abandoned',
  picks: [],
  eloDelta: 0,
  arena: 0,
  gold: 0,
  withPack: false,
};

function value<T>(r: StoreResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.value;
}

function code(r: StoreResult<unknown>): string {
  if (r.ok) throw new Error(`expected an error, got ${JSON.stringify(r.value)}`);
  return r.code;
}

/** Two players; A with a name. */
async function twoPlayers(): Promise<MemoryStore> {
  const store = createMemoryStore();
  store.addUser(A);
  store.addUser(B);
  value(await store.setUsername(A, 'Alice', 1));
  return store;
}

async function pendingMatch(store: MemoryStore, user = A) {
  return value(await store.createMatch(user, LEVEL, PROFILE, 42, ENGINE_VERSION));
}

describe('addUser', () => {
  it('creates the account like the database trigger', async () => {
    const store = createMemoryStore();
    store.addUser(A);
    expect(await store.getProfile(A)).toEqual({
      id: A,
      username: null,
      username_changes: 0,
      elo: ELO.start,
      highest_arena: 1,
      gold: 0,
      jokers: 0,
      games_played: 0,
    });
    expect(await store.getCards(A)).toEqual(
      STARTER_CARDS.map((card_id) => ({
        card_id,
        level: 1,
        copies: STARTER_COPIES,
        unlocked_upgrades: 0,
      })),
    );
    expect(await store.getDeck(A)).toEqual({ cards: [...STARTER_DECK] });
    expect(store.hasUser(A)).toBe(true);
    expect(() => store.addUser(A)).toThrow();
    expect(() => store.addUser('')).toThrow();
  });

  it('reads nothing of unknown users', async () => {
    const store = createMemoryStore();
    expect(await store.getProfile(A)).toBeNull();
    expect(await store.getCards(A)).toEqual([]);
    expect(await store.getDeck(A)).toBeNull();
    expect(await store.listPacks(A)).toEqual([]);
    expect(await store.getPendingMatch(A)).toBeNull();
  });
});

describe('setUsername', () => {
  it('follows rr_set_username', async () => {
    const store = createMemoryStore();
    store.addUser(A);
    store.addUser(B);
    expect(code(await store.setUsername('nobody', 'Name1', 1))).toBe('not_found');
    expect(code(await store.setUsername(A, 'Name1', -1))).toBe('bad_request');
    expect(code(await store.setUsername(A, null as unknown as string, 1))).toBe('username_invalid');
    expect(code(await store.setUsername(A, 'a b', 1))).toBe('username_invalid');

    const first = value(await store.setUsername(A, 'Alice', 1));
    expect(first.welcomePackId).not.toBeNull();
    expect(value(await store.setUsername(A, 'Alice', 1))).toEqual({
      username: 'Alice',
      welcomePackId: null,
    });
    expect(code(await store.setUsername(B, 'ALICE', 1))).toBe('username_taken');
    value(await store.setUsername(B, 'Bob', 0));
    // Bob may not rename at all with 0 free renames; Alice once, also a change of case.
    expect(code(await store.setUsername(B, 'Bobby', 0))).toBe('username_locked');
    expect(value(await store.setUsername(A, 'ALICE', 1)).username).toBe('ALICE');
    expect((await store.getProfile(A))?.username_changes).toBe(1);
    expect(code(await store.setUsername(A, 'Alice', 1))).toBe('username_locked');
    expect(await store.listPacks(A)).toHaveLength(1);
  });

  it('grants the welcome pack only once', async () => {
    const data = emptyMemoryStoreData();
    data.profiles.push({ ...profileRow(A), username: null });
    data.packs.push(packRow('p1', A, 'welcome'));
    const store = createMemoryStore({ data });
    expect(value(await store.setUsername(A, 'Alice', 1)).welcomePackId).toBeNull();
    expect(await store.listPacks(A)).toHaveLength(1);
  });
});

describe('setDeck', () => {
  it('needs four different owned cards', async () => {
    const store = await twoPlayers();
    expect(code(await store.setDeck('nobody', [...STARTER_DECK]))).toBe('not_found');
    for (const cards of [
      ['archer', 'knight', 'bat'],
      ['archer', 'archer', 'bat', 'tnt'],
      ['archer', 'knight', 'bat', 'musketeer'],
      ['archer', 'knight', 'bat', 7 as unknown as string],
    ]) {
      expect(code(await store.setDeck(A, cards))).toBe('deck_invalid');
    }
    const cards = ['tnt', 'bat', 'knight', 'archer'];
    const r = value(await store.setDeck(A, cards));
    expect(r).toEqual({ cards });
    r.cards.pop();
    expect(await store.getDeck(A)).toEqual({ cards });
  });
});

describe('levelUpCard', () => {
  it('follows rr_level_up_card and changes nothing on an error', async () => {
    const store = await twoPlayers();
    store.patchCard(A, 'archer', { copies: 5 });
    store.patchProfile(A, { gold: 100 });
    const cases: [string, number, number, number][] = [
      ['archer', 0, 1, 1],
      ['archer', MAX_LEVEL, 1, 1],
      ['archer', 1, -1, 1],
      ['archer', 1, 1, 1.5],
    ];
    for (const args of cases) {
      expect(code(await store.levelUpCard(A, ...args))).toBe('bad_request');
    }
    expect(code(await store.levelUpCard('nobody', 'archer', 1, 1, 1))).toBe('not_found');
    expect(code(await store.levelUpCard(A, 'musketeer', 1, 1, 1))).toBe('card_not_owned');
    expect(code(await store.levelUpCard(A, 'archer', 2, 1, 1))).toBe('stale');
    expect(code(await store.levelUpCard(A, 'archer', 1, 6, 1))).toBe('not_enough_copies');
    expect(code(await store.levelUpCard(A, 'archer', 1, 5, 101))).toBe('not_enough_gold');
    expect((await store.getProfile(A))?.gold).toBe(100);
    expect(value(await store.levelUpCard(A, 'archer', 1, 5, 100))).toEqual({
      level: 2,
      copies: 0,
      gold: 0,
    });
    // The same call again is stale now: the card moved on.
    expect(code(await store.levelUpCard(A, 'archer', 1, 0, 0))).toBe('stale');
  });
});

describe('unlockUpgrade', () => {
  it('follows rr_unlock_upgrade', async () => {
    const store = await twoPlayers();
    store.patchProfile(A, { gold: 300 });
    const cases: [string, number, number, number][] = [
      ['archer', 3, 1, 1],
      ['archer', 0, 0, 1],
      ['archer', 0, MAX_LEVEL + 1, 1],
      ['archer', 0, 1, -1],
    ];
    for (const args of cases) {
      expect(code(await store.unlockUpgrade(A, ...args))).toBe('bad_request');
    }
    expect(code(await store.unlockUpgrade('nobody', 'archer', 0, 1, 1))).toBe('not_found');
    expect(code(await store.unlockUpgrade(A, 'musketeer', 0, 1, 1))).toBe('card_not_owned');
    expect(code(await store.unlockUpgrade(A, 'archer', 0, 2, 1))).toBe('level_too_low');
    expect(code(await store.unlockUpgrade(A, 'archer', 0, 1, 301))).toBe('not_enough_gold');
    expect(value(await store.unlockUpgrade(A, 'archer', 2, 1, 200))).toEqual({
      unlockedUpgrades: 4,
      gold: 100,
    });
    expect(code(await store.unlockUpgrade(A, 'archer', 2, 1, 0))).toBe('upgrade_already_unlocked');
  });
});

describe('spendJokers', () => {
  it('follows rr_spend_jokers', async () => {
    const store = await twoPlayers();
    store.patchProfile(A, { jokers: 10 });
    expect(code(await store.spendJokers(A, 'archer', 0, 1))).toBe('bad_request');
    expect(code(await store.spendJokers(A, 'archer', 1, 0))).toBe('bad_request');
    expect(code(await store.spendJokers('nobody', 'archer', 1, 1))).toBe('not_found');
    expect(code(await store.spendJokers(A, 'archer', 1, 11))).toBe('not_enough_jokers');
    expect(code(await store.spendJokers(A, 'Not-An-Id', 1, 1))).toBe('bad_request');
    expect((await store.getProfile(A))?.jokers).toBe(10);
    expect(value(await store.spendJokers(A, 'archer', 3, 3))).toEqual({
      copies: 4,
      jokers: 7,
      cardUnlocked: false,
    });
    expect(value(await store.spendJokers(A, 'whelp', 1, 4))).toEqual({
      copies: 1,
      jokers: 3,
      cardUnlocked: true,
    });
  });
});

describe('createMatch', () => {
  it('follows rr_create_match', async () => {
    const store = await twoPlayers();
    expect(code(await store.createMatch('nobody', LEVEL, PROFILE, 1, 1))).toBe('not_found');
    expect(code(await store.createMatch(B, LEVEL, PROFILE, 1, 1))).toBe('username_missing');
    for (const args of [
      ['master', PROFILE, 1, 1],
      [LEVEL, 'Bad Profile', 1, 1],
      [LEVEL, PROFILE, -1, 1],
      [LEVEL, PROFILE, 2 ** 53, 1],
      [LEVEL, PROFILE, 1, 0],
    ] as const) {
      expect(
        code(await store.createMatch(A, ...(args as [BotLevelId, string, number, number]))),
      ).toBe('bad_request');
    }
    store.patchCard(A, 'knight', { level: 4, unlocked_upgrades: ALL_UPGRADES_MASK });
    const m = await pendingMatch(store);
    expect(m).toEqual({
      id: sequentialId(1),
      seed: 42,
      engine_version: ENGINE_VERSION,
      bot_level: LEVEL,
      bot_profile: PROFILE,
      setup: {
        deck: [...STARTER_DECK],
        levels: { archer: 1, knight: 4, skeleton: 1, healer: 1 },
        upgrades: { archer: 0, knight: ALL_UPGRADES_MASK, skeleton: 0, healer: 0 },
      },
      result: 'pending',
      elo_delta_a: null,
    });
    expect(code(await store.createMatch(A, LEVEL, PROFILE, 1, 1))).toBe('match_pending');
    // Later level-ups do not change the snapshot.
    store.patchCard(A, 'archer', { level: 3 });
    expect((await store.getPendingMatch(A))?.setup.levels.archer).toBe(1);
  });

  it('needs a valid deck', async () => {
    const data = emptyMemoryStoreData();
    data.profiles.push(profileRow(A, 'Alice'));
    data.cards.push(cardRow(A, 'archer'));
    const store = createMemoryStore({ data });
    expect(await store.getDeck(A)).toBeNull();
    expect(code(await store.createMatch(A, LEVEL, PROFILE, 1, 1))).toBe('deck_invalid');
  });
});

describe('finishMatch', () => {
  it('rejects inconsistent bookings', async () => {
    const store = await twoPlayers();
    const m = await pendingMatch(store);
    for (const bad of [
      { ...ABANDON, gold: 1 },
      { ...ABANDON, arena: 1 },
      { ...ABANDON, eloDelta: -3 },
      { ...ABANDON, withPack: true },
      { ...WIN, result: 'b_won' as const },
      { ...WIN, arena: 0 },
      { ...WIN, arena: 6 },
      { ...WIN, gold: -1 },
      { ...WIN, eloDelta: 0.5 },
      { ...WIN, picks: [0.5] },
      { ...WIN, result: 'pending' as unknown as 'a_won' },
    ]) {
      expect(code(await store.finishMatch(A, m.id, bad)), JSON.stringify(bad)).toBe('bad_request');
    }
    expect(code(await store.finishMatch('nobody', m.id, WIN))).toBe('not_found');
    expect(code(await store.finishMatch(B, m.id, WIN))).toBe('match_not_found');
    expect((await store.getMatch(A, m.id))?.result).toBe('pending');
  });

  it('books a win exactly once', async () => {
    const store = await twoPlayers();
    const m = await pendingMatch(store);
    const out = value(await store.finishMatch(A, m.id, { ...WIN, arena: 2 }));
    expect(out).toEqual({
      elo: ELO.start + 10,
      highestArena: 2,
      arenaUnlocked: true,
      gold: 0,
      packId: expect.any(String),
    });
    expect(await store.getPackOfMatch(A, m.id)).toEqual({
      id: out.packId,
      kind: 'match',
      match_id: m.id,
      opened: false,
      contents: null,
    });
    expect(await store.getPackOfMatch(B, m.id)).toBeNull();
    expect(await store.getMatch(A, m.id)).toMatchObject({ result: 'a_won', elo_delta_a: 10 });
    expect(store.snapshot().matches[0]?.picks).toEqual(WIN.picks);
    expect(code(await store.finishMatch(A, m.id, WIN))).toBe('match_not_pending');
    expect((await store.getProfile(A))?.games_played).toBe(1);
  });

  it('keeps Elo >= 0 and the highest arena, adds the consolation gold', async () => {
    const store = await twoPlayers();
    store.patchProfile(A, { elo: 5, highest_arena: 3, gold: 7 });
    const m = await pendingMatch(store);
    const out = value(
      await store.finishMatch(A, m.id, {
        result: 'b_won',
        picks: [],
        eloDelta: -20,
        arena: 1,
        gold: 10,
        withPack: false,
      }),
    );
    expect(out).toEqual({ elo: 0, highestArena: 3, arenaUnlocked: false, gold: 17, packId: null });
  });

  it('closes an abandoned match without touching the profile', async () => {
    const store = await twoPlayers();
    const before = await store.getProfile(A);
    const m = await pendingMatch(store);
    expect(value(await store.finishMatch(A, m.id, ABANDON))).toEqual({
      elo: ELO.start,
      highestArena: 1,
      arenaUnlocked: false,
      gold: 0,
      packId: null,
    });
    expect(await store.getProfile(A)).toEqual(before);
    expect(await store.getMatch(A, m.id)).toMatchObject({ result: 'abandoned', elo_delta_a: 0 });
    expect(await store.getPendingMatch(A)).toBeNull();
  });
});

describe('openPack', () => {
  const rewards: [PackReward, string][] = [
    [{ kind: 'cards', card: 'archer', copies: 3 }, 'copies'],
    [{ kind: 'gold', gold: 120 }, 'gold'],
    [{ kind: 'jokers', jokers: 2 }, 'jokers'],
  ];

  it('validates the content like rr_open_pack', async () => {
    const store = await twoPlayers();
    const packId = (await store.listPacks(A))[0]!.id;
    for (const bad of [
      null,
      { kind: 'gold' },
      { kind: 'gold', gold: 0 },
      { kind: 'gold', gold: 1.5 },
      { kind: 'gold', gold: '5' },
      { kind: 'gold', gold: 5, extra: 1 },
      { kind: 'cards', copies: 2 },
      { kind: 'cards', card: 'Bad Card', copies: 2 },
      { kind: 'gems', gems: 1 },
    ]) {
      expect(code(await store.openPack(A, packId, bad as unknown as PackReward))).toBe(
        'bad_request',
      );
    }
    expect((await store.getPack(A, packId))?.opened).toBe(false);
  });

  it('books each kind of reward once', async () => {
    for (const [reward] of rewards) {
      const store = await twoPlayers();
      const packId = (await store.listPacks(A))[0]!.id;
      expect(code(await store.openPack('nobody', packId, reward))).toBe('not_found');
      expect(code(await store.openPack(B, packId, reward))).toBe('pack_not_found');
      expect(value(await store.openPack(A, packId, reward))).toEqual({ cardUnlocked: false });
      expect(code(await store.openPack(A, packId, reward))).toBe('pack_already_opened');
      expect(await store.getPack(A, packId)).toMatchObject({ opened: true, contents: reward });
      const p = await store.getProfile(A);
      const archer = (await store.getCards(A)).find((c) => c.card_id === 'archer');
      if (reward.kind === 'cards') expect(archer?.copies).toBe(STARTER_COPIES + reward.copies);
      if (reward.kind === 'gold') expect(p?.gold).toBe(reward.gold);
      if (reward.kind === 'jokers') expect(p?.jokers).toBe(reward.jokers);
    }
  });

  it('unlocks a new card', async () => {
    const store = await twoPlayers();
    const packId = (await store.listPacks(A))[0]!.id;
    const reward: PackReward = { kind: 'cards', card: 'musketeer', copies: 2 };
    expect(value(await store.openPack(A, packId, reward))).toEqual({ cardUnlocked: true });
    expect((await store.getCards(A)).at(-1)).toEqual({
      card_id: 'musketeer',
      level: 1,
      copies: 2,
      unlocked_upgrades: 0,
    });
  });
});

describe('ids', () => {
  it('are UUIDs that parseApiCall accepts, and never repeat', async () => {
    const store = await twoPlayers();
    const packId = (await store.listPacks(A))[0]!.id;
    expect(packId).toBe(sequentialId(0));
    expect(parseApiCall({ action: 'open_pack', packId })).toEqual({ action: 'open_pack', packId });

    const restored = createMemoryStore({ data: store.snapshot() });
    const m = await pendingMatch(restored);
    expect(m.id).toBe(sequentialId(1));
  });

  it('come from the injected generator, skipping ids in use', async () => {
    const ids = ['x1', 'x1', 'x2'];
    const store = createMemoryStore({ newId: () => ids.shift() ?? 'x1' });
    store.addUser(A);
    expect(value(await store.setUsername(A, 'Alice', 1)).welcomePackId).toBe('x1');
    expect((await pendingMatch(store)).id).toBe('x2');
    value(await store.finishMatch(A, 'x2', ABANDON));
    // Only 'x1' is left, which is taken.
    await expect(store.createMatch(A, LEVEL, PROFILE, 1, ENGINE_VERSION)).rejects.toThrow();
  });
});

describe('isolation', () => {
  it('never shows or changes rows of another player', async () => {
    const store = await twoPlayers();
    value(await store.setUsername(B, 'Bob', 1));
    const m = await pendingMatch(store, B);
    const packB = (await store.listPacks(B))[0]!.id;
    expect(await store.getMatch(A, m.id)).toBeNull();
    expect(await store.getPendingMatch(A)).toBeNull();
    expect(await store.getPack(A, packB)).toBeNull();
    expect(code(await store.finishMatch(A, m.id, ABANDON))).toBe('match_not_found');
    expect(code(await store.openPack(A, packB, { kind: 'gold', gold: 5 }))).toBe('pack_not_found');
    expect((await store.getMatch(B, m.id))?.result).toBe('pending');
    expect((await store.getPack(B, packB))?.opened).toBe(false);
  });

  it('hands out copies, never the stored rows', async () => {
    const store = await twoPlayers();
    const m = await pendingMatch(store);
    const p = await store.getProfile(A);
    p!.gold = 999;
    (await store.getCards(A))[0]!.copies = 999;
    (await store.getMatch(A, m.id))!.setup.deck.pop();
    const snap = store.snapshot();
    snap.profiles[0]!.elo = 1;
    expect((await store.getProfile(A))?.gold).toBe(0);
    expect((await store.getCards(A))[0]?.copies).toBe(STARTER_COPIES);
    expect((await store.getMatch(A, m.id))?.setup.deck).toHaveLength(DECK_SIZE);
    expect((await store.getProfile(A))?.elo).toBe(ELO.start);
  });
});

describe('test helpers', () => {
  it('patch only valid values of known players', async () => {
    const store = await twoPlayers();
    store.patchProfile(A, { gold: 50, elo: 1200, jokers: 3 });
    expect(await store.getProfile(A)).toMatchObject({ gold: 50, elo: 1200, jokers: 3 });
    store.patchCard(A, 'whelp', { copies: 2 });
    expect((await store.getCards(A)).at(-1)).toEqual({
      card_id: 'whelp',
      level: 1,
      copies: 2,
      unlocked_upgrades: 0,
    });
    expect(() => store.patchProfile('nobody', { gold: 1 })).toThrow();
    expect(() => store.patchProfile(A, { gold: -1 })).toThrow();
    expect(() => store.patchProfile(A, { highest_arena: 0 })).toThrow();
    expect(() => store.patchCard(A, 'archer', { level: MAX_LEVEL + 1 })).toThrow();
    expect(() => store.patchCard(A, 'Bad Id', { copies: 1 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Snapshot and loading
// ---------------------------------------------------------------------------

function profileRow(id: string, username: string | null = null) {
  return {
    id,
    username,
    username_changes: 0,
    elo: ELO.start,
    highest_arena: 1,
    gold: 0,
    jokers: 0,
    games_played: 0,
  };
}

function cardRow(user_id: string, card_id: string) {
  return { user_id, card_id, level: 1, copies: 1, unlocked_upgrades: 0 };
}

function packRow(id: string, user_id: string, kind: 'match' | 'welcome', match_id = null) {
  return { id, user_id, kind, match_id, opened: false, contents: null };
}

function matchRow(id: string, player_a: string, result = 'pending'): MemoryMatchRow {
  // `result` may be invalid on purpose (loading tests).
  return {
    id,
    player_a,
    seed: 1,
    engine_version: ENGINE_VERSION,
    bot_level: LEVEL,
    bot_profile: PROFILE,
    setup: { deck: [...STARTER_DECK], levels: {}, upgrades: {} },
    picks: [],
    result: result as MatchResult,
    elo_delta_a: null,
  };
}

/** A player with the start collection and deck, as rows. */
function starter(data: MemoryStoreData, id: string, username: string | null = null): void {
  data.profiles.push(profileRow(id, username));
  for (const c of STARTER_CARDS) data.cards.push(cardRow(id, c));
  data.decks.push({ user_id: id, cards: [...STARTER_DECK] });
}

describe('snapshot', () => {
  it('is plain JSON and restores the same state', async () => {
    const store = await twoPlayers();
    const m = await pendingMatch(store);
    value(await store.finishMatch(A, m.id, WIN));
    await pendingMatch(store);
    const packId = (await store.listPacks(A))[0]!.id;
    value(await store.openPack(A, packId, { kind: 'cards', card: 'musketeer', copies: 2 }));
    store.patchCard(B, 'bat', { level: 3, unlocked_upgrades: 1 });

    const snap = store.snapshot();
    const json = JSON.parse(JSON.stringify(snap)) as unknown;
    expect(json).toEqual(snap);
    expect(snap.format).toBe(MEMORY_STORE_FORMAT);
    const restored = createMemoryStore({ data: json });
    expect(restored.snapshot()).toEqual(snap);
    expect(loadMemoryStoreData(json)).toEqual(snap);
    for (const user of [A, B]) {
      expect(await restored.getProfile(user)).toEqual(await store.getProfile(user));
      expect(await restored.getCards(user)).toEqual(await store.getCards(user));
      expect(await restored.listPacks(user)).toEqual(await store.listPacks(user));
      expect(await restored.getPendingMatch(user)).toEqual(await store.getPendingMatch(user));
    }
  });
});

describe('loadMemoryStoreData', () => {
  it('gives an empty store for unusable data', () => {
    const valid = emptyMemoryStoreData();
    for (const bad of [
      undefined,
      null,
      'store',
      42,
      [],
      { ...valid, format: MEMORY_STORE_FORMAT + 1 },
      { ...valid, profiles: {} },
      { ...valid, packs: undefined },
    ]) {
      expect(loadMemoryStoreData(bad)).toEqual(emptyMemoryStoreData());
    }
    expect(createMemoryStore({ data: 'garbage' }).snapshot()).toEqual(emptyMemoryStoreData());
  });

  it('drops rows that break the table rules', () => {
    const data = emptyMemoryStoreData();
    data.nextId = -5;
    starter(data, A, 'Alice');
    starter(data, B, 'ALICE'); // same name ignoring case
    data.profiles.push({ ...profileRow('broke'), gold: -1 }); // invalid profile
    data.profiles.push(profileRow(A)); // duplicate id
    data.cards.push(cardRow('broke', 'archer')); // owner dropped
    data.cards.push(cardRow(A, 'archer')); // duplicate card
    data.cards.push({ ...cardRow(A, 'whelp'), level: MAX_LEVEL + 1 });
    data.decks.push({ user_id: A, cards: ['archer', 'knight', 'bat', 'whelp'] }); // second deck
    data.matches.push(matchRow('m1', A));
    data.matches.push(matchRow('m2', A)); // second pending
    data.matches.push(matchRow('m3', A, 'won')); // invalid result
    data.matches.push(matchRow('m1', B)); // duplicate id
    data.packs.push(packRow('p1', A, 'welcome'));
    data.packs.push(packRow('p2', A, 'welcome')); // second welcome pack
    data.packs.push({ ...packRow('p3', B, 'match'), match_id: 'm1' as never }); // A's match
    data.packs.push({ ...packRow('p4', A, 'match'), opened: true }); // opened without contents
    data.packs.push({ ...packRow('p5', A, 'match'), contents: { kind: 'gold', gold: 0 } as never });

    const out = loadMemoryStoreData(JSON.parse(JSON.stringify(data)));
    expect(out.nextId).toBe(0);
    expect(out.profiles.map((p) => [p.id, p.username])).toEqual([
      [A, 'Alice'],
      [B, null],
    ]);
    expect(out.cards.filter((c) => c.user_id === A).map((c) => c.card_id)).toEqual([
      ...STARTER_CARDS,
    ]);
    expect(out.decks).toEqual([
      { user_id: A, cards: [...STARTER_DECK] },
      { user_id: B, cards: [...STARTER_DECK] },
    ]);
    expect(out.matches.map((m) => [m.id, m.result])).toEqual([
      ['m1', 'pending'],
      ['m2', 'abandoned'],
    ]);
    expect(out.packs.map((k) => [k.id, k.match_id])).toEqual([
      ['p1', null],
      ['p3', null],
    ]);
  });

  it('replaces a broken deck by the start deck only if the player owns it', () => {
    const data = emptyMemoryStoreData();
    starter(data, A);
    data.decks[0] = { user_id: A, cards: ['archer', 'knight', 'bat', 'musketeer'] };
    data.profiles.push(profileRow(B));
    data.cards.push(cardRow(B, 'archer'));
    data.decks.push({ user_id: B, cards: ['archer', 'archer', 'bat', 'tnt'] });
    expect(loadMemoryStoreData(data).decks).toEqual([{ user_id: A, cards: [...STARTER_DECK] }]);
  });
});
