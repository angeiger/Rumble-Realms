-- =============================================================================
-- Writing: clients (anon, authenticated) can write nothing, not even their own
-- rows. Every table and every statement type is checked separately; each must
-- fail with 42501 (insufficient_privilege). service_role may write.
-- =============================================================================

select tests.authenticate('00000000-0000-0000-0000-00000000000a');
set role authenticated;

-- profiles (own row of A)
select tests.throws($$update public.profiles set gold = 999999 where id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot raise own gold');
select tests.throws($$update public.profiles set jokers = 99 where id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot raise own jokers');
select tests.throws($$update public.profiles set elo = 3000 where id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot change own Elo');
select tests.throws($$update public.profiles set username = 'Hacker' where id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot change own username directly');
select tests.throws($$update public.profiles set gold = 0 where id = '00000000-0000-0000-0000-00000000000b'$$,
                    '42501', 'A cannot change the profile of B');
select tests.throws($$insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000000ff')$$,
                    '42501', 'A cannot insert a profile');
select tests.throws($$delete from public.profiles where id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot delete own profile');

-- public_profiles (the view is auto-updatable, so this must be locked too)
select tests.throws($$update public.public_profiles set elo = 3000 where id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot update Elo through public_profiles');
select tests.throws($$insert into public.public_profiles (id) values ('00000000-0000-0000-0000-0000000000ff')$$,
                    '42501', 'A cannot insert through public_profiles');
select tests.throws($$delete from public.public_profiles where id = '00000000-0000-0000-0000-00000000000b'$$,
                    '42501', 'A cannot delete through public_profiles');

-- player_cards
select tests.throws($$update public.player_cards set level = 5 where user_id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot level up own cards directly');
select tests.throws($$update public.player_cards set copies = 999 where user_id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot add copies directly');
select tests.throws($$insert into public.player_cards (user_id, card_id) values ('00000000-0000-0000-0000-00000000000a', 'dragon')$$,
                    '42501', 'A cannot insert a card');
select tests.throws($$delete from public.player_cards where user_id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot delete own cards');

-- decks
select tests.throws($$update public.decks set cards = array['archer','knight','skeleton','bat'] where user_id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot change own deck directly');
select tests.throws($$insert into public.decks (user_id, cards) values ('00000000-0000-0000-0000-00000000000c', array['archer','knight','skeleton','bat'])$$,
                    '42501', 'A cannot insert a deck');
select tests.throws($$delete from public.decks where user_id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot delete own deck');

-- matches
select tests.throws($$update public.matches set result = 'a_won' where player_a = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot change a match result');
select tests.throws($$insert into public.matches (player_a, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000a', 'easy', 'goblin-gustav', 1, 1, '{}')$$,
                    '42501', 'A cannot create a match directly');
select tests.throws($$delete from public.matches where player_a = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot delete own matches');

-- packs
select tests.throws($$update public.packs set opened = true, contents = '{"gold": 9999}' where user_id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot open a pack directly');
select tests.throws($$insert into public.packs (user_id) values ('00000000-0000-0000-0000-00000000000a')$$,
                    '42501', 'A cannot create a pack');
select tests.throws($$insert into public.packs (user_id, kind) values ('00000000-0000-0000-0000-00000000000a', 'welcome')$$,
                    '42501', 'A cannot grant itself a welcome pack');
select tests.throws($$delete from public.packs where user_id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot delete own packs');

-- friendships
select tests.throws($$insert into public.friendships (user_id, friend_id) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c')$$,
                    '42501', 'A cannot insert a friendship directly');
select tests.throws($$update public.friendships set status = 'pending' where user_id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot update a friendship');
select tests.throws($$delete from public.friendships where user_id = '00000000-0000-0000-0000-00000000000a'$$,
                    '42501', 'A cannot delete a friendship');

-- truncate on every table
select tests.throws('truncate public.profiles cascade', '42501', 'A cannot truncate profiles');
select tests.throws('truncate public.player_cards', '42501', 'A cannot truncate player_cards');
select tests.throws('truncate public.decks', '42501', 'A cannot truncate decks');
select tests.throws('truncate public.matches cascade', '42501', 'A cannot truncate matches');
select tests.throws('truncate public.packs', '42501', 'A cannot truncate packs');
select tests.throws('truncate public.friendships', '42501', 'A cannot truncate friendships');

-- the trigger function is not callable
select tests.throws('select public.handle_new_player()', '42501', 'A cannot call handle_new_player');

reset role;

-- anon cannot write either.
set role anon;
select tests.throws($$update public.profiles set gold = 1$$, '42501', 'anon cannot update profiles');
select tests.throws($$insert into public.player_cards (user_id, card_id) values ('00000000-0000-0000-0000-00000000000a', 'bat')$$,
                    '42501', 'anon cannot insert player_cards');
select tests.throws($$delete from public.decks$$, '42501', 'anon cannot delete decks');
select tests.throws($$insert into public.matches (player_a, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000a', 'easy', 'goblin-gustav', 1, 1, '{}')$$,
                    '42501', 'anon cannot insert matches');
select tests.throws($$update public.packs set opened = true$$, '42501', 'anon cannot update packs');
select tests.throws($$delete from public.friendships$$, '42501', 'anon cannot delete friendships');
reset role;

-- Nothing changed for A.
do $$
begin
  perform tests.eq((select gold from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 500,
                   'gold of A is unchanged after all attempts');
  perform tests.eq((select count(*) from public.player_cards where user_id = '00000000-0000-0000-0000-00000000000a' and level = 1),
                   6::bigint, 'cards of A are unchanged after all attempts');
end;
$$;

-- service_role (Edge Functions) writes everything; RLS does not stop it.
select tests.clear_auth();
set role service_role;

select tests.lives($$update public.profiles set gold = gold + 100 where id = '00000000-0000-0000-0000-00000000000a'$$,
                   'service_role can update gold');
select tests.lives($$update public.player_cards set level = 2, copies = 0 where user_id = '00000000-0000-0000-0000-00000000000a' and card_id = 'archer'$$,
                   'service_role can level up a card');
select tests.lives($$insert into public.player_cards (user_id, card_id, copies) values ('00000000-0000-0000-0000-00000000000a', 'musketeer', 1)$$,
                   'service_role can add a card');
select tests.lives($$update public.decks set cards = array['archer','knight','musketeer','healer'] where user_id = '00000000-0000-0000-0000-00000000000a'$$,
                   'service_role can set a deck');
select tests.lives($$insert into public.matches (player_a, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-00000000000a', 'hard', 'steingolem-stefan', 9007199254740991, 1, '{}')$$,
                   'service_role can create a match');
select tests.lives($$update public.packs set opened = true, contents = '{"kind": "gold", "amount": 120}' where id = '20000000-0000-0000-0000-00000000000a'$$,
                   'service_role can open a pack');
select tests.lives($$insert into public.friendships (user_id, friend_id) values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a')$$,
                   'service_role can create a friend request');
select tests.lives($$delete from public.friendships where user_id = '00000000-0000-0000-0000-00000000000c'$$,
                   'service_role can delete a friend request');

do $$
begin
  perform tests.eq((select count(*) from public.profiles), 3::bigint,
                   'service_role reads all profiles (bypasses RLS)');
  perform tests.eq((select gold from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 600,
                   'gold update by service_role took effect');
end;
$$;

reset role;
