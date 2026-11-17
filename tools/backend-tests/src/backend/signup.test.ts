/**
 * A new account (database trigger, migration section 3) must match the engine's start values:
 * they are written twice, in SQL and in packages/engine/src/data/progression.ts.
 */
import { ELO, STARTER_CARDS, STARTER_COPIES, STARTER_DECK } from '@rumble-realms/engine';
import { describe, expect, it } from 'vitest';
import { CONFIGURED } from './env.ts';
import { newGuest } from './helpers.ts';

describe.skipIf(!CONFIGURED)('a new guest account', () => {
  it('has the profile, start cards and start deck of the engine (read as the guest)', async () => {
    const guest = await newGuest();

    const profile = await guest.db.from('profiles').select('*').eq('id', guest.id).single();
    expect(profile.error).toBeNull();
    expect(profile.data).toMatchObject({
      id: guest.id,
      username: null,
      username_changes: 0,
      elo: ELO.start,
      highest_arena: 1,
      gold: 0,
      jokers: 0,
      games_played: 0,
    });

    const cards = await guest.db
      .from('player_cards')
      .select('card_id, level, copies, unlocked_upgrades');
    expect(cards.error).toBeNull();
    expect([...(cards.data ?? [])].sort((a, b) => a.card_id.localeCompare(b.card_id))).toEqual(
      [...STARTER_CARDS].sort().map((card_id) => ({
        card_id,
        level: 1,
        copies: STARTER_COPIES,
        unlocked_upgrades: 0,
      })),
    );

    const deck = await guest.db.from('decks').select('cards').single();
    expect(deck.error).toBeNull();
    expect(deck.data?.cards).toEqual([...STARTER_DECK]);

    const packs = await guest.db.from('packs').select('id');
    expect(packs.data).toEqual([]);
    const matches = await guest.db.from('matches').select('id');
    expect(matches.data).toEqual([]);
  });
});
