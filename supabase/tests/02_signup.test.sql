-- =============================================================================
-- New accounts: the trigger on auth.users creates profile, starting
-- collection and starting deck (SPEC 7.1, 9). Deleting the account removes
-- all of it again.
-- =============================================================================

-- A brand-new guest account (Supabase anonymous sign-in), created the way
-- Supabase Auth does it: as supabase_auth_admin, which has no rights on
-- schema public, with search_path = auth. The security definer trigger must
-- still be able to write the profile.
set role supabase_auth_admin;
set search_path = auth;
select tests.ok(not has_table_privilege('public.profiles', 'INSERT'),
                'supabase_auth_admin itself has no INSERT on profiles');
insert into auth.users (id, is_anonymous)
values ('00000000-0000-0000-0000-0000000000d1', true);
reset search_path;
reset role;

do $$
declare
  d constant uuid := '00000000-0000-0000-0000-0000000000d1';
  p public.profiles;
begin
  select * into p from public.profiles where id = d;
  perform tests.ok(p.id is not null, 'new user gets a profile row');
  perform tests.ok(p.username is null, 'username is NULL until chosen');
  perform tests.eq(p.username_changes, 0, 'username_changes starts at 0');
  perform tests.eq(p.elo, 1000, 'Elo starts at 1000 (SPEC 7.5)');
  perform tests.eq(p.highest_arena, 1, 'highest_arena starts at 1');
  perform tests.eq(p.gold, 0, 'gold starts at 0');
  perform tests.eq(p.jokers, 0, 'jokers start at 0');
  perform tests.eq(p.games_played, 0, 'games_played starts at 0');
  perform tests.ok(p.created_at is not null, 'created_at is set');

  perform tests.eq(
    (select array_agg(card_id order by card_id) from public.player_cards where user_id = d),
    array['archer', 'bat', 'healer', 'knight', 'skeleton', 'tnt'],
    'new user gets the six starting cards');
  perform tests.eq(
    (select count(*) from public.player_cards
      where user_id = d and level = 1 and copies = 1 and unlocked_upgrades = 0),
    6::bigint,
    'starting cards are level 1 with one copy and no upgrades');

  perform tests.eq(
    (select cards from public.decks where user_id = d),
    array['archer', 'knight', 'skeleton', 'healer'],
    'new user gets the starting deck archer, knight, skeleton, healer');
end;
$$;

-- Deleting the account cascades to everything the player owns.
insert into public.packs (user_id) values ('00000000-0000-0000-0000-0000000000d1');
insert into public.matches (player_a, bot_level, seed, engine_version)
values ('00000000-0000-0000-0000-0000000000d1', 'medium', 7, 1);
delete from auth.users where id = '00000000-0000-0000-0000-0000000000d1';

do $$
declare
  d constant uuid := '00000000-0000-0000-0000-0000000000d1';
begin
  perform tests.eq((select count(*) from public.profiles where id = d), 0::bigint,
                   'deleting the auth user deletes the profile');
  perform tests.eq((select count(*) from public.player_cards where user_id = d), 0::bigint,
                   'deleting the auth user deletes the cards');
  perform tests.eq((select count(*) from public.decks where user_id = d), 0::bigint,
                   'deleting the auth user deletes the deck');
  perform tests.eq((select count(*) from public.packs where user_id = d), 0::bigint,
                   'deleting the auth user deletes the packs');
  perform tests.eq((select count(*) from public.matches where player_a = d), 0::bigint,
                   'deleting the auth user deletes the matches');
end;
$$;
