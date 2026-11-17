-- =============================================================================
-- Reading as a signed-in player: own rows only, public fields of others via
-- public_profiles, matches and friendships for both participants.
-- Uses the players A, B, C from fixtures.sql.
-- =============================================================================

-- ---- Player A ---------------------------------------------------------------
select tests.authenticate('00000000-0000-0000-0000-00000000000a');
set role authenticated;

do $$
declare
  a constant uuid := '00000000-0000-0000-0000-00000000000a';
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
begin
  perform tests.eq(auth.uid(), a, 'auth.uid() returns the signed-in player');

  -- profiles: own row incl. private fields, nothing else.
  perform tests.eq((select count(*) from public.profiles), 1::bigint,
                   'A sees exactly one profile row');
  perform tests.eq((select gold from public.profiles where id = a), 500,
                   'A reads own gold');
  perform tests.eq((select jokers from public.profiles where id = a), 3,
                   'A reads own jokers');
  perform tests.eq((select count(*) from public.profiles where id = b), 0::bigint,
                   'A cannot read the profile row of B');

  -- player_cards / decks / packs: own rows only.
  perform tests.eq((select count(*) from public.player_cards), 6::bigint,
                   'A sees only own six player_cards');
  perform tests.eq((select count(*) from public.player_cards where user_id <> a), 0::bigint,
                   'A sees no player_cards of others');
  perform tests.eq((select count(*) from public.decks), 1::bigint,
                   'A sees only own deck');
  perform tests.eq((select count(*) from public.decks where user_id = b), 0::bigint,
                   'A cannot read the deck of B');
  perform tests.eq((select count(*) from public.packs), 1::bigint,
                   'A sees only own pack');
  perform tests.eq((select count(*) from public.packs where user_id = b), 0::bigint,
                   'A cannot read the packs of B');

  -- public_profiles: public fields of everybody.
  perform tests.eq((select count(*) from public.public_profiles), 3::bigint,
                   'A sees all three players in public_profiles');
  perform tests.eq((select username::text from public.public_profiles where id = b), 'Bob_2',
                   'A sees the username of B');
  perform tests.eq((select elo from public.public_profiles where id = b), 1234,
                   'A sees the Elo of B');
  perform tests.eq((select highest_arena from public.public_profiles where id = b), 3,
                   'A sees the highest arena of B');
  perform tests.eq((select id from public.public_profiles where username = 'BOB_2'), b,
                   'username lookup in public_profiles ignores case');
end;
$$;

select tests.throws('select gold from public.public_profiles', '42703',
                    'public_profiles has no gold column');
select tests.throws('select jokers from public.public_profiles', '42703',
                    'public_profiles has no jokers column');

do $$
declare
  a constant uuid := '00000000-0000-0000-0000-00000000000a';
begin
  -- matches: A vs B and A vs bot, not B vs C.
  perform tests.eq(
    (select array_agg(id::text order by id::text) from public.matches),
    array['10000000-0000-0000-0000-0000000000ab', '10000000-0000-0000-0000-00000000a0b0'],
    'A sees the match against B and the bot match, not B vs C');

  -- friendships: A asked B.
  perform tests.eq((select count(*) from public.friendships), 1::bigint,
                   'A sees the friendship A -> B');
end;
$$;

reset role;

-- ---- Player B ---------------------------------------------------------------
select tests.authenticate('00000000-0000-0000-0000-00000000000b');
set role authenticated;

do $$
begin
  perform tests.eq((select gold from public.profiles), 700,
                   'B reads own gold only');
  perform tests.eq(
    (select array_agg(id::text order by id) from public.matches),
    array['10000000-0000-0000-0000-0000000000ab', '10000000-0000-0000-0000-0000000000bc'],
    'B sees both of his matches (as player_b and as player_a)');
  perform tests.eq(
    (select friend_id from public.friendships where user_id = '00000000-0000-0000-0000-00000000000a'),
    '00000000-0000-0000-0000-00000000000b'::uuid,
    'B (receiving side) sees the friendship A -> B');
  perform tests.eq((select count(*) from public.player_cards where user_id = '00000000-0000-0000-0000-00000000000a'),
                   0::bigint, 'B cannot read the cards of A');
end;
$$;

reset role;

-- ---- Player C (outsider) ----------------------------------------------------
select tests.authenticate('00000000-0000-0000-0000-00000000000c');
set role authenticated;

do $$
begin
  perform tests.eq(
    (select count(*) from public.matches where id = '10000000-0000-0000-0000-0000000000ab'),
    0::bigint, 'C cannot read the match A vs B');
  perform tests.eq(
    (select count(*) from public.matches where id = '10000000-0000-0000-0000-00000000a0b0'),
    0::bigint, 'C cannot read the bot match of A');
  perform tests.eq((select count(*) from public.matches), 1::bigint,
                   'C sees only the match B vs C');
  perform tests.eq((select count(*) from public.friendships), 0::bigint,
                   'C cannot read the friendship A -> B');
end;
$$;

reset role;

-- ---- Signed-in role without a user id ---------------------------------------
select tests.clear_auth();
set role authenticated;

do $$
begin
  perform tests.eq((select count(*) from public.profiles), 0::bigint,
                   'authenticated without sub sees no profile');
  perform tests.eq((select count(*) from public.player_cards), 0::bigint,
                   'authenticated without sub sees no cards');
  perform tests.eq((select count(*) from public.matches), 0::bigint,
                   'authenticated without sub sees no matches (player_b NULL does not match)');
end;
$$;

reset role;

-- ---- anon (not signed in) ---------------------------------------------------
set role anon;

select tests.throws('select * from public.profiles', '42501', 'anon cannot read profiles');
select tests.throws('select * from public.public_profiles', '42501', 'anon cannot read public_profiles');
select tests.throws('select * from public.player_cards', '42501', 'anon cannot read player_cards');
select tests.throws('select * from public.decks', '42501', 'anon cannot read decks');
select tests.throws('select * from public.matches', '42501', 'anon cannot read matches');
select tests.throws('select * from public.packs', '42501', 'anon cannot read packs');
select tests.throws('select * from public.friendships', '42501', 'anon cannot read friendships');

reset role;
