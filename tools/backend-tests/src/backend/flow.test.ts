/**
 * The whole life of a player over HTTP, like the app: name, welcome pack, bot matches played
 * locally and reported, reward pack, then spending gold, copies and jokers.
 */
import {
  BOT_LEVELS,
  ENGINE_VERSION,
  LOSS_GOLD,
  STARTER_DECK,
  WELCOME_PACK,
} from '@rumble-realms/engine';
import { eloChange, jokerCost, levelUpCost, upgradeUnlockCost } from '@rumble-realms/shared';
import type { MatchOutcome } from '@rumble-realms/shared';
import { describe, expect, it } from 'vitest';
import { CONFIGURED } from './env.ts';
import {
  cardsOf,
  deckOf,
  matchOf,
  namedGuest,
  ok,
  packOf,
  patchCard,
  patchProfile,
  playFor,
  profileOf,
  rewardDelta,
  winnableMatch,
} from './helpers.ts';

const SCORE: Record<MatchOutcome, 0 | 0.5 | 1> = { win: 1, draw: 0.5, loss: 0 };
const RESULT: Record<MatchOutcome, string> = { win: 'a_won', loss: 'b_won', draw: 'draw' };

describe.skipIf(!CONFIGURED)('the full flow of a player', () => {
  it('plays, gets rewarded and spends', async () => {
    // --- Onboarding: name and welcome pack ---
    const p = await namedGuest();
    expect((await profileOf(p.id)).username).toBe(p.username);
    expect(await packOf(p.welcomePackId)).toMatchObject({
      user_id: p.id,
      kind: 'welcome',
      match_id: null,
      opened: false,
      contents: null,
    });

    const welcome = await ok(p, 'open_pack', { packId: p.welcomePackId });
    expect(welcome).toEqual({
      reward: { kind: 'cards', card: WELCOME_PACK.card, copies: WELCOME_PACK.copies },
      cardUnlocked: true,
    });
    expect((await cardsOf(p.id)).get(WELCOME_PACK.card)).toEqual({
      card_id: WELCOME_PACK.card,
      level: 1,
      copies: WELCOME_PACK.copies,
      unlocked_upgrades: 0,
    });
    expect(await packOf(p.welcomePackId)).toMatchObject({
      opened: true,
      contents: welcome.reward,
    });

    // --- First match: one the human can win (see winnableMatch) ---
    const { ticket, played: won } = await winnableMatch(p);
    expect(ticket.engineVersion).toBe(ENGINE_VERSION);
    expect(ticket.botLevel).toBe('easy');
    expect(ticket.player).toEqual({
      deck: [...STARTER_DECK],
      levels: Object.fromEntries(STARTER_DECK.map((c) => [c, 1])),
      upgrades: Object.fromEntries(STARTER_DECK.map((c) => [c, 0])),
    });
    expect(Number.isSafeInteger(ticket.seed) && ticket.seed >= 0).toBe(true);
    expect((await matchOf(ticket.matchId)).result).toBe('pending');
    expect(won.outcome).toBe('win');
    const before = await profileOf(p.id);
    const report = await ok(p, 'report_match', { matchId: ticket.matchId, picks: won.picks });
    const delta = eloChange({
      elo: before.elo,
      opponentElo: BOT_LEVELS.easy.elo,
      score: 1,
      gamesPlayed: 0,
      vsBot: true,
    });
    expect(report).toMatchObject({
      outcome: 'win',
      eloDelta: delta,
      elo: before.elo + delta,
      highestArena: 1,
      arenaUnlocked: false,
      gold: 0,
      repeated: false,
    });
    expect(report.packId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await profileOf(p.id)).toMatchObject({
      elo: before.elo + delta,
      games_played: 1,
      gold: 0,
    });
    const stored = await matchOf(ticket.matchId);
    expect(stored).toMatchObject({ result: 'a_won', picks: won.picks, elo_delta_a: delta });
    expect(stored.finished_at).not.toBeNull();
    expect(await packOf(report.packId as string)).toMatchObject({
      user_id: p.id,
      kind: 'match',
      match_id: ticket.matchId,
      opened: false,
    });

    // Reporting again changes nothing and answers with the booking.
    const again = await ok(p, 'report_match', { matchId: ticket.matchId, picks: won.picks });
    expect(again).toMatchObject({
      outcome: 'win',
      eloDelta: delta,
      packId: report.packId,
      repeated: true,
    });
    expect((await profileOf(p.id)).games_played).toBe(1);

    // --- The reward pack ---
    const beforePack = await profileOf(p.id);
    const cardsBeforePack = await cardsOf(p.id);
    const opened = await ok(p, 'open_pack', { packId: report.packId as string });
    const change = rewardDelta(opened.reward);
    const afterPack = await profileOf(p.id);
    expect(afterPack.gold).toBe(beforePack.gold + change.gold);
    expect(afterPack.jokers).toBe(beforePack.jokers + change.jokers);
    if (change.card !== undefined) {
      const had = cardsBeforePack.get(change.card)?.copies ?? 0;
      expect((await cardsOf(p.id)).get(change.card)?.copies).toBe(had + change.copies);
      expect(opened.cardUnlocked).toBe(!cardsBeforePack.has(change.card));
    }
    expect(await packOf(report.packId as string)).toMatchObject({
      opened: true,
      contents: opened.reward,
    });

    // --- Second match: consolation gold unless it is won ---
    const second = await ok(p, 'create_match', {
      botLevel: 'easy',
      engineVersion: ENGINE_VERSION,
    });
    const played = playFor(second.ticket, 'loss');
    const mid = await profileOf(p.id);
    const r2 = await ok(p, 'report_match', {
      matchId: second.ticket.matchId,
      picks: played.picks,
    });
    const d2 = eloChange({
      elo: mid.elo,
      opponentElo: BOT_LEVELS.easy.elo,
      score: SCORE[played.outcome],
      gamesPlayed: 1,
      vsBot: true,
    });
    const gold2 = played.outcome === 'win' ? 0 : LOSS_GOLD;
    expect(r2).toMatchObject({ outcome: played.outcome, eloDelta: d2, gold: gold2 });
    expect(r2.packId === null).toBe(played.outcome !== 'win');
    expect(await profileOf(p.id)).toMatchObject({
      elo: Math.max(0, mid.elo + d2),
      games_played: 2,
      gold: mid.gold + gold2,
    });
    expect((await matchOf(second.ticket.matchId)).result).toBe(RESULT[played.outcome]);

    // --- Spending: fill up gold, jokers and copies with the admin client ---
    await patchProfile(p.id, { gold: 100_000, jokers: 100, highest_arena: 2 });
    await patchCard(p.id, 'archer', { copies: 100 });

    const lvl = levelUpCost('archer', 1) as { copies: number; gold: number };
    const up = await ok(p, 'level_up_card', { card: 'archer' });
    expect(up).toEqual({
      card: 'archer',
      level: 2,
      copies: 100 - lvl.copies,
      gold: 100_000 - lvl.gold,
    });
    expect((await cardsOf(p.id)).get('archer')).toMatchObject({
      level: 2,
      copies: 100 - lvl.copies,
    });

    const upgradeCost = upgradeUnlockCost(0);
    const unlocked = await ok(p, 'unlock_upgrade', { card: 'archer', upgrade: 0 });
    expect(unlocked).toEqual({
      card: 'archer',
      unlockedUpgrades: 1,
      gold: 100_000 - lvl.gold - upgradeCost.gold,
    });
    expect((await cardsOf(p.id)).get('archer')?.unlocked_upgrades).toBe(1);

    const jokers = await ok(p, 'spend_jokers', { card: 'assassin', copies: 3 });
    expect(jokers).toEqual({ card: 'assassin', copies: 3, jokers: 100 - jokerCost('assassin', 3) });
    expect((await cardsOf(p.id)).get('assassin')).toEqual({
      card_id: 'assassin',
      level: 1,
      copies: 3,
      unlocked_upgrades: 0,
    });
    expect(await profileOf(p.id)).toMatchObject({
      gold: 100_000 - lvl.gold - upgradeCost.gold,
      jokers: 100 - jokerCost('assassin', 3),
    });

    const deck = ['archer', 'musketeer', 'assassin', 'knight'] as const;
    expect(await ok(p, 'set_deck', { cards: [...deck] })).toEqual({ cards: [...deck] });
    expect(await deckOf(p.id)).toEqual([...deck]);

    // The next match takes the new deck, levels and upgrades as its snapshot.
    const third = await ok(p, 'create_match', {
      botLevel: 'medium',
      engineVersion: ENGINE_VERSION,
    });
    expect(third.ticket.player).toEqual({
      deck: [...deck],
      levels: { archer: 2, musketeer: 1, assassin: 1, knight: 1 },
      upgrades: { archer: 1, musketeer: 0, assassin: 0, knight: 0 },
    });
  });
});
