-- =============================================================================
-- Constraints: even the service_role (Edge Functions) cannot store invalid
-- data. 23514 = check_violation, 23505 = unique_violation,
-- 23503 = foreign_key_violation, 23502 = not_null_violation.
-- =============================================================================

set role service_role;

-- ---- profiles: username (SPEC 9) --------------------------------------------
select tests.throws($$update public.profiles set username = 'ab' where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'username with 2 characters is rejected');
select tests.throws($$update public.profiles set username = 'abcdefghijklmnopq' where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'username with 17 characters is rejected');
select tests.throws($$update public.profiles set username = 'bad name' where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'username with a space is rejected');
select tests.throws($$update public.profiles set username = 'bad-name' where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'username with a hyphen is rejected');
select tests.throws($$update public.profiles set username = 'Jörg' where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'username with an umlaut is rejected');
select tests.throws($$update public.profiles set username = U&'\212Aarl' where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'username with the Kelvin sign look-alike is rejected');
select tests.throws($$update public.profiles set username = '' where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'empty username is rejected');
select tests.throws($$update public.profiles set username = 'alice_1' where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23505', 'username taken in other case (alice_1 vs Alice_1) is rejected');
select tests.throws($$update public.profiles set username = 'BOB_2' where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23505', 'username taken in upper case (BOB_2 vs Bob_2) is rejected');
select tests.lives($$update public.profiles set username = 'Carl_3456789_ABC' where id = '00000000-0000-0000-0000-00000000000c'$$,
                   'valid username with 16 characters is accepted');
select tests.lives($$update public.profiles set username = 'Carl_3' where id = '00000000-0000-0000-0000-00000000000c'$$,
                   'valid username with digits and underscore is accepted');

-- ---- profiles: numbers ------------------------------------------------------
select tests.throws($$update public.profiles set gold = -1 where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'negative gold is rejected');
select tests.throws($$update public.profiles set jokers = -1 where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'negative jokers are rejected');
select tests.throws($$update public.profiles set elo = -1 where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'negative Elo is rejected');
select tests.throws($$update public.profiles set highest_arena = 0 where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'arena 0 is rejected');
select tests.throws($$update public.profiles set highest_arena = 6 where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'arena 6 is rejected');
select tests.throws($$update public.profiles set games_played = -1 where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'negative games_played is rejected');
select tests.throws($$update public.profiles set username_changes = -1 where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'negative username_changes is rejected');
select tests.throws($$update public.profiles set gold = null where id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23502', 'gold cannot be NULL');
select tests.throws($$insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000000ff')$$,
                    '23503', 'profile without auth user is rejected');

-- ---- player_cards -----------------------------------------------------------
select tests.throws($$update public.player_cards set level = 6 where user_id = '00000000-0000-0000-0000-00000000000c' and card_id = 'bat'$$,
                    '23514', 'card level 6 is rejected');
select tests.throws($$update public.player_cards set level = 0 where user_id = '00000000-0000-0000-0000-00000000000c' and card_id = 'bat'$$,
                    '23514', 'card level 0 is rejected');
select tests.throws($$update public.player_cards set copies = -1 where user_id = '00000000-0000-0000-0000-00000000000c' and card_id = 'bat'$$,
                    '23514', 'negative copies are rejected');
select tests.throws($$update public.player_cards set unlocked_upgrades = 8 where user_id = '00000000-0000-0000-0000-00000000000c' and card_id = 'bat'$$,
                    '23514', 'upgrade mask 8 is rejected');
select tests.throws($$update public.player_cards set unlocked_upgrades = -1 where user_id = '00000000-0000-0000-0000-00000000000c' and card_id = 'bat'$$,
                    '23514', 'negative upgrade mask is rejected');
select tests.throws($$insert into public.player_cards (user_id, card_id) values ('00000000-0000-0000-0000-00000000000c', 'Archer')$$,
                    '23514', 'card id with upper case is rejected');
select tests.throws($$insert into public.player_cards (user_id, card_id) values ('00000000-0000-0000-0000-00000000000c', 'archer')$$,
                    '23505', 'the same card twice for one player is rejected');
select tests.throws($$insert into public.player_cards (user_id, card_id) values ('00000000-0000-0000-0000-0000000000ff', 'archer')$$,
                    '23503', 'card for an unknown player is rejected');

-- ---- decks ------------------------------------------------------------------
select tests.throws($$update public.decks set cards = array['archer','knight','skeleton'] where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'deck with 3 cards is rejected');
select tests.throws($$update public.decks set cards = array['archer','knight','skeleton','healer','bat'] where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'deck with 5 cards is rejected');
select tests.throws($$update public.decks set cards = array['archer','knight','archer','healer'] where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'deck with a duplicate card is rejected');
select tests.throws($$update public.decks set cards = array['archer','knight','skeleton','skeleton'] where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'deck with a duplicate in the last slots is rejected');
select tests.throws($$update public.decks set cards = array['archer','knight',null,'healer'] where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'deck with an empty slot is rejected');
select tests.throws($$update public.decks set cards = '{}' where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'empty deck is rejected');
select tests.throws($$update public.decks set cards = '{{archer,knight},{skeleton,healer}}' where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'two-dimensional deck is rejected');
select tests.throws($$update public.decks set cards = '[0:3]={archer,knight,skeleton,healer}' where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'deck with shifted array bounds is rejected');
select tests.throws($$update public.decks set cards = array['archer','knight','skeleton','Healer'] where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'deck with an invalid card id is rejected');
select tests.throws($$update public.decks set cards = array['archer','knight,bat','skeleton','healer'] where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                    '23514', 'deck slot containing a comma is rejected');
select tests.lives($$update public.decks set cards = array['bat','tnt','knight','archer'] where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                   'deck with four different cards is accepted');

-- ---- matches ----------------------------------------------------------------
select tests.throws($$insert into public.matches (player_a, seed, engine_version) values ('00000000-0000-0000-0000-00000000000c', 1, 1)$$,
                    '23514', 'match without opponent is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, seed, engine_version) values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 'easy', 1, 1)$$,
                    '23514', 'match with human and bot opponent is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, seed, engine_version) values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', 1, 1)$$,
                    '23514', 'match against oneself is rejected');
select tests.throws($$insert into public.matches (player_a, bot_level, seed, engine_version) values ('00000000-0000-0000-0000-00000000000c', 'insane', 1, 1)$$,
                    '23514', 'unknown bot level is rejected');
select tests.throws($$insert into public.matches (player_a, bot_level, seed, engine_version, result) values ('00000000-0000-0000-0000-00000000000c', 'easy', 1, 1, 'won')$$,
                    '23514', 'unknown match result is rejected');
select tests.throws($$insert into public.matches (player_a, bot_level, seed, engine_version) values ('00000000-0000-0000-0000-00000000000c', 'easy', -1, 1)$$,
                    '23514', 'negative seed is rejected');
select tests.throws($$insert into public.matches (player_a, bot_level, seed, engine_version) values ('00000000-0000-0000-0000-00000000000c', 'easy', 9007199254740992, 1)$$,
                    '23514', 'seed above 2^53-1 is rejected');
select tests.throws($$insert into public.matches (player_a, bot_level, seed, engine_version) values ('00000000-0000-0000-0000-00000000000c', 'easy', 1, 0)$$,
                    '23514', 'engine_version 0 is rejected');
select tests.throws($$insert into public.matches (player_a, bot_level, seed, engine_version, picks) values ('00000000-0000-0000-0000-00000000000c', 'easy', 1, 1, '{"a": 1}')$$,
                    '23514', 'picks that are not a JSON array are rejected');
select tests.throws($$insert into public.matches (player_a, bot_level, seed, engine_version, elo_delta_b) values ('00000000-0000-0000-0000-00000000000c', 'easy', 1, 1, 5)$$,
                    '23514', 'Elo change for the bot side is rejected');
select tests.throws($$insert into public.matches (player_a, bot_level, engine_version) values ('00000000-0000-0000-0000-00000000000c', 'easy', 1)$$,
                    '23502', 'match without seed is rejected');

-- ---- packs ------------------------------------------------------------------
select tests.throws($$insert into public.packs (user_id, opened) values ('00000000-0000-0000-0000-00000000000c', true)$$,
                    '23514', 'opened pack without contents is rejected');
select tests.throws($$insert into public.packs (user_id, contents) values ('00000000-0000-0000-0000-00000000000c', '[1, 2]')$$,
                    '23514', 'pack contents that are not a JSON object are rejected');
select tests.throws($$insert into public.packs (user_id, match_id) values ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-0000000000ab')$$,
                    '23505', 'a second pack for the same match is rejected');
select tests.throws($$insert into public.packs (user_id, match_id) values ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-0000000000ff')$$,
                    '23503', 'pack for an unknown match is rejected');

-- ---- friendships ------------------------------------------------------------
select tests.throws($$insert into public.friendships (user_id, friend_id) values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c')$$,
                    '23514', 'friendship with oneself is rejected');
select tests.throws($$insert into public.friendships (user_id, friend_id, status) values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 'blocked')$$,
                    '23514', 'unknown friendship status is rejected');
select tests.throws($$insert into public.friendships (user_id, friend_id) values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a')$$,
                    '23505', 'the reverse of an existing friendship is rejected');

reset role;

-- ---- packs keep their reward when the match disappears ----------------------
delete from public.matches where id = '10000000-0000-0000-0000-0000000000ab';
do $$
begin
  perform tests.ok(
    (select match_id is null from public.packs where id = '20000000-0000-0000-0000-00000000000a'),
    'deleting a match keeps the pack and clears match_id');
end;
$$;
