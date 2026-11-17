/**
 * Security (SPEC 14.2, D-082): the function needs a valid token and only touches the caller's
 * rows; clients cannot write any table or call the booking functions; other players' rows are
 * invisible except for the public profile fields.
 */
import { ENGINE_VERSION } from '@rumble-realms/engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { CLIENT_KEY, CONFIGURED } from './env.ts';
import {
  admin,
  anonClient,
  cardsOf,
  deckOf,
  fails,
  namedGuest,
  newGuest,
  ok,
  packOf,
  playMatch,
  profileOf,
  raw,
} from './helpers.ts';

const TABLES = ['profiles', 'player_cards', 'decks', 'matches', 'packs', 'friendships'] as const;

describe.skipIf(!CONFIGURED)('access to the function', () => {
  it('needs a valid access token (401 otherwise)', async () => {
    const body = JSON.stringify({ action: 'set_username', username: 'nobody_here' });
    const unauthorized = { ok: false, error: { code: 'unauthorized' } };
    for (const token of [null, 'garbage', CLIENT_KEY as string, 'eyJhbGciOiJIUzI1NiJ9.e30.x']) {
      const r = await raw({ token, body });
      expect(r.status, String(token)).toBe(401);
      expect(r.body).toEqual(unauthorized);
    }
  });

  it('rejects the token of a deleted account', async () => {
    const g = await newGuest();
    const del = await admin().auth.admin.deleteUser(g.id);
    expect(del.error).toBeNull();
    const r = await raw({
      token: g.token,
      body: JSON.stringify({ action: 'set_username', username: 'ghost_user' }),
    });
    expect(r.status).toBe(401);
  });

  it('never lets a player use the match or pack of another player', async () => {
    const a = await namedGuest();
    const b = await namedGuest();
    const { ticket } = await ok(a, 'create_match', {
      botLevel: 'easy',
      engineVersion: ENGINE_VERSION,
    });
    const played = playMatch(ticket, 2);

    expect(await fails(b, 'report_match', { matchId: ticket.matchId, picks: played.picks })).toBe(
      'match_not_found',
    );
    expect(await fails(b, 'open_pack', { packId: a.welcomePackId })).toBe('pack_not_found');
    expect((await packOf(a.welcomePackId)).opened).toBe(false);
    expect((await profileOf(b.id)).games_played).toBe(0);

    // A's own report still works afterwards.
    const booked = await ok(a, 'report_match', { matchId: ticket.matchId, picks: played.picks });
    expect(booked.repeated).toBe(false);
  });
});

/** Owner column and a column a cheater would like to change, per table. */
const WRITES: Record<(typeof TABLES)[number], { owner: string; patch: Record<string, unknown> }> = {
  profiles: { owner: 'id', patch: { gold: 999_999 } },
  player_cards: { owner: 'user_id', patch: { copies: 999 } },
  decks: { owner: 'user_id', patch: { cards: ['archer', 'knight', 'skeleton', 'bat'] } },
  matches: { owner: 'player_a', patch: { result: 'a_won' } },
  packs: { owner: 'user_id', patch: { opened: true } },
  friendships: { owner: 'user_id', patch: { status: 'accepted' } },
};

/**
 * Tries insert, update and delete on every table for the own rows. Each attempt must be
 * refused with "permission denied" (42501) or change no row; anything else is reported, so
 * that a typo in a filter cannot make the check pass by accident.
 */
async function tryWrites(db: SupabaseClient, ownId: string): Promise<string[]> {
  const problems: string[] = [];
  const judge = (what: string, r: { error: { code: string } | null; data: unknown[] | null }) => {
    if (r.error !== null) {
      if (r.error.code !== '42501') problems.push(`${what}: unexpected error ${r.error.code}`);
    } else if ((r.data?.length ?? 0) > 0) {
      problems.push(`${what}: changed ${r.data?.length} rows`);
    }
  };
  for (const table of TABLES) {
    const { owner, patch } = WRITES[table];
    judge(
      `insert ${table}`,
      await db
        .from(table)
        .insert({ [owner]: ownId, ...patch })
        .select(),
    );
    judge(`update ${table}`, await db.from(table).update(patch).eq(owner, ownId).select());
    judge(`delete ${table}`, await db.from(table).delete().eq(owner, ownId).select());
  }
  return problems;
}

describe.skipIf(!CONFIGURED)('direct database access of clients', () => {
  it('cannot write any table, signed in or not', async () => {
    const p = await namedGuest();
    const profile = await profileOf(p.id);
    const cards = await cardsOf(p.id);
    const deck = await deckOf(p.id);

    expect(await tryWrites(p.db, p.id)).toEqual([]);
    expect(await tryWrites(anonClient(), p.id)).toEqual([]);

    // Typical attempts on the own rows, with the errors PostgREST gives.
    const gold = await p.db.from('profiles').update({ gold: 999_999 }).eq('id', p.id);
    expect(gold.error?.code).toBe('42501');
    const copies = await p.db.from('player_cards').update({ copies: 999 }).eq('user_id', p.id);
    expect(copies.error?.code).toBe('42501');

    expect(await profileOf(p.id)).toEqual(profile);
    expect(await cardsOf(p.id)).toEqual(cards);
    expect(await deckOf(p.id)).toEqual(deck);
    expect((await packOf(p.welcomePackId)).opened).toBe(false);
  });

  it('cannot call the booking functions rr_* (signed in or with the public key only)', async () => {
    const p = await namedGuest();
    const before = await profileOf(p.id);
    const calls: [string, Record<string, unknown>][] = [
      ['rr_set_username', { p_user: p.id, p_username: 'hacked_name', p_free_renames: 99 }],
      ['rr_set_deck', { p_user: p.id, p_cards: ['archer', 'knight', 'skeleton', 'bat'] }],
      [
        'rr_level_up_card',
        { p_user: p.id, p_card: 'archer', p_from_level: 1, p_copies: 0, p_gold: 0 },
      ],
      [
        'rr_unlock_upgrade',
        { p_user: p.id, p_card: 'archer', p_upgrade: 0, p_min_level: 1, p_gold: 0 },
      ],
      ['rr_spend_jokers', { p_user: p.id, p_card: 'archer', p_copies: 99, p_jokers: 0 }],
      [
        'rr_create_match',
        {
          p_user: p.id,
          p_bot_level: 'easy',
          p_bot_profile: 'x',
          p_seed: 1,
          p_engine_version: ENGINE_VERSION,
        },
      ],
      [
        'rr_finish_match',
        {
          p_user: p.id,
          p_match: '00000000-0000-4000-8000-000000000000',
          p_result: 'a_won',
          p_picks: [],
          p_elo_delta: 500,
          p_arena: 5,
          p_gold: 99_999,
          p_with_pack: true,
        },
      ],
      [
        'rr_open_pack',
        { p_user: p.id, p_pack: p.welcomePackId, p_contents: { kind: 'gold', gold: 99_999 } },
      ],
    ];
    for (const db of [p.db, anonClient()]) {
      for (const [fn, args] of calls) {
        const r = await db.rpc(fn, args);
        // "permission denied for function": the function exists, but only service_role may run it.
        expect(r.error?.code, fn).toBe('42501');
      }
    }
    expect(await profileOf(p.id)).toEqual(before);
    expect((await cardsOf(p.id)).get('archer')).toMatchObject({ level: 1, copies: 1 });
    expect((await packOf(p.welcomePackId)).opened).toBe(false);
    const matches = await admin().from('matches').select('id').eq('player_a', p.id);
    expect(matches.data).toEqual([]);
  });

  it('cannot read rows of other players, only their public profile fields', async () => {
    const a = await namedGuest();
    const { ticket } = await ok(a, 'create_match', {
      botLevel: 'easy',
      engineVersion: ENGINE_VERSION,
    });
    const b = await newGuest();

    for (const [table, column] of [
      ['profiles', 'id'],
      ['player_cards', 'user_id'],
      ['decks', 'user_id'],
      ['matches', 'player_a'],
      ['packs', 'user_id'],
    ] as const) {
      const r = await b.db.from(table).select('*').eq(column, a.id);
      expect(r.error, table).toBeNull();
      expect(r.data, table).toEqual([]);
    }
    const m = await b.db.from('matches').select('*').eq('id', ticket.matchId);
    expect(m.data).toEqual([]);
    // Without a filter only the own rows come back.
    const all = await b.db.from('profiles').select('id');
    expect(all.data).toEqual([{ id: b.id }]);

    const pub = await b.db.from('public_profiles').select('*').eq('id', a.id);
    expect(pub.error).toBeNull();
    expect(pub.data).toHaveLength(1);
    expect(Object.keys(pub.data?.[0] ?? {}).sort()).toEqual([
      'elo',
      'highest_arena',
      'id',
      'username',
    ]);
    expect(pub.data?.[0]).toMatchObject({ id: a.id, username: a.username });

    // Without signing in, nothing is readable.
    const anon = anonClient();
    const anonPub = await anon.from('public_profiles').select('*').eq('id', a.id);
    expect(anonPub.error !== null || anonPub.data?.length === 0).toBe(true);
    const anonProfiles = await anon.from('profiles').select('*');
    expect(anonProfiles.error !== null || anonProfiles.data?.length === 0).toBe(true);
  });
});
