-- =============================================================================
-- rr_create_match and rr_finish_match (SPEC 7.5, 8.1, 14.2). Called as
-- service_role like the Edge Function does.
-- Players: M = ...91 "Mia_91" (gold 50, archer level 3 with upgrades 0b101),
--          N = ...92 (no username yet),
--          O = ...93 "Otto_93" (outsider for ownership checks).
-- =============================================================================

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000091'),
  ('00000000-0000-0000-0000-000000000092'),
  ('00000000-0000-0000-0000-000000000093');
update public.profiles set username = 'Mia_91', gold = 50 where id = '00000000-0000-0000-0000-000000000091';
update public.profiles set username = 'Otto_93' where id = '00000000-0000-0000-0000-000000000093';
update public.player_cards set level = 3, unlocked_upgrades = 5
  where user_id = '00000000-0000-0000-0000-000000000091' and card_id = 'archer';
-- O owns a pending match (fixed id) for the ownership checks.
insert into public.matches (id, player_a, bot_level, bot_profile, seed, engine_version, setup) values
  ('10000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-000000000093',
   'easy', 'goblin-gustav', 93, 1, '{}');

set role service_role;

-- =============================================================================
-- rr_create_match
-- =============================================================================
select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000092', 'easy', 'goblin-gustav', 1, 1)$$,
                       'username_missing', 'player without username: rr:username_missing');
select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-0000000000ff', 'easy', 'goblin-gustav', 1, 1)$$,
                       'not_found', 'unknown player: rr:not_found');

do $$
declare
  m constant uuid := '00000000-0000-0000-0000-000000000091';
  r record;
  row public.matches;
begin
  select * into r from public.rr_create_match(m, 'master', 'drachen-dora', 9007199254740991, 3);
  perform tests.ok(r.id is not null, 'rr_create_match returns the match id');
  perform tests.eq(r.seed, 9007199254740991::bigint, 'rr_create_match returns the seed (2^53 - 1)');
  perform tests.eq(r.engine_version, 3, 'rr_create_match returns the engine version');
  perform tests.eq(r.bot_level, 'master', 'rr_create_match returns the bot level');
  perform tests.eq(r.bot_profile, 'drachen-dora', 'rr_create_match returns the bot profile');
  perform tests.eq(
    r.setup,
    '{"deck": ["archer", "knight", "skeleton", "healer"],
      "levels": {"archer": 3, "knight": 1, "skeleton": 1, "healer": 1},
      "upgrades": {"archer": 5, "knight": 0, "skeleton": 0, "healer": 0}}'::jsonb,
    'setup is the snapshot of deck, levels and upgrade masks of the four deck cards');
  perform tests.eq(jsonb_typeof(r.setup -> 'deck'), 'array', 'setup.deck is a JSON array (deck order kept)');
  -- PostgREST serialises rows with to_json: bigint becomes a JSON number.
  perform tests.eq(json_typeof(to_json(r) -> 'seed'), 'number', 'the seed is serialised as a JSON number');
  perform tests.eq((to_json(r) ->> 'seed'), '9007199254740991', 'the JSON seed keeps all digits');

  select * into row from public.matches where id = r.id;
  perform tests.ok(row.player_a = m and row.player_b is null and row.result = 'pending'
                   and row.finished_at is null and row.picks = '[]'::jsonb
                   and row.elo_delta_a is null and row.setup = r.setup,
                   'the match is stored pending, without picks and Elo change');
end;
$$;

-- A later level-up does not change the snapshot of the running match.
reset role;
update public.player_cards set level = 4
  where user_id = '00000000-0000-0000-0000-000000000091' and card_id = 'archer';
set role service_role;
select tests.eq(
  (select setup -> 'levels' ->> 'archer' from public.matches
    where player_a = '00000000-0000-0000-0000-000000000091' and result = 'pending'),
  '3', 'the setup snapshot does not follow later level-ups');

select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000091', 'easy', 'goblin-gustav', 1, 1)$$,
                       'match_pending', 'second match while one is pending: rr:match_pending');
select tests.eq(
  (select count(*) from public.matches where player_a = '00000000-0000-0000-0000-000000000091'),
  1::bigint, 'still only one match of M after rr:match_pending');

-- Bad parameters (on N after giving it a name, so nothing else fails first).
reset role;
update public.profiles set username = 'Nina_92' where id = '00000000-0000-0000-0000-000000000092';
set role service_role;
select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000092', 'insane', 'goblin-gustav', 1, 1)$$,
                       'bad_request', 'unknown bot level: rr:bad_request');
select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000092', null, 'goblin-gustav', 1, 1)$$,
                       'bad_request', 'no bot level: rr:bad_request');
select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000092', 'easy', null, 1, 1)$$,
                       'bad_request', 'no bot profile: rr:bad_request');
select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000092', 'easy', 'Goblin Gustav', 1, 1)$$,
                       'bad_request', 'invalid bot profile id: rr:bad_request');
select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000092', 'easy', 'goblin-gustav', -1, 1)$$,
                       'bad_request', 'negative seed: rr:bad_request');
select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000092', 'easy', 'goblin-gustav', 9007199254740992, 1)$$,
                       'bad_request', 'seed above 2^53-1: rr:bad_request');
select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000092', 'easy', 'goblin-gustav', null, 1)$$,
                       'bad_request', 'no seed: rr:bad_request');
select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000092', 'easy', 'goblin-gustav', 1, 0)$$,
                       'bad_request', 'engine version 0: rr:bad_request');

-- A deck card that is not in the collection (cannot happen via the
-- functions, but the snapshot must never be incomplete).
reset role;
delete from public.player_cards where user_id = '00000000-0000-0000-0000-000000000092' and card_id = 'healer';
set role service_role;
select tests.throws_rr($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000092', 'easy', 'goblin-gustav', 1, 1)$$,
                       'deck_invalid', 'deck card missing from the collection: rr:deck_invalid');
select tests.eq((select count(*) from public.matches where player_a = '00000000-0000-0000-0000-000000000092'),
                0::bigint, 'failed rr_create_match calls create no match');

-- =============================================================================
-- rr_finish_match
-- =============================================================================
-- Bad parameters, all on the pending match of M (which stays pending).
do $$
declare
  call constant text :=
    $f$select * from public.rr_finish_match('00000000-0000-0000-0000-000000000091',
         (select id from public.matches where player_a = '00000000-0000-0000-0000-000000000091' and result = 'pending'),
         %s)$f$;
begin
  perform tests.throws_rr(format(call, $a$'pending', '[]', 0, 1, 0, false$a$), 'bad_request', 'result pending: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'won', '[]', 0, 1, 0, false$a$), 'bad_request', 'unknown result: rr:bad_request');
  perform tests.throws_rr(format(call, $a$null, '[]', 0, 1, 0, false$a$), 'bad_request', 'NULL result: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'a_won', '{}', 0, 1, 0, false$a$), 'bad_request', 'picks as object: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'a_won', null, 0, 1, 0, false$a$), 'bad_request', 'NULL picks: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'a_won', '[]', null, 1, 0, false$a$), 'bad_request', 'NULL Elo change: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'b_won', '[]', -10, 1, 10, true$a$), 'bad_request', 'pack after a loss: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'draw', '[]', 0, 1, 0, true$a$), 'bad_request', 'pack after a draw: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'a_won', '[]', 10, 0, 0, true$a$), 'bad_request', 'arena 0: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'a_won', '[]', 10, 6, 0, true$a$), 'bad_request', 'arena 6: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'b_won', '[]', -10, 1, -10, false$a$), 'bad_request', 'negative gold: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'abandoned', '[]', -5, 0, 0, false$a$), 'bad_request', 'abandoned with Elo change: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'abandoned', '[]', 0, 1, 0, false$a$), 'bad_request', 'abandoned with arena: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'abandoned', '[]', 0, 0, 10, false$a$), 'bad_request', 'abandoned with gold: rr:bad_request');
  perform tests.throws_rr(format(call, $a$'abandoned', '[]', 0, 0, 0, true$a$), 'bad_request', 'abandoned with pack: rr:bad_request');
end;
$$;

select tests.throws_rr($$select * from public.rr_finish_match('00000000-0000-0000-0000-000000000091', '10000000-0000-0000-0000-0000000000ff', 'a_won', '[]', 10, 1, 0, true)$$,
                       'match_not_found', 'unknown match: rr:match_not_found');
select tests.throws_rr($$select * from public.rr_finish_match('00000000-0000-0000-0000-000000000091', '10000000-0000-0000-0000-000000000093', 'a_won', '[]', 10, 1, 0, true)$$,
                       'match_not_found', 'pending match of O reported by M: rr:match_not_found');
select tests.throws_rr($$select * from public.rr_finish_match('00000000-0000-0000-0000-000000000091', '10000000-0000-0000-0000-0000000000ab', 'a_won', '[]', 10, 1, 0, true)$$,
                       'match_not_found', 'finished match of fixture player A reported by M: rr:match_not_found');
select tests.throws_rr($$select * from public.rr_finish_match('00000000-0000-0000-0000-0000000000ff', '10000000-0000-0000-0000-000000000093', 'a_won', '[]', 10, 1, 0, true)$$,
                       'not_found', 'unknown player: rr:not_found');
-- O reports the match of M.
select tests.throws_rr($$select * from public.rr_finish_match('00000000-0000-0000-0000-000000000093', (select id from public.matches where player_a = '00000000-0000-0000-0000-000000000091' and result = 'pending'), 'a_won', '[]', 10, 1, 0, true)$$,
                       'match_not_found', 'pending match of M reported by O: rr:match_not_found');

do $$
begin
  perform tests.ok(
    (select elo = 1000 and games_played = 0 and highest_arena = 1 and gold = 50
       from public.profiles where id = '00000000-0000-0000-0000-000000000091'),
    'failed reports leave the profile of M unchanged');
  perform tests.eq(
    (select count(*) from public.matches
      where player_a = '00000000-0000-0000-0000-000000000091' and result = 'pending' and finished_at is null),
    1::bigint, 'failed reports leave the match of M pending');
  perform tests.eq((select result from public.matches where id = '10000000-0000-0000-0000-000000000093'),
                   'pending', 'the match of O is still pending');
  perform tests.ok(
    (select elo = 1000 and games_played = 0 from public.profiles where id = '00000000-0000-0000-0000-000000000093'),
    'the profile of O is untouched');
  perform tests.eq((select count(*) from public.packs where user_id in ('00000000-0000-0000-0000-000000000091',
                                                                         '00000000-0000-0000-0000-000000000093')),
                   0::bigint, 'failed reports create no pack');
end;
$$;

-- ---- Win with pack and new arena ---------------------------------------------
do $$
declare
  m constant uuid := '00000000-0000-0000-0000-000000000091';
  match_id uuid;
  r record;
  row public.matches;
  k public.packs;
begin
  select id into match_id from public.matches where player_a = m and result = 'pending';
  select * into r from public.rr_finish_match(m, match_id, 'a_won', '[0, 2, 1, 1]', 120, 2, 0, true);
  perform tests.ok(r.elo = 1120 and r.highest_arena = 2 and r.arena_unlocked and r.gold = 50
                   and r.pack_id is not null,
                   format('win returns Elo 1120, arena 2 (new), gold 50 and a pack (got %s)', r));

  perform tests.ok(
    (select elo = 1120 and games_played = 1 and highest_arena = 2 and gold = 50
       from public.profiles where id = m),
    'win is booked on the profile (Elo, games, arena)');
  select * into row from public.matches where id = match_id;
  perform tests.ok(row.result = 'a_won' and row.picks = '[0, 2, 1, 1]'::jsonb and row.elo_delta_a = 120
                   and row.finished_at is not null,
                   'the match stores result, picks, Elo change and finished_at');
  select * into k from public.packs where id = r.pack_id;
  perform tests.ok(k.user_id = m and k.kind = 'match' and k.match_id = match_id and not k.opened,
                   'the reward pack is an unopened match pack of M for this match');

  -- The same report again (double click / retry).
  perform tests.throws_rr(
    format('select * from public.rr_finish_match(%L, %L, ''a_won'', ''[0, 2, 1, 1]'', 120, 2, 0, true)', m, match_id),
    'match_not_pending', 'the same report twice: rr:match_not_pending');
  perform tests.throws_rr(
    format('select * from public.rr_finish_match(%L, %L, ''abandoned'', ''[]'', 0, 0, 0, false)', m, match_id),
    'match_not_pending', 'abandoning a finished match: rr:match_not_pending');
  perform tests.ok(
    (select elo = 1120 and games_played = 1 and gold = 50 from public.profiles where id = m),
    'the second report books nothing again');
  perform tests.eq((select count(*) from public.packs where user_id = m), 1::bigint,
                   'the second report creates no second pack');
  perform tests.eq((select result from public.matches where id = match_id), 'a_won',
                   'the second report does not change the result');
end;
$$;

-- ---- Loss with consolation gold, Elo floor 0, arena stays --------------------
do $$
declare
  m constant uuid := '00000000-0000-0000-0000-000000000091';
  t record;
  r record;
begin
  select * into t from public.rr_create_match(m, 'easy', 'goblin-gustav', 5, 3);
  perform tests.ok(t.id is not null, 'after the report M can start the next match');

  select * into r from public.rr_finish_match(m, t.id, 'b_won', '[1]', -2000, 1, 10, false);
  perform tests.ok(r.elo = 0 and r.highest_arena = 2 and not r.arena_unlocked and r.gold = 60
                   and r.pack_id is null,
                   format('loss: Elo stops at 0, arena 2 stays, gold +10, no pack (got %s)', r));
  perform tests.eq((select games_played from public.profiles where id = m), 2, 'a loss counts as a game');
  perform tests.eq((select elo_delta_a from public.matches where id = t.id), -2000,
                   'the match stores the Elo change as given');

  select * into t from public.rr_create_match(m, 'medium', 'lady-knochenkralle', 6, 3);
  select * into r from public.rr_finish_match(m, t.id, 'draw', '[]', 7, 2, 0, false);
  perform tests.ok(r.elo = 7 and r.highest_arena = 2 and not r.arena_unlocked and r.gold = 60
                   and r.pack_id is null,
                   format('draw: Elo 0 + 7, nothing else (got %s)', r));
  perform tests.eq((select games_played from public.profiles where id = m), 3, 'a draw counts as a game');
end;
$$;

-- ---- Abandoned: closes the match, books nothing --------------------------------
do $$
declare
  m constant uuid := '00000000-0000-0000-0000-000000000091';
  t record;
  r record;
begin
  select * into t from public.rr_create_match(m, 'hard', 'steingolem-stefan', 7, 3);
  select * into r from public.rr_finish_match(m, t.id, 'abandoned', '[2, 0]', 0, 0, 0, false);
  perform tests.ok(r.elo = 7 and r.highest_arena = 2 and not r.arena_unlocked and r.gold = 60
                   and r.pack_id is null,
                   format('abandoned returns the unchanged profile values (got %s)', r));
  perform tests.ok(
    (select elo = 7 and games_played = 3 and highest_arena = 2 and gold = 60 from public.profiles where id = m),
    'abandoned does not touch the profile (no game counted)');
  perform tests.ok(
    (select result = 'abandoned' and picks = '[2, 0]'::jsonb and elo_delta_a = 0 and finished_at is not null
       from public.matches where id = t.id),
    'abandoned closes the match');
  perform tests.eq((select count(*) from public.packs where user_id = m), 1::bigint,
                   'abandoned creates no pack');
  perform tests.eq((select count(*) from public.matches where player_a = m and result = 'pending'), 0::bigint,
                   'M has no pending match left');
end;
$$;

reset role;
