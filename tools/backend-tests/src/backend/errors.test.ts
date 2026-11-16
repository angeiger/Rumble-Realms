/**
 * The important error codes of every action, resuming and forfeiting a match, a manipulated
 * bot pick or picks after the end (both count as a loss) and matches of another engine version.
 */
import {
  BOT_LEVELS,
  BOT_PROFILES,
  ENGINE_VERSION,
  LOSS_GOLD,
  MAX_LEVEL,
} from '@rumble-realms/engine';
import { eloChange, levelUpCost } from '@rumble-realms/shared';
import { describe, expect, it } from 'vitest';
import { CONFIGURED } from './env.ts';
import {
  admin,
  call,
  fails,
  matchOf,
  namedGuest,
  newGuest,
  ok,
  patchCard,
  patchProfile,
  playMatch,
  profileOf,
  raw,
  uniqueName,
} from './helpers.ts';

const MISSING_ID = '00000000-0000-4000-8000-00000000dead';

describe.skipIf(!CONFIGURED)('error codes', () => {
  it('set_username', async () => {
    const a = await newGuest();
    expect(await fails(a, 'set_username', { username: 'ab' })).toBe('username_invalid');
    expect(await fails(a, 'set_username', { username: 'bad name!' })).toBe('username_invalid');
    expect(await fails(a, 'set_username', { username: 'Arschloch99' })).toBe('username_blocked');

    const b = await namedGuest();
    // Taken, ignoring case.
    expect(await fails(a, 'set_username', { username: b.username.toUpperCase() })).toBe(
      'username_taken',
    );

    // The first pick gives the welcome pack, the same name again is a no-op, one rename is free.
    const name = uniqueName();
    const first = await ok(a, 'set_username', { username: name });
    expect(first.welcomePackId).not.toBeNull();
    expect(await ok(a, 'set_username', { username: name })).toEqual({
      username: name,
      welcomePackId: null,
    });
    const renamed = uniqueName();
    expect(await ok(a, 'set_username', { username: renamed })).toEqual({
      username: renamed,
      welcomePackId: null,
    });
    expect(await fails(a, 'set_username', { username: uniqueName() })).toBe('username_locked');
    expect(await profileOf(a.id)).toMatchObject({ username: renamed, username_changes: 1 });
    const packs = await admin().from('packs').select('id').eq('user_id', a.id);
    expect(packs.data).toHaveLength(1);
  });

  it('set_deck', async () => {
    const p = await namedGuest();
    expect(await fails(p, 'set_deck', { cards: ['archer', 'knight', 'skeleton'] })).toBe(
      'deck_invalid',
    );
    expect(await fails(p, 'set_deck', { cards: ['archer', 'archer', 'skeleton', 'bat'] })).toBe(
      'deck_invalid',
    );
    // Not owned (the welcome pack is still closed).
    expect(
      await fails(p, 'set_deck', { cards: ['archer', 'knight', 'skeleton', 'musketeer'] }),
    ).toBe('deck_invalid');
    // Unknown card id: not a valid request at all.
    const r = await raw({
      token: p.token,
      body: JSON.stringify({
        action: 'set_deck',
        cards: ['archer', 'knight', 'skeleton', 'dragon'],
      }),
    });
    expect(r.body).toEqual({ ok: false, error: { code: 'bad_request' } });
  });

  it('level_up_card', async () => {
    const p = await namedGuest();
    const cost = levelUpCost('archer', 1) as { copies: number; gold: number };
    expect(await fails(p, 'level_up_card', { card: 'archer' })).toBe('not_enough_copies');
    await patchCard(p.id, 'archer', { copies: cost.copies });
    expect(await fails(p, 'level_up_card', { card: 'archer' })).toBe('not_enough_gold');
    expect(await fails(p, 'level_up_card', { card: 'musketeer' })).toBe('card_not_owned');
    await patchCard(p.id, 'knight', { level: MAX_LEVEL, copies: 1000 });
    await patchProfile(p.id, { gold: 100_000 });
    expect(await fails(p, 'level_up_card', { card: 'knight' })).toBe('max_level');
    // Nothing was booked by the failures.
    expect(await profileOf(p.id)).toMatchObject({ gold: 100_000 });
  });

  it('unlock_upgrade', async () => {
    const p = await namedGuest();
    expect(await fails(p, 'unlock_upgrade', { card: 'archer', upgrade: 0 })).toBe('level_too_low');
    expect(await fails(p, 'unlock_upgrade', { card: 'musketeer', upgrade: 0 })).toBe(
      'card_not_owned',
    );
    await patchCard(p.id, 'archer', { level: 2 });
    expect(await fails(p, 'unlock_upgrade', { card: 'archer', upgrade: 0 })).toBe(
      'not_enough_gold',
    );
    await patchProfile(p.id, { gold: 10_000 });
    await ok(p, 'unlock_upgrade', { card: 'archer', upgrade: 0 });
    expect(await fails(p, 'unlock_upgrade', { card: 'archer', upgrade: 0 })).toBe(
      'upgrade_already_unlocked',
    );
    const bad = await raw({
      token: p.token,
      body: JSON.stringify({ action: 'unlock_upgrade', card: 'archer', upgrade: 3 }),
    });
    expect(bad.body).toEqual({ ok: false, error: { code: 'bad_request' } });
  });

  it('spend_jokers', async () => {
    const p = await namedGuest();
    expect(await fails(p, 'spend_jokers', { card: 'musketeer', copies: 1 })).toBe(
      'not_enough_jokers',
    );
    // whelp belongs to arena 5.
    await patchProfile(p.id, { jokers: 100 });
    expect(await fails(p, 'spend_jokers', { card: 'whelp', copies: 1 })).toBe('card_not_in_pool');
    expect(await fails(p, 'spend_jokers', { card: 'musketeer', copies: 0 })).toBe('bad_request');
    expect((await profileOf(p.id)).jokers).toBe(100);
  });

  it('create_match', async () => {
    const guest = await newGuest();
    expect(
      await fails(guest, 'create_match', { botLevel: 'easy', engineVersion: ENGINE_VERSION }),
    ).toBe('username_missing');
    const p = await namedGuest();
    expect(
      await fails(p, 'create_match', { botLevel: 'easy', engineVersion: ENGINE_VERSION + 1 }),
    ).toBe('engine_mismatch');
    const bad = await raw({
      token: p.token,
      body: JSON.stringify({
        action: 'create_match',
        botLevel: 'master',
        engineVersion: ENGINE_VERSION,
      }),
    });
    expect(bad.body).toEqual({ ok: false, error: { code: 'bad_request' } });
    const matches = await admin().from('matches').select('id').eq('player_a', p.id);
    expect(matches.data).toEqual([]);
  });

  it('report_match and open_pack with unknown or wrong ids', async () => {
    const p = await namedGuest();
    expect(await fails(p, 'report_match', { matchId: MISSING_ID, picks: [] })).toBe(
      'match_not_found',
    );
    expect(await fails(p, 'open_pack', { packId: MISSING_ID })).toBe('pack_not_found');
    await ok(p, 'open_pack', { packId: p.welcomePackId });
    expect(await fails(p, 'open_pack', { packId: p.welcomePackId })).toBe('pack_already_opened');
    const bad = await raw({
      token: p.token,
      body: JSON.stringify({ action: 'open_pack', packId: 'not-a-uuid' }),
    });
    expect(bad.body).toEqual({ ok: false, error: { code: 'bad_request' } });
  });
});

describe.skipIf(!CONFIGURED)('matches', () => {
  it('an incomplete report keeps the match open; the full report books it', async () => {
    const p = await namedGuest();
    const { ticket } = await ok(p, 'create_match', {
      botLevel: 'easy',
      engineVersion: ENGINE_VERSION,
    });
    const played = playMatch(ticket, 3);
    const half = played.picks.slice(0, 5);
    const r = await call(p, 'report_match', { matchId: ticket.matchId, picks: half });
    expect(r.body).toEqual({ ok: false, error: { code: 'match_rejected', detail: 'incomplete' } });
    expect((await matchOf(ticket.matchId)).result).toBe('pending');
    const booked = await ok(p, 'report_match', { matchId: ticket.matchId, picks: played.picks });
    expect(booked.outcome).toBe(played.outcome);
  });

  it('resumes the open match, or forfeits it as a loss', async () => {
    const p = await namedGuest();
    const first = await ok(p, 'create_match', { botLevel: 'easy', engineVersion: ENGINE_VERSION });
    const resumed = await ok(p, 'create_match', {
      botLevel: 'medium',
      engineVersion: ENGINE_VERSION,
      pending: 'resume',
    });
    expect(resumed).toEqual({ ticket: first.ticket, resumed: true });

    const before = await profileOf(p.id);
    const fresh = await ok(p, 'create_match', {
      botLevel: 'medium',
      engineVersion: ENGINE_VERSION,
      pending: 'forfeit',
    });
    expect(fresh.resumed).toBe(false);
    expect(fresh.ticket.matchId).not.toBe(first.ticket.matchId);
    expect(fresh.ticket.botLevel).toBe('medium');
    const delta = eloChange({
      elo: before.elo,
      opponentElo: BOT_LEVELS.easy.elo,
      score: 0,
      gamesPlayed: 0,
      vsBot: true,
    });
    expect(await matchOf(first.ticket.matchId)).toMatchObject({
      result: 'b_won',
      elo_delta_a: delta,
      picks: [],
    });
    // A forfeit counts as a loss, without the consolation gold.
    expect(await profileOf(p.id)).toMatchObject({
      elo: before.elo + delta,
      games_played: 1,
      gold: before.gold,
    });
    expect((await matchOf(fresh.ticket.matchId)).result).toBe('pending');
  });

  it('rejects a manipulated bot pick and books it as a loss without gold', async () => {
    const p = await namedGuest();
    const { ticket } = await ok(p, 'create_match', {
      botLevel: 'easy',
      engineVersion: ENGINE_VERSION,
    });
    const cheated = playMatch(ticket, 7, 1);
    const before = await profileOf(p.id);
    const r = await call(p, 'report_match', { matchId: ticket.matchId, picks: cheated.picks });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: false,
      error: { code: 'match_rejected', detail: 'bot_mismatch' },
    });
    const delta = eloChange({
      elo: before.elo,
      opponentElo: BOT_LEVELS.easy.elo,
      score: 0,
      gamesPlayed: before.games_played,
      vsBot: true,
    });
    expect(delta).toBeLessThan(0);
    expect(await matchOf(ticket.matchId)).toMatchObject({
      result: 'b_won',
      picks: cheated.picks,
      elo_delta_a: delta,
    });
    // Like giving up: the Elo of a loss, one more game, no consolation gold, no pack.
    expect(await profileOf(p.id)).toEqual({
      ...before,
      elo: before.elo + delta,
      games_played: before.games_played + 1,
    });
    const packs = await admin().from('packs').select('id').eq('match_id', ticket.matchId);
    expect(packs.data).toEqual([]);

    // Reporting the honest picks afterwards books nothing. Known gap (handlers.ts,
    // bookedResult): the answer is the stored loss with the usual consolation gold.
    const after = await profileOf(p.id);
    const honest = playMatch(ticket, 7);
    expect(await ok(p, 'report_match', { matchId: ticket.matchId, picks: honest.picks })).toEqual({
      outcome: 'loss',
      eloDelta: delta,
      elo: after.elo,
      highestArena: after.highest_arena,
      arenaUnlocked: false,
      gold: LOSS_GOLD,
      packId: null,
      repeated: true,
    });
    expect(await profileOf(p.id)).toEqual(after);
    // The player can start the next match right away.
    await ok(p, 'create_match', { botLevel: 'easy', engineVersion: ENGINE_VERSION });
  });

  it('books picks after the end as a loss without gold', async () => {
    // 'bad_picks' cannot be reached through HTTP: the request check refuses slots outside
    // 0..OFFER_SIZE-1 (bad_request), and every offer has OFFER_SIZE slots. The handler tests
    // cover it.
    const p = await namedGuest();
    // Below 1100, so the arena stays the same.
    await patchProfile(p.id, { games_played: 40, elo: 1050, gold: 33 });
    const { ticket } = await ok(p, 'create_match', {
      botLevel: 'medium',
      engineVersion: ENGINE_VERSION,
    });
    const before = await profileOf(p.id);
    const sent = [...playMatch(ticket, 5).picks, 0];
    const r = await call(p, 'report_match', { matchId: ticket.matchId, picks: sent });
    expect(r.body).toEqual({ ok: false, error: { code: 'match_rejected', detail: 'leftover' } });
    const delta = eloChange({
      elo: before.elo,
      opponentElo: BOT_LEVELS.medium.elo,
      score: 0,
      gamesPlayed: before.games_played,
      vsBot: true,
    });
    expect(await matchOf(ticket.matchId)).toMatchObject({
      result: 'b_won',
      picks: sent,
      elo_delta_a: delta,
    });
    expect(await profileOf(p.id)).toEqual({
      ...before,
      elo: before.elo + delta,
      games_played: 41,
    });
  });

  it('drops a match of another engine version', async () => {
    const p = await namedGuest();
    const profile = BOT_PROFILES.find((b) => b.level === 'easy');
    const old = await admin()
      .from('matches')
      .insert({
        player_a: p.id,
        bot_level: 'easy',
        bot_profile: profile?.id,
        seed: 12345,
        engine_version: ENGINE_VERSION - 1,
        setup: {
          deck: ['archer', 'knight', 'skeleton', 'healer'],
          levels: { archer: 1, knight: 1, skeleton: 1, healer: 1 },
        },
      })
      .select('id')
      .single();
    expect(old.error).toBeNull();
    const oldId = (old.data as { id: string }).id;

    expect(await fails(p, 'report_match', { matchId: oldId, picks: [0, 1, 2] })).toBe(
      'engine_mismatch',
    );
    expect(await matchOf(oldId)).toMatchObject({ result: 'abandoned', elo_delta_a: 0 });

    // A pending old match is dropped by create_match, without Elo, and a new one starts.
    const older = await admin()
      .from('matches')
      .insert({
        player_a: p.id,
        bot_level: 'easy',
        bot_profile: profile?.id,
        seed: 1,
        engine_version: ENGINE_VERSION - 1,
        setup: { deck: ['archer', 'knight', 'skeleton', 'healer'], levels: {} },
      })
      .select('id')
      .single();
    const olderId = (older.data as { id: string }).id;
    const before = await profileOf(p.id);
    const created = await ok(p, 'create_match', {
      botLevel: 'easy',
      engineVersion: ENGINE_VERSION,
    });
    expect(created.resumed).toBe(false);
    expect(created.ticket.engineVersion).toBe(ENGINE_VERSION);
    expect((await matchOf(olderId)).result).toBe('abandoned');
    expect(await profileOf(p.id)).toEqual(before);
  });
});
