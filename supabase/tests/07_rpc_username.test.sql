-- =============================================================================
-- rr_set_username (SPEC 9): first pick with welcome pack, one free rename,
-- error codes. Called as service_role like the Edge Function does.
-- Players (no username yet): U = ...71, V = ...72, W = ...73.
-- W already has a welcome pack although it has no name (repair case).
-- =============================================================================

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000071'),
  ('00000000-0000-0000-0000-000000000072'),
  ('00000000-0000-0000-0000-000000000073');
insert into public.packs (id, user_id, kind) values
  ('30000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000073', 'welcome');

set role service_role;

-- ---- Bad input ----------------------------------------------------------------
select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-0000000000ff', 'Nobody', 1)$$,
                       'not_found', 'unknown player: rr:not_found');
select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000071', null, 1)$$,
                       'username_invalid', 'NULL username: rr:username_invalid');
select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000071', 'Uli_71', -1)$$,
                       'bad_request', 'negative p_free_renames: rr:bad_request');
select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000071', 'Uli_71', null)$$,
                       'bad_request', 'NULL p_free_renames: rr:bad_request');
select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000071', 'ab', 1)$$,
                       'username_invalid', 'too short: rr:username_invalid');
select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000071', 'bad name', 1)$$,
                       'username_invalid', 'space: rr:username_invalid');
select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000071', 'Alice_1', 1)$$,
                       'username_taken', 'name of fixture player A: rr:username_taken');

do $$
declare
  u constant uuid := '00000000-0000-0000-0000-000000000071';
begin
  perform tests.ok((select username is null from public.profiles where id = u),
                   'failed first picks leave the username NULL');
  perform tests.eq((select count(*) from public.packs where user_id = u), 0::bigint,
                   'failed first picks create no welcome pack');
end;
$$;

-- ---- First pick ------------------------------------------------------------------
do $$
declare
  u constant uuid := '00000000-0000-0000-0000-000000000071';
  r record;
  k public.packs;
begin
  select * into r from public.rr_set_username(u, 'Uli_71', 1);
  perform tests.eq(r.username, 'Uli_71', 'first pick returns the name');
  perform tests.ok(r.welcome_pack_id is not null, 'first pick returns a welcome pack id');
  perform tests.ok((select username::text = 'Uli_71' and username_changes = 0 from public.profiles where id = u),
                   'first pick stores the name and does not count as a rename');

  select * into k from public.packs where id = r.welcome_pack_id;
  perform tests.ok(k.user_id = u and k.kind = 'welcome' and not k.opened and k.match_id is null
                   and k.contents is null,
                   'the welcome pack belongs to U, is unopened and has no match');
end;
$$;

-- Same name, other case, for another player.
select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000072', 'uli_71', 1)$$,
                       'username_taken', 'name of U in lower case: rr:username_taken');
do $$
begin
  perform tests.ok((select username is null from public.profiles where id = '00000000-0000-0000-0000-000000000072'),
                   'V still has no name after the taken name');
  perform tests.eq((select count(*) from public.packs where user_id = '00000000-0000-0000-0000-000000000072'),
                   0::bigint, 'V got no welcome pack for the taken name');
end;
$$;
select tests.lives($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000072', 'Vera_72', 0)$$,
                   'V picks a free name (first pick also works with p_free_renames = 0)');

-- ---- Renames -----------------------------------------------------------------------
do $$
declare
  u constant uuid := '00000000-0000-0000-0000-000000000071';
  r record;
begin
  select * into r from public.rr_set_username(u, 'Uli_71', 1);
  perform tests.ok(r.username = 'Uli_71' and r.welcome_pack_id is null,
                   'the exact current name again succeeds without a pack');
  perform tests.eq((select username_changes from public.profiles where id = u), 0,
                   'the exact current name again is not counted');

  select * into r from public.rr_set_username(u, 'ULI_71', 1);
  perform tests.ok(r.username = 'ULI_71' and r.welcome_pack_id is null,
                   'a change of case is a rename and returns no pack');
  perform tests.ok((select username::text = 'ULI_71' and username_changes = 1 from public.profiles where id = u),
                   'the change of case is stored and counted');
end;
$$;

select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000071', 'Uli_neu', 1)$$,
                       'username_locked', 'second rename with one free rename: rr:username_locked');
select tests.lives($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000071', 'ULI_71', 1)$$,
                   'the exact current name still succeeds when locked');
select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000072', 'Vera_new', 0)$$,
                       'username_locked', 'rename with p_free_renames = 0: rr:username_locked');

-- With a second free rename (as if the Edge Function allowed more).
select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000071', 'VERA_72', 2)$$,
                       'username_taken', 'rename to the name of V in other case: rr:username_taken');
select tests.throws_rr($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000071', 'bad-name', 2)$$,
                       'username_invalid', 'rename to an invalid name: rr:username_invalid');

do $$
declare
  u constant uuid := '00000000-0000-0000-0000-000000000071';
  r record;
begin
  perform tests.ok((select username::text = 'ULI_71' and username_changes = 1 from public.profiles where id = u),
                   'failed renames change neither name nor counter');
  select * into r from public.rr_set_username(u, 'Uli_2nd', 2);
  perform tests.ok((select username::text = 'Uli_2nd' and username_changes = 2 from public.profiles where id = u),
                   'a further allowed rename is stored and counted');
  perform tests.eq((select count(*) from public.packs where user_id = u and kind = 'welcome'), 1::bigint,
                   'renames never add a welcome pack');
  perform tests.ok(
    (select username = 'Vera_72' and username_changes = 0 from public.profiles
      where id = '00000000-0000-0000-0000-000000000072'),
    'renames of U did not touch V');
end;
$$;

-- ---- Welcome pack only once ----------------------------------------------------------
do $$
declare
  w constant uuid := '00000000-0000-0000-0000-000000000073';
  r record;
begin
  select * into r from public.rr_set_username(w, 'Willi_73', 1);
  perform tests.ok(r.username = 'Willi_73' and r.welcome_pack_id is null,
                   'a player who already has a welcome pack gets the name but no second pack');
  perform tests.eq((select count(*) from public.packs where user_id = w), 1::bigint,
                   'W still has exactly one pack');
end;
$$;

reset role;
