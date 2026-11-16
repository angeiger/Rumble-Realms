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
-- Every statement is a valid finished bot match of C except for the one value
-- under test, so it can only fail for the reason named.
select tests.lives($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup, result, finished_at) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', 1, 1, '{"deck": []}', 'b_won', now())$$,
                   'valid finished bot match is accepted');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, null, null, 1, 1, '{"deck": []}')$$,
                    '23514', 'match without opponent is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 'easy', 'goblin-gustav', 1, 1, '{"deck": []}')$$,
                    '23514', 'match with human and bot opponent is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', null, null, 1, 1, '{"deck": []}')$$,
                    '23514', 'match against oneself is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'insane', 'goblin-gustav', 1, 1, '{"deck": []}')$$,
                    '23514', 'unknown bot level is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', null, 1, 1, '{"deck": []}')$$,
                    '23514', 'bot match without bot profile is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', null, 'goblin-gustav', 1, 1, '{"deck": []}')$$,
                    '23514', 'human match with a bot profile is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'Goblin-Gustav', 1, 1, '{"deck": []}')$$,
                    '23514', 'bot profile with upper case is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin_gustav', 1, 1, '{"deck": []}')$$,
                    '23514', 'bot profile with an underscore is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', '1goblin', 1, 1, '{"deck": []}')$$,
                    '23514', 'bot profile starting with a digit is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'g' || repeat('x', 48), 1, 1, '{"deck": []}')$$,
                    '23514', 'bot profile with 49 characters is rejected');
select tests.lives($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup, result, finished_at) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'g' || repeat('-', 47), 1, 1, '{"deck": []}', 'draw', now())$$,
                   'bot profile with 48 characters is accepted');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup, result) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', 1, 1, '{"deck": []}', 'won')$$,
                    '23514', 'unknown match result is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', -1, 1, '{"deck": []}')$$,
                    '23514', 'negative seed is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', 9007199254740992, 1, '{"deck": []}')$$,
                    '23514', 'seed above 2^53-1 is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', 1, 0, '{"deck": []}')$$,
                    '23514', 'engine_version 0 is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup, picks) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', 1, 1, '{"deck": []}', '{"a": 1}')$$,
                    '23514', 'picks that are not a JSON array are rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', 1, 1, '[1, 2]')$$,
                    '23514', 'setup that is not a JSON object is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', 1, 1, null)$$,
                    '23502', 'match without setup is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup, elo_delta_b) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', 1, 1, '{"deck": []}', 5)$$,
                    '23514', 'Elo change for the bot side is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', null, 1, '{"deck": []}')$$,
                    '23502', 'match without seed is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup, finished_at) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', 1, 1, '{"deck": []}', now())$$,
                    '23514', 'pending match with finished_at is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup, result) values ('00000000-0000-0000-0000-00000000000c', null, 'easy', 'goblin-gustav', 1, 1, '{"deck": []}', 'a_won')$$,
                    '23514', 'finished match without finished_at is rejected');
select tests.throws($$insert into public.matches (player_a, player_b, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000b', null, 'easy', 'goblin-gustav', 1, 1, '{"deck": []}')$$,
                    '23505', 'a second pending match for the same player is rejected');
-- One pending match per player: a single one is fine, a second one is not.
do $$
begin
  perform tests.lives($q$insert into public.matches (id, player_a, bot_level, bot_profile, seed, engine_version, setup) values ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000c', 'easy', 'goblin-gustav', 1, 1, '{}')$q$,
                      'first pending match of C is accepted');
  perform tests.throws($q$insert into public.matches (player_a, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000c', 'hard', 'goblin-gustav', 2, 1, '{}')$q$,
                       '23505', 'second pending match of C is rejected');
  perform tests.lives($q$update public.matches set result = 'abandoned', finished_at = now() where id = '10000000-0000-0000-0000-0000000000c1'$q$,
                      'the pending match of C can be closed');
  perform tests.lives($q$insert into public.matches (player_a, bot_level, bot_profile, seed, engine_version, setup, result, finished_at) values ('00000000-0000-0000-0000-00000000000c', 'hard', 'goblin-gustav', 3, 1, '{}', 'a_won', now())$q$,
                      'finished matches do not count against the pending limit');
end;
$$;

-- ---- packs ------------------------------------------------------------------
select tests.throws($$insert into public.packs (user_id, opened) values ('00000000-0000-0000-0000-00000000000c', true)$$,
                    '23514', 'opened pack without contents is rejected');
select tests.throws($$insert into public.packs (user_id, contents) values ('00000000-0000-0000-0000-00000000000c', '[1, 2]')$$,
                    '23514', 'pack contents that are not a JSON object are rejected');
select tests.throws($$insert into public.packs (user_id, match_id) values ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-0000000000ab')$$,
                    '23505', 'a second pack for the same match is rejected');
select tests.throws($$insert into public.packs (user_id, match_id) values ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-0000000000ff')$$,
                    '23503', 'pack for an unknown match is rejected');
select tests.throws($$insert into public.packs (user_id, kind) values ('00000000-0000-0000-0000-00000000000c', 'bonus')$$,
                    '23514', 'unknown pack kind is rejected');
select tests.throws($$insert into public.packs (user_id, kind) values ('00000000-0000-0000-0000-00000000000c', null)$$,
                    '23502', 'pack kind cannot be NULL');
select tests.throws($$insert into public.packs (user_id, kind, match_id) values ('00000000-0000-0000-0000-00000000000c', 'welcome', '10000000-0000-0000-0000-0000000000bc')$$,
                    '23514', 'welcome pack bound to a match is rejected');
select tests.throws($$insert into public.packs (user_id, kind) values ('00000000-0000-0000-0000-00000000000b', 'welcome')$$,
                    '23505', 'a second welcome pack for the same player is rejected');
select tests.lives($$insert into public.packs (user_id, kind) values ('00000000-0000-0000-0000-00000000000c', 'welcome')$$,
                   'the first welcome pack of a player is accepted');
select tests.lives($$insert into public.packs (user_id) values ('00000000-0000-0000-0000-00000000000b')$$,
                   'more match packs next to a welcome pack are accepted');
select tests.eq((select kind from public.packs where id = '20000000-0000-0000-0000-00000000000a'), 'match',
                'pack kind defaults to match');

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
