/**
 * Two requests at the same time (double click, retry) must never book twice (D-082): the SQL
 * functions lock the profile row and check the state again.
 */
import { BOT_LEVELS, ENGINE_VERSION, WELCOME_PACK } from '@rumble-realms/engine';
import { eloChange, levelUpCost } from '@rumble-realms/shared';
import { describe, expect, it } from 'vitest';
import { CONFIGURED } from './env.ts';
import {
  call,
  cardsOf,
  namedGuest,
  ok,
  packOf,
  patchCard,
  patchProfile,
  playMatch,
  profileOf,
} from './helpers.ts';

describe.skipIf(!CONFIGURED)('parallel requests', () => {
  it('open the same pack only once', async () => {
    const p = await namedGuest();
    const answers = await Promise.all(
      [0, 1, 2].map(() => call(p, 'open_pack', { packId: p.welcomePackId })),
    );
    const wins = answers.filter((a) => a.body.ok);
    const losses = answers.filter((a) => !a.body.ok);
    expect(wins).toHaveLength(1);
    for (const a of losses) {
      expect(a.status).toBe(200);
      expect(a.body).toEqual({ ok: false, error: { code: 'pack_already_opened' } });
    }
    expect((await cardsOf(p.id)).get(WELCOME_PACK.card)?.copies).toBe(WELCOME_PACK.copies);
    expect((await packOf(p.welcomePackId)).opened).toBe(true);
  });

  it('book a level-up only once when the resources suffice for one', async () => {
    const p = await namedGuest();
    const cost = levelUpCost('archer', 1) as { copies: number; gold: number };
    await patchCard(p.id, 'archer', { copies: cost.copies });
    await patchProfile(p.id, { gold: cost.gold });
    const answers = await Promise.all(
      [0, 1].map(() => call(p, 'level_up_card', { card: 'archer' })),
    );
    expect(answers.filter((a) => a.body.ok)).toHaveLength(1);
    const failed = answers.find((a) => !a.body.ok);
    expect(failed?.status).toBe(200);
    expect(failed?.body.ok === false && failed.body.error.code).toMatch(
      /^not_enough_(copies|gold)$/,
    );
    expect((await cardsOf(p.id)).get('archer')).toMatchObject({ level: 2, copies: 0 });
    expect((await profileOf(p.id)).gold).toBe(0);
  });

  it('book a reported match only once', async () => {
    const p = await namedGuest();
    const { ticket } = await ok(p, 'create_match', {
      botLevel: 'easy',
      engineVersion: ENGINE_VERSION,
    });
    const played = playMatch(ticket, 11);
    const answers = await Promise.all(
      [0, 1].map(() => call(p, 'report_match', { matchId: ticket.matchId, picks: played.picks })),
    );
    const data = answers.map((a) => {
      expect(a.status).toBe(200);
      if (!a.body.ok) throw new Error(JSON.stringify(a.body.error));
      return a.body.data;
    });
    expect(data.map((d) => d.repeated).sort()).toEqual([false, true]);
    expect(new Set(data.map((d) => d.eloDelta)).size).toBe(1);
    expect((await profileOf(p.id)).games_played).toBe(1);
  });

  it('book a rejected report (a loss, D-084) only once', async () => {
    const p = await namedGuest();
    const { ticket } = await ok(p, 'create_match', {
      botLevel: 'easy',
      engineVersion: ENGINE_VERSION,
    });
    const cheated = playMatch(ticket, 11, 0);
    const before = await profileOf(p.id);
    const answers = await Promise.all(
      [0, 1].map(() => call(p, 'report_match', { matchId: ticket.matchId, picks: cheated.picks })),
    );
    for (const a of answers) {
      expect(a.status).toBe(200);
      // Each one is rejected, or a late one answers with the booking of the first one.
      if (a.body.ok) expect(a.body.data).toMatchObject({ outcome: 'loss', repeated: true });
      else expect(a.body.error).toEqual({ code: 'match_rejected', detail: 'bot_mismatch' });
    }
    expect(answers.some((a) => !a.body.ok)).toBe(true);
    const delta = eloChange({
      elo: before.elo,
      opponentElo: BOT_LEVELS.easy.elo,
      score: 0,
      gamesPlayed: before.games_played,
      vsBot: true,
    });
    expect(await profileOf(p.id)).toEqual({
      ...before,
      elo: before.elo + delta,
      games_played: before.games_played + 1,
    });
  });

  it('create only one match at a time', async () => {
    const p = await namedGuest();
    const answers = await Promise.all(
      [0, 1].map(() =>
        call(p, 'create_match', { botLevel: 'easy', engineVersion: ENGINE_VERSION }),
      ),
    );
    const ids = answers.map((a) => (a.body.ok ? a.body.data.ticket.matchId : 'failed'));
    expect(ids[0]).toBe(ids[1]);
    expect(answers.map((a) => (a.body.ok ? a.body.data.resumed : null)).sort()).toEqual([
      false,
      true,
    ]);
  });
});
