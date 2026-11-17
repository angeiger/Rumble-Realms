import assert from 'node:assert/strict';
import { STORE_ERROR_CODES } from '../_shared/packages/shared/src/index.ts';
import { storeCodeOf, SupabaseStore } from './supabaseStore.ts';
import type { DbClient, DbFilter, DbResult } from './supabaseStore.ts';

const USER = '00000000-0000-4000-8000-0000000000aa';
const MATCH = '00000000-0000-4000-8000-0000000000bb';
const PACK = '00000000-0000-4000-8000-0000000000cc';

interface Select {
  table: string;
  columns: string;
  filters: [string, string][];
  single: boolean;
}

interface Rpc {
  fn: string;
  args: Record<string, unknown>;
}

/** A fake supabase-js client: records every call and answers with the queued results. */
function fakeDb(results: DbResult[]): { db: DbClient; selects: Select[]; rpcs: Rpc[] } {
  const selects: Select[] = [];
  const rpcs: Rpc[] = [];
  const next = (): Promise<DbResult> => {
    const r = results.shift();
    if (r === undefined) throw new Error('fakeDb: no result queued');
    return Promise.resolve(r);
  };
  const db: DbClient = {
    from(table) {
      return {
        select(columns) {
          const call: Select = { table, columns, filters: [], single: false };
          selects.push(call);
          const filter: DbFilter = {
            eq(column, value) {
              call.filters.push([column, value]);
              return filter;
            },
            maybeSingle() {
              call.single = true;
              return next();
            },
            then(onFulfilled, onRejected) {
              return next().then(onFulfilled, onRejected);
            },
          };
          return filter;
        },
      };
    },
    rpc(fn, args) {
      rpcs.push({ fn, args });
      return next();
    },
  };
  return { db, selects, rpcs };
}

const ok = (data: unknown): DbResult => ({ data, error: null });
const sqlError = (message: string, code = 'P0001'): DbResult => ({
  data: null,
  error: { code, message },
});

const PROFILE = {
  id: USER,
  username: 'Hero',
  username_changes: 0,
  elo: 1000,
  highest_arena: 1,
  gold: 50,
  jokers: 2,
  games_played: 3,
};

const SETUP = {
  deck: ['archer', 'knight', 'skeleton', 'healer'],
  levels: { archer: 1, knight: 1, skeleton: 1, healer: 1 },
  upgrades: { archer: 0, knight: 0, skeleton: 0, healer: 0 },
};

const MATCH_ROW = {
  id: MATCH,
  seed: 2 ** 53 - 1,
  engine_version: 4,
  bot_level: 'easy',
  bot_profile: 'goblin-gustav',
  setup: SETUP,
  result: 'pending',
  elo_delta_a: null,
};

Deno.test('storeCodeOf maps rr:<code> of SQLSTATE P0001 to the store codes only', () => {
  for (const code of STORE_ERROR_CODES) {
    assert.equal(storeCodeOf({ code: 'P0001', message: `rr:${code}` }), code);
  }
  assert.equal(storeCodeOf({ code: 'P0001', message: 'rr:something_else' }), null);
  assert.equal(storeCodeOf({ code: 'P0001', message: 'other text' }), null);
  assert.equal(storeCodeOf({ code: '42501', message: 'rr:stale' }), null);
  assert.equal(storeCodeOf({ message: 'rr:stale' }), null);
  assert.equal(storeCodeOf({ code: 'P0001', message: 'rr:stale and more' }), null);
});

Deno.test('every read filters on the account id', async () => {
  const { db, selects } = fakeDb([
    ok(PROFILE),
    ok([{ card_id: 'archer', level: 2, copies: 3, unlocked_upgrades: 1 }]),
    ok(MATCH_ROW),
    ok({ ...MATCH_ROW, result: 'a_won', elo_delta_a: 12 }),
    ok({ id: PACK, kind: 'match', match_id: MATCH, opened: false, contents: null }),
    ok(null),
  ]);
  const store = new SupabaseStore(db);
  assert.deepEqual(await store.getProfile(USER), PROFILE);
  assert.deepEqual(await store.getCards(USER), [
    { card_id: 'archer', level: 2, copies: 3, unlocked_upgrades: 1 },
  ]);
  assert.deepEqual(await store.getPendingMatch(USER), MATCH_ROW);
  assert.deepEqual(await store.getMatch(USER, MATCH), {
    ...MATCH_ROW,
    result: 'a_won',
    elo_delta_a: 12,
  });
  assert.deepEqual(await store.getPack(USER, PACK), {
    id: PACK,
    kind: 'match',
    match_id: MATCH,
    opened: false,
    contents: null,
  });
  assert.equal(await store.getPackOfMatch(USER, MATCH), null);

  assert.deepEqual(
    selects.map((s) => [s.table, s.filters, s.single]),
    [
      ['profiles', [['id', USER]], true],
      ['player_cards', [['user_id', USER]], false],
      [
        'matches',
        [
          ['player_a', USER],
          ['result', 'pending'],
        ],
        true,
      ],
      [
        'matches',
        [
          ['id', MATCH],
          ['player_a', USER],
        ],
        true,
      ],
      [
        'packs',
        [
          ['id', PACK],
          ['user_id', USER],
        ],
        true,
      ],
      [
        'packs',
        [
          ['match_id', MATCH],
          ['user_id', USER],
        ],
        true,
      ],
    ],
  );
  assert.ok(selects.every((s) => !s.columns.includes('*')));
});

Deno.test('reads throw on database errors and on rows of the wrong shape', async () => {
  const cases: [DbResult, (s: SupabaseStore) => Promise<unknown>][] = [
    [sqlError('timeout', '57014'), (s) => s.getProfile(USER)],
    [ok({ ...PROFILE, gold: '50' }), (s) => s.getProfile(USER)],
    [ok({ not: 'a list' }), (s) => s.getCards(USER)],
    [ok({ ...MATCH_ROW, result: 'won' }), (s) => s.getMatch(USER, MATCH)],
    [ok({ ...MATCH_ROW, setup: [] }), (s) => s.getMatch(USER, MATCH)],
    [ok({ ...MATCH_ROW, seed: 1.5 }), (s) => s.getMatch(USER, MATCH)],
    [
      ok({ id: PACK, kind: 'gift', match_id: null, opened: false, contents: null }),
      (s) => s.getPack(USER, PACK),
    ],
  ];
  for (const [result, read] of cases) {
    const { db } = fakeDb([result]);
    await assert.rejects(read(new SupabaseStore(db)), /SupabaseStore/);
  }
});

Deno.test('each write calls exactly one rr_* function with named parameters', async () => {
  const { db, rpcs } = fakeDb([
    ok([{ username: 'Hero', welcome_pack_id: PACK }]),
    ok(['archer', 'knight', 'skeleton', 'bat']),
    ok([{ level: 2, copies: 0, gold: 0 }]),
    ok([{ unlocked_upgrades: 1, gold: 0 }]),
    ok([{ copies: 3, jokers: 0, card_unlocked: true }]),
    ok([
      {
        id: MATCH,
        seed: 42,
        engine_version: 4,
        bot_level: 'easy',
        bot_profile: 'goblin-gustav',
        setup: SETUP,
      },
    ]),
    ok([{ elo: 1012, highest_arena: 1, arena_unlocked: false, gold: 50, pack_id: PACK }]),
    ok([{ card_unlocked: false }]),
  ]);
  const store = new SupabaseStore(db);
  assert.deepEqual(await store.setUsername(USER, 'Hero', 1), {
    ok: true,
    value: { username: 'Hero', welcomePackId: PACK },
  });
  assert.deepEqual(await store.setDeck(USER, ['archer', 'knight', 'skeleton', 'bat']), {
    ok: true,
    value: { cards: ['archer', 'knight', 'skeleton', 'bat'] },
  });
  assert.deepEqual(await store.levelUpCard(USER, 'archer', 1, 5, 100), {
    ok: true,
    value: { level: 2, copies: 0, gold: 0 },
  });
  assert.deepEqual(await store.unlockUpgrade(USER, 'archer', 0, 2, 200), {
    ok: true,
    value: { unlockedUpgrades: 1, gold: 0 },
  });
  assert.deepEqual(await store.spendJokers(USER, 'musketeer', 3, 6), {
    ok: true,
    value: { copies: 3, jokers: 0, cardUnlocked: true },
  });
  assert.deepEqual(await store.createMatch(USER, 'easy', 'goblin-gustav', 42, 4), {
    ok: true,
    value: {
      id: MATCH,
      seed: 42,
      engine_version: 4,
      bot_level: 'easy',
      bot_profile: 'goblin-gustav',
      setup: SETUP,
      result: 'pending',
      elo_delta_a: null,
    },
  });
  const input = {
    result: 'a_won' as const,
    picks: [0, 1, 2],
    eloDelta: 12,
    arena: 1,
    gold: 0,
    withPack: true,
  };
  assert.deepEqual(await store.finishMatch(USER, MATCH, input), {
    ok: true,
    value: { elo: 1012, highestArena: 1, arenaUnlocked: false, gold: 50, packId: PACK },
  });
  const reward = { kind: 'gold' as const, gold: 70 };
  assert.deepEqual(await store.openPack(USER, PACK, reward), {
    ok: true,
    value: { cardUnlocked: false },
  });

  assert.deepEqual(rpcs, [
    { fn: 'rr_set_username', args: { p_user: USER, p_username: 'Hero', p_free_renames: 1 } },
    { fn: 'rr_set_deck', args: { p_user: USER, p_cards: ['archer', 'knight', 'skeleton', 'bat'] } },
    {
      fn: 'rr_level_up_card',
      args: { p_user: USER, p_card: 'archer', p_from_level: 1, p_copies: 5, p_gold: 100 },
    },
    {
      fn: 'rr_unlock_upgrade',
      args: { p_user: USER, p_card: 'archer', p_upgrade: 0, p_min_level: 2, p_gold: 200 },
    },
    {
      fn: 'rr_spend_jokers',
      args: { p_user: USER, p_card: 'musketeer', p_copies: 3, p_jokers: 6 },
    },
    {
      fn: 'rr_create_match',
      args: {
        p_user: USER,
        p_bot_level: 'easy',
        p_bot_profile: 'goblin-gustav',
        p_seed: 42,
        p_engine_version: 4,
      },
    },
    {
      fn: 'rr_finish_match',
      args: {
        p_user: USER,
        p_match: MATCH,
        p_result: 'a_won',
        p_picks: [0, 1, 2],
        p_elo_delta: 12,
        p_arena: 1,
        p_gold: 0,
        p_with_pack: true,
      },
    },
    { fn: 'rr_open_pack', args: { p_user: USER, p_pack: PACK, p_contents: reward } },
  ]);
});

Deno.test('a guard failure becomes the store code, nothing else does', async () => {
  const { db } = fakeDb([
    sqlError('rr:not_enough_gold'),
    sqlError('rr:username_taken'),
    sqlError('rr:unknown_code'),
    sqlError('permission denied for function rr_set_deck', '42501'),
    { data: null, error: { message: 'TypeError: fetch failed' } },
  ]);
  const store = new SupabaseStore(db);
  assert.deepEqual(await store.levelUpCard(USER, 'archer', 1, 5, 100), {
    ok: false,
    code: 'not_enough_gold',
  });
  assert.deepEqual(await store.setUsername(USER, 'Hero', 1), {
    ok: false,
    code: 'username_taken',
  });
  await assert.rejects(store.openPack(USER, PACK, { kind: 'jokers', jokers: 1 }), /unknown_code/);
  await assert.rejects(store.setDeck(USER, ['a', 'b', 'c', 'd']), /42501/);
  await assert.rejects(store.spendJokers(USER, 'archer', 1, 1), /fetch failed/);
});

Deno.test('a write with an unexpected result throws', async () => {
  const { db } = fakeDb([ok([]), ok([{ level: 2 }]), ok([1, 2])]);
  const store = new SupabaseStore(db);
  await assert.rejects(store.setUsername(USER, 'Hero', 1), /result of rr_set_username/);
  await assert.rejects(store.levelUpCard(USER, 'archer', 1, 5, 100), /copies/);
  await assert.rejects(store.setDeck(USER, ['a', 'b', 'c', 'd']), /result of rr_set_deck/);
});
