import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from './types.ts';
import { createSupabaseBackend, escapeLike, parseApiBody } from './supabase.ts';

interface Call {
  table: string;
  ops: [string, unknown[]][];
}

type Result = { data: unknown; error: unknown; count?: number | null };

function builder(call: Call, result: Result): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: Result) => unknown) => resolve(result);
        }
        return (...args: unknown[]) => {
          call.ops.push([prop, args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

const PROFILE = {
  id: 'u1',
  username: 'Anna',
  username_changes: 1,
  elo: 1100,
  highest_arena: 2,
  gold: 50,
  jokers: 3,
  games_played: 7,
};

function stub(opts: {
  tables?: Record<string, Result>;
  invoke?: () => Promise<{ data: unknown; error: unknown }>;
  session?: boolean;
}) {
  const calls: Call[] = [];
  const invoked: unknown[] = [];
  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session:
            opts.session === false
              ? null
              : { user: { id: 'u1', is_anonymous: true, email: undefined } },
        },
        error: null,
      }),
    },
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      return builder(call, opts.tables?.[table] ?? { data: [], error: null, count: 0 });
    },
    functions: {
      invoke: async (name: string, init: unknown) => {
        invoked.push([name, init]);
        return opts.invoke ? opts.invoke() : { data: null, error: null };
      },
    },
  };
  const backend = createSupabaseBackend(
    { url: 'u', key: 'k', google: true, email: false },
    client as unknown as SupabaseClient,
  );
  return { backend, calls, invoked };
}

describe('loadPlayer', () => {
  it('maps rows to the player state and skips unknown cards', async () => {
    const { backend, calls } = stub({
      tables: {
        profiles: { data: [PROFILE], error: null },
        player_cards: {
          data: [
            { card_id: 'musketeer', level: 2, copies: 5, unlocked_upgrades: 3 },
            { card_id: 'no_such_card', level: 1, copies: 1, unlocked_upgrades: 0 },
          ],
          error: null,
        },
        decks: { data: [{ cards: ['musketeer', 'ghost_card'] }], error: null },
        packs: {
          data: [
            { id: 'p1', kind: 'welcome' },
            { id: 'p2', kind: 'match' },
          ],
          error: null,
        },
        matches: {
          data: [
            {
              id: 'm1',
              seed: 42,
              engine_version: 4,
              bot_level: 'easy',
              bot_profile: 'bp',
              setup: { deck: ['musketeer'], levels: {} },
            },
          ],
          error: null,
        },
      },
    });
    const p = await backend.loadPlayer();
    expect(p.userId).toBe('u1');
    expect(p.username).toBe('Anna');
    expect(p.usernameChanges).toBe(1);
    expect(p.highestArena).toBe(2);
    expect(p.cards).toEqual({ musketeer: { level: 2, copies: 5, unlockedUpgrades: 3 } });
    expect(p.deck).toEqual(['musketeer']);
    expect(p.packs).toEqual([
      { id: 'p1', kind: 'welcome' },
      { id: 'p2', kind: 'match' },
    ]);
    expect(p.pendingMatch).toMatchObject({
      matchId: 'm1',
      seed: 42,
      engineVersion: 4,
      botLevel: 'easy',
      botProfile: 'bp',
    });
    expect(calls.map((c) => c.table).sort()).toEqual(
      ['decks', 'matches', 'packs', 'player_cards', 'profiles'].sort(),
    );
    const packs = calls.find((c) => c.table === 'packs');
    expect(packs?.ops).toContainEqual(['eq', ['opened', false]]);
    expect(packs?.ops).toContainEqual(['order', ['created_at', { ascending: true }]]);
  });

  it('has no pending match and no deck when the rows are missing', async () => {
    const { backend } = stub({ tables: { profiles: { data: [PROFILE], error: null } } });
    const p = await backend.loadPlayer();
    expect(p.pendingMatch).toBeNull();
    expect(p.deck).toEqual([]);
  });

  it('throws BackendUnavailableError on a read error or a missing profile', async () => {
    const failing = stub({ tables: { profiles: { data: null, error: { message: 'x' } } } });
    await expect(failing.backend.loadPlayer()).rejects.toBeInstanceOf(BackendUnavailableError);
    const empty = stub({ tables: { profiles: { data: [], error: null } } });
    await expect(empty.backend.loadPlayer()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('isUsernameFree', () => {
  it('escapes underscores and excludes the own row', async () => {
    expect(escapeLike('a_b')).toBe('a\\_b');
    const { backend, calls } = stub({
      tables: { public_profiles: { data: null, error: null, count: 0 } },
    });
    expect(await backend.isUsernameFree('a_b')).toBe(true);
    const ops = calls[0]?.ops ?? [];
    expect(ops).toContainEqual(['ilike', ['username', 'a\\_b']]);
    expect(ops).toContainEqual(['neq', ['id', 'u1']]);
    expect(ops).toContainEqual(['select', ['id', { head: true, count: 'exact' }]]);
  });

  it('is false when another row matches', async () => {
    const { backend } = stub({
      tables: { public_profiles: { data: null, error: null, count: 1 } },
    });
    expect(await backend.isUsernameFree('Anna')).toBe(false);
  });
});

describe('call', () => {
  it('sends action and parameters as body and returns ok answers', async () => {
    const { backend, invoked } = stub({
      invoke: async () => ({ data: { ok: true, data: { cards: ['a'] } }, error: null }),
    });
    const r = await backend.call('set_deck', { cards: ['musketeer'] });
    expect(r).toEqual({ ok: true, data: { cards: ['a'] } });
    expect(invoked[0]).toEqual(['api', { body: { action: 'set_deck', cards: ['musketeer'] } }]);
  });

  it('returns domain errors as values', async () => {
    const { backend } = stub({
      invoke: async () => ({
        data: { ok: false, error: { code: 'deck_invalid', detail: 'x' } },
        error: null,
      }),
    });
    expect(await backend.call('set_deck', { cards: [] })).toEqual({
      ok: false,
      error: { code: 'deck_invalid', detail: 'x' },
    });
  });

  it('maps HTTP 401 to unauthorized', async () => {
    const res = new Response(JSON.stringify({ ok: false, error: { code: 'unauthorized' } }), {
      status: 401,
    });
    const { backend } = stub({
      invoke: async () => ({ data: null, error: new FunctionsHttpError(res) }),
    });
    expect(await backend.call('open_pack', { packId: 'p' })).toEqual({
      ok: false,
      error: { code: 'unauthorized' },
    });
  });

  it('throws BackendUnavailableError on HTTP 500, network errors and broken bodies', async () => {
    const res = new Response('{}', { status: 500 });
    const http = stub({ invoke: async () => ({ data: null, error: new FunctionsHttpError(res) }) });
    await expect(http.backend.call('open_pack', { packId: 'p' })).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
    const net = stub({
      invoke: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(net.backend.call('open_pack', { packId: 'p' })).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
    const broken = stub({ invoke: async () => ({ data: 'oops', error: null }) });
    await expect(broken.backend.call('open_pack', { packId: 'p' })).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});

describe('parseApiBody', () => {
  it('rejects malformed bodies', () => {
    for (const body of [
      null,
      1,
      {},
      { ok: true },
      { ok: false },
      { ok: false, error: { code: 'nope' } },
    ]) {
      expect(() => parseApiBody(body)).toThrow(BackendUnavailableError);
    }
  });
});
