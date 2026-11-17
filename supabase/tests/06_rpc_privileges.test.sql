-- =============================================================================
-- Write functions (migration section 7): catalog and privileges. Only
-- service_role may execute them; anon and authenticated get 42501 even for
-- their own data, and still cannot write any table. Player F = ...61.
-- =============================================================================

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000061');
update public.profiles set gold = 1000, jokers = 5 where id = '00000000-0000-0000-0000-000000000061';
insert into public.packs (id, user_id) values
  ('30000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000061');

-- ---- Catalog ----------------------------------------------------------------
do $$
declare
  fn record;
begin
  perform tests.eq(
    (select array_agg(p.oid::regprocedure::text order by p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'rr\_%'),
    array['rr_create_match(uuid,text,text,bigint,integer)',
          'rr_finish_match(uuid,uuid,text,jsonb,integer,integer,integer,boolean)',
          'rr_level_up_card(uuid,text,integer,integer,integer)',
          'rr_open_pack(uuid,uuid,jsonb)',
          'rr_set_deck(uuid,text[])',
          'rr_set_username(uuid,text,integer)',
          'rr_spend_jokers(uuid,text,integer,integer)',
          'rr_unlock_upgrade(uuid,text,integer,integer,integer)'],
    'schema public has exactly the eight write functions with these signatures');

  for fn in
    select p.oid, p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig, p.proacl, l.lanname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
     where n.nspname = 'public' and p.proname like 'rr\_%'
  loop
    perform tests.ok(not fn.prosecdef, format('%s is security invoker', fn.sig));
    perform tests.ok(fn.proconfig @> array['search_path=""'], format('%s has an empty search_path', fn.sig));
    perform tests.eq(fn.lanname::text, 'plpgsql', format('%s is plpgsql', fn.sig));
    -- NULL proacl would mean the default: EXECUTE for PUBLIC.
    perform tests.ok(fn.proacl is not null, format('%s has explicit privileges', fn.sig));
    perform tests.eq(
      (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
         from aclexplode(fn.proacl) as a
        where a.privilege_type = 'EXECUTE'),
      array['postgres', 'service_role'],
      format('only the owner and service_role may execute %s (not PUBLIC)', fn.sig));
    perform tests.ok(not has_function_privilege('anon', fn.oid, 'EXECUTE'),
                     format('anon cannot execute %s', fn.sig));
    perform tests.ok(not has_function_privilege('authenticated', fn.oid, 'EXECUTE'),
                     format('authenticated cannot execute %s', fn.sig));
    perform tests.ok(has_function_privilege('service_role', fn.oid, 'EXECUTE'),
                     format('service_role can execute %s', fn.sig));
  end loop;
end;
$$;

-- ---- authenticated: not even for the own account ----------------------------
select tests.authenticate('00000000-0000-0000-0000-000000000061');
set role authenticated;

select tests.throws($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000061', 'Fritz_61', 1)$$,
                    '42501', 'authenticated cannot call rr_set_username');
select tests.throws($$select public.rr_set_deck('00000000-0000-0000-0000-000000000061', array['bat','tnt','knight','archer'])$$,
                    '42501', 'authenticated cannot call rr_set_deck');
select tests.throws($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000061', 'archer', 1, 0, 0)$$,
                    '42501', 'authenticated cannot call rr_level_up_card');
select tests.throws($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000061', 'archer', 0, 1, 0)$$,
                    '42501', 'authenticated cannot call rr_unlock_upgrade');
select tests.throws($$select * from public.rr_spend_jokers('00000000-0000-0000-0000-000000000061', 'archer', 5, 5)$$,
                    '42501', 'authenticated cannot call rr_spend_jokers');
select tests.throws($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000061', 'easy', 'goblin-gustav', 1, 1)$$,
                    '42501', 'authenticated cannot call rr_create_match');
select tests.throws($$select * from public.rr_finish_match('00000000-0000-0000-0000-000000000061', '10000000-0000-0000-0000-0000000000ab', 'a_won', '[]', 100, 5, 1000, true)$$,
                    '42501', 'authenticated cannot call rr_finish_match');
select tests.throws($$select * from public.rr_open_pack('00000000-0000-0000-0000-000000000061', '30000000-0000-0000-0000-000000000061', '{"kind": "gold", "gold": 9999}')$$,
                    '42501', 'authenticated cannot call rr_open_pack');

-- ... and still cannot write the tables directly.
select tests.throws($$update public.profiles set gold = 99999 where id = '00000000-0000-0000-0000-000000000061'$$,
                    '42501', 'authenticated still cannot update its profile');
select tests.throws($$update public.packs set opened = true, contents = '{}' where user_id = '00000000-0000-0000-0000-000000000061'$$,
                    '42501', 'authenticated still cannot open its pack directly');
select tests.throws($$insert into public.matches (player_a, bot_level, bot_profile, seed, engine_version, setup) values ('00000000-0000-0000-0000-000000000061', 'easy', 'goblin-gustav', 1, 1, '{}')$$,
                    '42501', 'authenticated still cannot create a match directly');

reset role;

-- ---- anon -------------------------------------------------------------------
select tests.clear_auth();
set role anon;

select tests.throws($$select * from public.rr_set_username('00000000-0000-0000-0000-000000000061', 'Fritz_61', 1)$$,
                    '42501', 'anon cannot call rr_set_username');
select tests.throws($$select public.rr_set_deck('00000000-0000-0000-0000-000000000061', array['bat','tnt','knight','archer'])$$,
                    '42501', 'anon cannot call rr_set_deck');
select tests.throws($$select * from public.rr_level_up_card('00000000-0000-0000-0000-000000000061', 'archer', 1, 0, 0)$$,
                    '42501', 'anon cannot call rr_level_up_card');
select tests.throws($$select * from public.rr_unlock_upgrade('00000000-0000-0000-0000-000000000061', 'archer', 0, 1, 0)$$,
                    '42501', 'anon cannot call rr_unlock_upgrade');
select tests.throws($$select * from public.rr_spend_jokers('00000000-0000-0000-0000-000000000061', 'archer', 5, 5)$$,
                    '42501', 'anon cannot call rr_spend_jokers');
select tests.throws($$select * from public.rr_create_match('00000000-0000-0000-0000-000000000061', 'easy', 'goblin-gustav', 1, 1)$$,
                    '42501', 'anon cannot call rr_create_match');
select tests.throws($$select * from public.rr_finish_match('00000000-0000-0000-0000-000000000061', '10000000-0000-0000-0000-0000000000ab', 'a_won', '[]', 100, 5, 1000, true)$$,
                    '42501', 'anon cannot call rr_finish_match');
select tests.throws($$select * from public.rr_open_pack('00000000-0000-0000-0000-000000000061', '30000000-0000-0000-0000-000000000061', '{"kind": "gold", "gold": 9999}')$$,
                    '42501', 'anon cannot call rr_open_pack');
select tests.throws($$insert into public.packs (user_id) values ('00000000-0000-0000-0000-000000000061')$$,
                    '42501', 'anon still cannot create a pack');

reset role;

-- Nothing changed for F.
do $$
declare
  f constant uuid := '00000000-0000-0000-0000-000000000061';
begin
  perform tests.ok(
    (select username is null and gold = 1000 and jokers = 5 and games_played = 0
       from public.profiles where id = f),
    'profile of F is unchanged after all client attempts');
  perform tests.eq((select count(*) from public.packs where user_id = f and not opened), 1::bigint,
                   'F still has exactly one unopened pack');
  perform tests.eq((select count(*) from public.matches where player_a = f), 0::bigint,
                   'F has no match');
  perform tests.eq((select cards from public.decks where user_id = f),
                   array['archer', 'knight', 'skeleton', 'healer'], 'deck of F is unchanged');
  perform tests.eq((select count(*) from public.player_cards where user_id = f and level = 1 and copies = 1),
                   6::bigint, 'cards of F are unchanged');
end;
$$;

-- Counter-check: service_role may call them.
set role service_role;
select tests.lives($$select public.rr_set_deck('00000000-0000-0000-0000-000000000061', array['bat','tnt','knight','archer'])$$,
                   'service_role can call rr_set_deck');
reset role;
