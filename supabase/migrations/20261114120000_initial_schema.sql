-- =============================================================================
-- Rumble Realms: initial database schema (SPEC 14.1 / 14.2, milestone M4)
-- =============================================================================
--
-- Applied automatically to the production project by the Supabase GitHub
-- integration when this file reaches `main`. Rules for this file:
--   * It must run cleanly on a fresh Supabase project, in one go.
--   * It only creates objects in schema `public` (plus the `citext` extension
--     in schema `extensions` and one trigger on `auth.users`). It never drops
--     or replaces anything it did not create.
--   * No secrets, project references or URLs.
--
-- Security model (SPEC 14.2):
--   * Row Level Security is enabled on every table.
--   * Players (role `authenticated`, which includes anonymous guest accounts)
--     may only SELECT their own rows. Public profile fields of other players
--     are exposed through the view `public_profiles` only.
--   * Clients never write. `anon` and `authenticated` get no INSERT, UPDATE,
--     DELETE or TRUNCATE privilege on anything; all writes go through Edge
--     Functions that use the `service_role` (which bypasses RLS).
--   * Privileges are set explicitly below, because Supabase's default
--     privileges would otherwise grant ALL on new tables to anon/authenticated.
--
-- Card ids are the text ids used by the engine (`packages/engine/src/data`).
-- Card definitions live in code, not in the database (SPEC 14.1).
-- =============================================================================

create extension if not exists citext with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

-- profiles: one row per account, created by the trigger in section 3.
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  -- NULL until the player picks a name during onboarding (guest accounts
  -- start without one). Uniqueness ignores case thanks to citext.
  username         extensions.citext unique,
  -- How often the name was changed after the first pick (SPEC 9: one free
  -- change). The function rr_set_username (section 7) enforces the rule.
  username_changes integer     not null default 0,
  elo              integer     not null default 1000,
  highest_arena    integer     not null default 1,
  gold             integer     not null default 0,
  jokers           integer     not null default 0,
  games_played     integer     not null default 0,
  created_at       timestamptz not null default now(),

  -- SPEC 9: 3-16 characters, only a-z A-Z 0-9 _. The cast to text makes the
  -- match case-sensitive and code-point based, so look-alike characters such
  -- as the Kelvin sign (U+212A) cannot slip through case folding.
  constraint profiles_username_format
    check (username is null or username::text ~ '^[A-Za-z0-9_]{3,16}$'),
  constraint profiles_username_changes_nonneg check (username_changes >= 0),
  constraint profiles_elo_nonneg              check (elo >= 0),
  constraint profiles_highest_arena_range     check (highest_arena between 1 and 5),
  constraint profiles_gold_nonneg             check (gold >= 0),
  constraint profiles_jokers_nonneg           check (jokers >= 0),
  constraint profiles_games_played_nonneg     check (games_played >= 0)
);

comment on table public.profiles is
  'One row per account (id = auth.users.id). Private to its owner; public fields are exposed via public_profiles. Written only by Edge Functions (service_role).';
comment on column public.profiles.username is
  'Display name, 3-16 chars [A-Za-z0-9_], unique ignoring case. NULL until chosen during onboarding.';
comment on column public.profiles.username_changes is
  'Number of renames after the first pick; SPEC 9 allows one free change.';
comment on column public.profiles.highest_arena is
  'Highest arena (1-5) ever reached. Stays unlocked when Elo drops again (SPEC 7.5).';

-- player_cards: the collection. A row means the card is unlocked (SPEC 7.1).
create table public.player_cards (
  user_id           uuid    not null references public.profiles (id) on delete cascade,
  card_id           text    not null,
  level             integer not null default 1,
  copies            integer not null default 0,
  -- Bit mask of unlocked upgrades: bit 0 = upgrade 1, bit 1 = upgrade 2,
  -- bit 2 = upgrade 3 (0b111 = all three).
  unlocked_upgrades integer not null default 0,
  primary key (user_id, card_id),

  -- Format only; whether the id exists is checked in code (Edge Functions),
  -- so new cards need no migration.
  constraint player_cards_card_id_format    check (card_id ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint player_cards_level_range       check (level between 1 and 5),
  constraint player_cards_copies_nonneg     check (copies >= 0),
  constraint player_cards_upgrades_range    check (unlocked_upgrades between 0 and 7)
);

comment on table public.player_cards is
  'Card collection per player. A row means the card is unlocked. Private to its owner.';
comment on column public.player_cards.card_id is
  'Engine card id, e.g. archer, knight. Not validated against the card list here.';
comment on column public.player_cards.copies is
  'Unspent card copies (experience for level-ups, SPEC 7.2).';
comment on column public.player_cards.unlocked_upgrades is
  'Bit mask 0..7: bit 0 = upgrade 1, bit 1 = upgrade 2, bit 2 = upgrade 3 (SPEC 7.3).';

-- decks: exactly one deck of four different cards per player.
create table public.decks (
  user_id uuid   primary key references public.profiles (id) on delete cascade,
  cards   text[] not null,

  -- Exactly four slots, indexed 1..4, one dimension.
  constraint decks_four_cards check (
    array_ndims(cards) = 1 and array_lower(cards, 1) = 1 and cardinality(cards) = 4
  ),
  -- No NULL slots.
  constraint decks_no_null check (array_position(cards, null) is null),
  -- Four different cards (pairwise; CHECK constraints cannot use subqueries).
  constraint decks_distinct_cards check (
        cards[1] <> cards[2] and cards[1] <> cards[3] and cards[1] <> cards[4]
    and cards[2] <> cards[3] and cards[2] <> cards[4]
    and cards[3] <> cards[4]
  ),
  -- Every slot uses the card id format of player_cards.
  constraint decks_card_id_format check (
    array_to_string(cards, ',') ~ '^[a-z][a-z0-9_]{0,31}(,[a-z][a-z0-9_]{0,31}){3}$'
  )
);

comment on table public.decks is
  'The active deck: four different card ids. Ownership of the cards is checked by the Edge Function set_deck. Private to its owner.';

-- matches: one row per match, created by create_match, completed by report_match.
create table public.matches (
  id             uuid        primary key default gen_random_uuid(),
  player_a       uuid        not null references public.profiles (id) on delete cascade,
  -- Human opponent (M5); NULL for bot matches.
  player_b       uuid        references public.profiles (id) on delete cascade,
  -- Bot strength (SPEC 8.1); NULL for matches between two humans.
  bot_level      text,
  -- Id of the bot profile (engine BOT_PROFILES: deck, levels, upgrades of the
  -- bot); set exactly when bot_level is set.
  bot_profile    text,
  -- Match seed, 0 .. 2^53 - 1 (D-029).
  seed           bigint      not null,
  -- ENGINE_VERSION used for the simulation (D-006).
  engine_version integer     not null,
  -- Snapshot of player_a when the match was created (engine PlayerConfig):
  -- { "deck": [4 card ids], "levels": {card: level}, "upgrades": {card: mask} }.
  -- Later level-ups do not change a running match.
  setup          jsonb       not null,
  -- Draft picks in order (SPEC 14.3), a JSON array.
  picks          jsonb       not null default '[]'::jsonb,
  result         text        not null default 'pending',
  -- Elo change per side; NULL until booked (and always NULL for the bot side).
  elo_delta_a    integer,
  elo_delta_b    integer,
  created_at     timestamptz not null default now(),
  -- When the result was booked; NULL exactly while the match is pending.
  finished_at    timestamptz,

  -- Exactly one opponent: a human or a bot.
  constraint matches_one_opponent check ((player_b is null) <> (bot_level is null)),
  constraint matches_not_self     check (player_b is null or player_b <> player_a),
  -- easy / medium / hard / master = Leicht / Mittel / Schwer / Meister (SPEC 8.1),
  -- same ids as BotLevelId in the engine.
  constraint matches_bot_level_valid
    check (bot_level is null or bot_level in ('easy', 'medium', 'hard', 'master')),
  -- A bot match names its bot profile, a human match has none.
  constraint matches_bot_profile_iff_level check ((bot_profile is null) = (bot_level is null)),
  constraint matches_bot_profile_format
    check (bot_profile is null or bot_profile ~ '^[a-z][a-z0-9-]{0,47}$'),
  -- pending   = created by create_match, not yet reported
  -- a_won     = player_a won the match
  -- b_won     = player_b or the bot won the match
  -- draw      = both lost their last life in the same round
  -- abandoned = never finished (e.g. timeout); no Elo, no pack
  -- A forfeit after a disconnect (SPEC 14.3) is booked as a win for the other side.
  constraint matches_result_valid
    check (result in ('pending', 'a_won', 'b_won', 'draw', 'abandoned')),
  constraint matches_seed_range
    check (seed between 0 and 9007199254740991),
  constraint matches_engine_version_positive check (engine_version >= 1),
  constraint matches_picks_array check (jsonb_typeof(picks) = 'array'),
  constraint matches_setup_object check (jsonb_typeof(setup) = 'object'),
  constraint matches_bot_has_no_delta_b check (player_b is not null or elo_delta_b is null),
  constraint matches_finished_at_iff_done check ((result = 'pending') = (finished_at is null))
);

-- At most one unfinished match per player (as player_a). create_match resumes
-- or ends it before a new one can start.
create unique index matches_one_pending_per_player
  on public.matches (player_a)
  where result = 'pending';

comment on table public.matches is
  'One row per match (bot or human). Readable by both participants. Created by create_match, completed by report_match.';
comment on column public.matches.bot_level is
  'easy | medium | hard | master (SPEC 8.1). NULL for human vs human.';
comment on column public.matches.bot_profile is
  'Engine bot profile id (BOT_PROFILES). Set exactly when bot_level is set.';
comment on column public.matches.setup is
  'Snapshot of player_a at creation: {"deck": [...], "levels": {...}, "upgrades": {...}} (engine PlayerConfig).';
comment on column public.matches.finished_at is
  'When the result was booked. NULL exactly while result = pending.';
comment on column public.matches.result is
  'pending | a_won | b_won | draw | abandoned.';
comment on column public.matches.seed is
  'Server-generated match seed, 0 .. 2^53-1 (D-029).';
comment on column public.matches.picks is
  'Draft picks in order as a JSON array (SPEC 14.3), used for server re-simulation and reconnects.';

-- packs: reward packs (SPEC 7.4).
create table public.packs (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  -- match   = reward for a won match (SPEC 7.4)
  -- welcome = the first pack after choosing a username (SPEC 9)
  kind       text        not null default 'match',
  -- Match that earned the pack; NULL for the welcome pack. Also NULL after
  -- the match row disappears (the pack is kept).
  match_id   uuid        unique references public.matches (id) on delete set null,
  opened     boolean     not null default false,
  -- Reward, rolled server-side by open_pack; NULL while unopened.
  contents   jsonb,
  created_at timestamptz not null default now(),

  constraint packs_kind_valid check (kind in ('match', 'welcome')),
  constraint packs_welcome_has_no_match check (kind <> 'welcome' or match_id is null),
  constraint packs_opened_has_contents check (not opened or contents is not null),
  constraint packs_contents_object check (contents is null or jsonb_typeof(contents) = 'object')
);

-- Every player gets the welcome pack only once.
create unique index packs_one_welcome_per_player
  on public.packs (user_id)
  where kind = 'welcome';

comment on table public.packs is
  'Reward packs. At most one pack per match. Private to its owner. Rolled and opened by open_pack.';
comment on column public.packs.kind is
  'match (reward for a win) | welcome (onboarding pack, at most one per player).';
comment on column public.packs.contents is
  'Reward as a JSON object, set by open_pack. NULL while unopened.';

-- friendships: one row per pair of players (SPEC 10, milestone M5).
create table public.friendships (
  -- The player who sent the request.
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  -- The player who received it.
  friend_id  uuid        not null references public.profiles (id) on delete cascade,
  status     text        not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),

  constraint friendships_not_self check (user_id <> friend_id),
  -- pending  = request sent, not yet answered
  -- accepted = both are friends
  -- A declined request or a removed friend deletes the row.
  constraint friendships_status_valid check (status in ('pending', 'accepted'))
);

-- Only one row per pair, regardless of who asked first.
create unique index friendships_pair_key
  on public.friendships (least(user_id, friend_id), greatest(user_id, friend_id));

comment on table public.friendships is
  'Friend requests and friendships, one row per pair (user_id = requester). Readable by both sides.';
comment on column public.friendships.status is
  'pending | accepted. Declined or removed friendships are deleted.';

-- -----------------------------------------------------------------------------
-- 2. Indexes for the expected queries
-- -----------------------------------------------------------------------------

-- Global leaderboard (SPEC 10): highest Elo first.
create index profiles_elo_idx on public.profiles (elo desc, id);

-- Match history of a player, newest first, from both sides.
create index matches_player_a_idx on public.matches (player_a, created_at desc);
create index matches_player_b_idx on public.matches (player_b, created_at desc)
  where player_b is not null;

-- Unopened packs of a player.
create index packs_unopened_idx on public.packs (user_id, created_at)
  where not opened;
-- All packs of a player (history, foreign key lookups).
create index packs_user_idx on public.packs (user_id);

-- Friendships seen from the receiving side (the primary key covers user_id).
create index friendships_friend_idx on public.friendships (friend_id);

-- -----------------------------------------------------------------------------
-- 3. New accounts: profile, starting collection and starting deck
-- -----------------------------------------------------------------------------
-- SPEC 7.1: starting collection archer, knight, skeleton, bat, tnt, healer at
-- level 1 with one copy each; starting deck archer, knight, skeleton, healer.
-- These ids duplicate engine data (packages/engine/src/data) on purpose,
-- because the account must be complete the moment it exists.
--
-- security definer: the trigger fires inside Supabase Auth, whose role has no
-- rights on public tables. search_path is empty, so every name is qualified.

create function public.handle_new_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id);

  insert into public.player_cards (user_id, card_id, level, copies)
  select new.id, starter.card_id, 1, 1
  from unnest(array['archer', 'knight', 'skeleton', 'bat', 'tnt', 'healer']) as starter (card_id);

  insert into public.decks (user_id, cards)
  values (new.id, array['archer', 'knight', 'skeleton', 'healer']);

  return new;
end;
$$;

comment on function public.handle_new_player() is
  'Trigger on auth.users: creates the profile, the starting collection and the starting deck (SPEC 7.1).';

-- Not callable by clients (it is a trigger function anyway).
revoke all on function public.handle_new_player() from public, anon, authenticated;

create trigger rumble_realms_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_player();

-- -----------------------------------------------------------------------------
-- 4. Public profile fields
-- -----------------------------------------------------------------------------
-- Other players may see username, Elo and highest arena (leaderboard, friends,
-- opponents), never gold, jokers or other private columns.
--
-- security_invoker = false is deliberate: with security_invoker = true the RLS
-- policy on profiles (own row only) would apply and every player would only
-- see himself. Instead the view runs with the rights of its owner and is the
-- only way to read other profiles. That is safe because
--   * the view lists exactly these four columns,
--   * only `authenticated` gets SELECT on it (no anon, no writes; the view is
--     auto-updatable, so write privileges are revoked explicitly),
--   * profiles itself stays locked by RLS.
-- The Supabase Security Advisor reports this view as "Security Definer View";
-- that warning is expected and accepted here.

create view public.public_profiles
  with (security_invoker = false, security_barrier = true)
as
  select p.id, p.username, p.elo, p.highest_arena
  from public.profiles as p;

comment on view public.public_profiles is
  'Public profile fields of all players (id, username, elo, highest_arena) for signed-in users. Deliberately not security_invoker; exposes no other columns.';

-- -----------------------------------------------------------------------------
-- 5. Privileges (explicit, independent of Supabase default privileges)
-- -----------------------------------------------------------------------------

revoke all on table
  public.profiles, public.player_cards, public.decks,
  public.matches, public.packs, public.friendships,
  public.public_profiles
  from public, anon, authenticated;

-- Players read; RLS (section 6) narrows it to their own rows.
grant select on table
  public.profiles, public.player_cards, public.decks,
  public.matches, public.packs, public.friendships,
  public.public_profiles
  to authenticated;

-- Edge Functions (service_role, bypasses RLS) do all writes.
grant select, insert, update, delete on table
  public.profiles, public.player_cards, public.decks,
  public.matches, public.packs, public.friendships
  to service_role;
grant select on table public.public_profiles to service_role;

-- -----------------------------------------------------------------------------
-- 6. Row Level Security: read-only policies, no write policies at all
-- -----------------------------------------------------------------------------
-- (select auth.uid()) is evaluated once per query instead of once per row.

alter table public.profiles     enable row level security;
alter table public.player_cards enable row level security;
alter table public.decks        enable row level security;
alter table public.matches      enable row level security;
alter table public.packs        enable row level security;
alter table public.friendships  enable row level security;

create policy "profiles: owner reads own row"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "player_cards: owner reads own cards"
  on public.player_cards for select to authenticated
  using (user_id = (select auth.uid()));

create policy "decks: owner reads own deck"
  on public.decks for select to authenticated
  using (user_id = (select auth.uid()));

create policy "matches: both participants read"
  on public.matches for select to authenticated
  using ((select auth.uid()) in (player_a, player_b));

create policy "packs: owner reads own packs"
  on public.packs for select to authenticated
  using (user_id = (select auth.uid()));

create policy "friendships: both sides read"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_id, friend_id));

-- -----------------------------------------------------------------------------
-- 7. Write functions for the Edge Function (PostgREST RPC, service_role only)
-- -----------------------------------------------------------------------------
-- The Edge Function `api` checks the request, does the game maths (costs, Elo,
-- pack roll, match replay) and then calls exactly ONE of these functions per
-- action. Each function books its action in one transaction: either all of it
-- or nothing.
--
-- Rules for every function below:
--   * The first parameter p_user is the player; only his rows are touched.
--     Someone else's match or pack behaves as if it did not exist.
--   * No balance values: costs, rewards and Elo changes come in as parameters.
--     What the database itself can know (ownership, enough gold / copies /
--     jokers, state of a match or pack) is checked here.
--   * Every function first locks the player's profile row (FOR UPDATE). Two
--     calls for the same player (double click, retries) therefore run one
--     after the other, and the second one sees what the first one booked.
--     The profile is always locked first, so the functions cannot deadlock
--     each other.
--   * Errors: SQLSTATE P0001 with message 'rr:<code>'. The Edge Function maps
--     <code> to the API error code. rr:not_found = the profile is missing.
--   * security invoker: the functions run with the rights of the caller
--     (service_role, which may write and bypasses RLS). Clients cannot call
--     them at all: EXECUTE is revoked from public, anon and authenticated
--     (Supabase's default privileges would grant it) and granted to
--     service_role only (end of this section).
--   * search_path is empty, so every name is schema-qualified.

-- ---- rr_set_username ---------------------------------------------------------
-- First pick (username still NULL): sets the name and creates the unopened
-- welcome pack (SPEC 9). Later calls rename, allowed while
-- username_changes < p_free_renames; a change of case counts as a rename.
-- The exact current name again is a no-op success.
create function public.rr_set_username(p_user uuid, p_username text, p_free_renames integer)
returns table (username text, welcome_pack_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current text;
  v_changes integer;
  v_constraint text;
begin
  if p_username is null or p_free_renames is null or p_free_renames < 0 then
    raise exception using errcode = 'P0001',
      message = case when p_username is null then 'rr:username_invalid' else 'rr:bad_request' end;
  end if;

  select p.username::text, p.username_changes
    into v_current, v_changes
    from public.profiles as p
   where p.id = p_user
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'rr:not_found';
  end if;

  if v_current is not distinct from p_username then
    username := v_current;
    welcome_pack_id := null;
    return next;
    return;
  end if;
  if v_current is not null and v_changes >= p_free_renames then
    raise exception using errcode = 'P0001', message = 'rr:username_locked';
  end if;

  begin
    update public.profiles as p
       set username = p_username,
           username_changes = p.username_changes + case when v_current is null then 0 else 1 end
     where p.id = p_user;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'profiles_username_key' then
        raise exception using errcode = 'P0001', message = 'rr:username_taken';
      end if;
      raise;
    when check_violation then
      raise exception using errcode = 'P0001', message = 'rr:username_invalid';
  end;

  username := p_username;
  welcome_pack_id := null;
  if v_current is null then
    -- The unique index allows one welcome pack per player; should one exist
    -- already, none is added and welcome_pack_id stays NULL.
    insert into public.packs (user_id, kind)
    values (p_user, 'welcome')
    on conflict (user_id) where kind = 'welcome' do nothing
    returning id into welcome_pack_id;
  end if;
  return next;
end;
$$;

comment on function public.rr_set_username(uuid, text, integer) is
  'set_username: first pick (+ welcome pack) or rename while username_changes < p_free_renames. Errors rr:username_taken | username_locked | username_invalid | not_found | bad_request.';

-- ---- rr_set_deck -------------------------------------------------------------
-- Four different cards that the player owns.
create function public.rr_set_deck(p_user uuid, p_cards text[])
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cards text[];
begin
  perform 1 from public.profiles as p where p.id = p_user for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'rr:not_found';
  end if;

  if p_cards is null
     or cardinality(p_cards) <> 4
     or (select count(distinct c.card_id)
           from public.player_cards as c
          where c.user_id = p_user and c.card_id = any (p_cards)) <> 4 then
    raise exception using errcode = 'P0001', message = 'rr:deck_invalid';
  end if;

  begin
    insert into public.decks as d (user_id, cards)
    values (p_user, p_cards)
    on conflict (user_id) do update set cards = excluded.cards
    returning d.cards into v_cards;
  exception
    when check_violation or not_null_violation then
      raise exception using errcode = 'P0001', message = 'rr:deck_invalid';
  end;
  return v_cards;
end;
$$;

comment on function public.rr_set_deck(uuid, text[]) is
  'set_deck: four different owned cards. Errors rr:deck_invalid | not_found.';

-- ---- rr_level_up_card --------------------------------------------------------
-- Raises the card from p_from_level by one; costs p_copies copies and p_gold
-- gold (SPEC 7.2 values come from the Edge Function).
create function public.rr_level_up_card(
  p_user uuid, p_card text, p_from_level integer, p_copies integer, p_gold integer)
returns table (level integer, copies integer, gold integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gold   integer;
  v_level  integer;
  v_copies integer;
begin
  if p_card is null or p_from_level is null or p_copies is null or p_gold is null
     or p_from_level not between 1 and 4 or p_copies < 0 or p_gold < 0 then
    raise exception using errcode = 'P0001', message = 'rr:bad_request';
  end if;

  select p.gold into v_gold from public.profiles as p where p.id = p_user for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'rr:not_found';
  end if;

  select c.level, c.copies
    into v_level, v_copies
    from public.player_cards as c
   where c.user_id = p_user and c.card_id = p_card
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'rr:card_not_owned';
  end if;
  if v_level <> p_from_level then
    raise exception using errcode = 'P0001', message = 'rr:stale';
  end if;
  if v_copies < p_copies then
    raise exception using errcode = 'P0001', message = 'rr:not_enough_copies';
  end if;
  if v_gold < p_gold then
    raise exception using errcode = 'P0001', message = 'rr:not_enough_gold';
  end if;

  update public.player_cards as c
     set level = c.level + 1,
         copies = c.copies - p_copies
   where c.user_id = p_user and c.card_id = p_card
  returning c.level, c.copies into level, copies;

  update public.profiles as p
     set gold = p.gold - p_gold
   where p.id = p_user
  returning p.gold into gold;

  return next;
end;
$$;

comment on function public.rr_level_up_card(uuid, text, integer, integer, integer) is
  'level_up_card: level + 1 for p_copies copies and p_gold gold. Errors rr:card_not_owned | stale | not_enough_copies | not_enough_gold | not_found | bad_request.';

-- ---- rr_unlock_upgrade -------------------------------------------------------
-- Unlocks upgrade p_upgrade (0..2 = bit 0..2) for p_gold gold, if the card has
-- at least level p_min_level (SPEC 7.3 values come from the Edge Function).
create function public.rr_unlock_upgrade(
  p_user uuid, p_card text, p_upgrade integer, p_min_level integer, p_gold integer)
returns table (unlocked_upgrades integer, gold integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gold  integer;
  v_level integer;
  v_mask  integer;
  v_bit   integer;
begin
  if p_card is null or p_upgrade is null or p_min_level is null or p_gold is null
     or p_upgrade not between 0 and 2 or p_min_level not between 1 and 5 or p_gold < 0 then
    raise exception using errcode = 'P0001', message = 'rr:bad_request';
  end if;
  v_bit := 1 << p_upgrade;

  select p.gold into v_gold from public.profiles as p where p.id = p_user for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'rr:not_found';
  end if;

  select c.level, c.unlocked_upgrades
    into v_level, v_mask
    from public.player_cards as c
   where c.user_id = p_user and c.card_id = p_card
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'rr:card_not_owned';
  end if;
  if v_mask & v_bit <> 0 then
    raise exception using errcode = 'P0001', message = 'rr:upgrade_already_unlocked';
  end if;
  if v_level < p_min_level then
    raise exception using errcode = 'P0001', message = 'rr:level_too_low';
  end if;
  if v_gold < p_gold then
    raise exception using errcode = 'P0001', message = 'rr:not_enough_gold';
  end if;

  update public.player_cards as c
     set unlocked_upgrades = c.unlocked_upgrades | v_bit
   where c.user_id = p_user and c.card_id = p_card
  returning c.unlocked_upgrades into unlocked_upgrades;

  update public.profiles as p
     set gold = p.gold - p_gold
   where p.id = p_user
  returning p.gold into gold;

  return next;
end;
$$;

comment on function public.rr_unlock_upgrade(uuid, text, integer, integer, integer) is
  'unlock_upgrade: sets bit p_upgrade for p_gold gold if level >= p_min_level. Errors rr:card_not_owned | upgrade_already_unlocked | level_too_low | not_enough_gold | not_found | bad_request.';

-- ---- rr_spend_jokers ---------------------------------------------------------
-- Turns p_jokers jokers into p_copies copies of p_card (SPEC 7.4: the exchange
-- rate and the card pool are checked by the Edge Function). A card the player
-- does not own yet is unlocked at level 1.
create function public.rr_spend_jokers(p_user uuid, p_card text, p_copies integer, p_jokers integer)
returns table (copies integer, jokers integer, card_unlocked boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_jokers integer;
begin
  if p_card is null or p_copies is null or p_jokers is null or p_copies <= 0 or p_jokers <= 0 then
    raise exception using errcode = 'P0001', message = 'rr:bad_request';
  end if;

  select p.jokers into v_jokers from public.profiles as p where p.id = p_user for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'rr:not_found';
  end if;
  if v_jokers < p_jokers then
    raise exception using errcode = 'P0001', message = 'rr:not_enough_jokers';
  end if;

  update public.player_cards as c
     set copies = c.copies + p_copies
   where c.user_id = p_user and c.card_id = p_card
  returning c.copies into copies;
  card_unlocked := not found;
  if card_unlocked then
    begin
      insert into public.player_cards as c (user_id, card_id, level, copies)
      values (p_user, p_card, 1, p_copies)
      returning c.copies into copies;
    exception
      when check_violation then
        raise exception using errcode = 'P0001', message = 'rr:bad_request';
    end;
  end if;

  update public.profiles as p
     set jokers = p.jokers - p_jokers
   where p.id = p_user
  returning p.jokers into jokers;

  return next;
end;
$$;

comment on function public.rr_spend_jokers(uuid, text, integer, integer) is
  'spend_jokers: p_jokers jokers for p_copies copies; unlocks the card at level 1 if new. Errors rr:not_enough_jokers | not_found | bad_request.';

-- ---- rr_create_match ---------------------------------------------------------
-- Creates a pending bot match. The setup snapshot (deck, levels, upgrades of
-- the four deck cards) is taken from decks and player_cards right here, so it
-- always matches what the player owns. Seed and engine version come from the
-- Edge Function.
create function public.rr_create_match(
  p_user uuid, p_bot_level text, p_bot_profile text, p_seed bigint, p_engine_version integer)
returns table (
  id uuid, seed bigint, engine_version integer, bot_level text, bot_profile text, setup jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_username text;
  v_cards    text[];
  v_levels   jsonb;
  v_upgrades jsonb;
  v_owned    bigint;
begin
  select p.username::text into v_username from public.profiles as p where p.id = p_user for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'rr:not_found';
  end if;
  if v_username is null then
    raise exception using errcode = 'P0001', message = 'rr:username_missing';
  end if;
  if exists (select 1 from public.matches as m where m.player_a = p_user and m.result = 'pending') then
    raise exception using errcode = 'P0001', message = 'rr:match_pending';
  end if;

  select d.cards into v_cards from public.decks as d where d.user_id = p_user;
  select jsonb_object_agg(c.card_id, c.level),
         jsonb_object_agg(c.card_id, c.unlocked_upgrades),
         count(*)
    into v_levels, v_upgrades, v_owned
    from public.player_cards as c
   where c.user_id = p_user and c.card_id = any (v_cards);
  if v_cards is null or v_owned <> 4 then
    raise exception using errcode = 'P0001', message = 'rr:deck_invalid';
  end if;

  begin
    insert into public.matches as m (player_a, bot_level, bot_profile, seed, engine_version, setup)
    values (p_user, p_bot_level, p_bot_profile, p_seed, p_engine_version,
            jsonb_build_object('deck', to_jsonb(v_cards), 'levels', v_levels, 'upgrades', v_upgrades))
    returning m.id, m.seed, m.engine_version, m.bot_level, m.bot_profile, m.setup
         into id, seed, engine_version, bot_level, bot_profile, setup;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'rr:match_pending';
    when check_violation or not_null_violation then
      raise exception using errcode = 'P0001', message = 'rr:bad_request';
  end;
  return next;
end;
$$;

comment on function public.rr_create_match(uuid, text, text, bigint, integer) is
  'create_match: new pending bot match with a setup snapshot from decks/player_cards. Errors rr:username_missing | match_pending | deck_invalid | not_found | bad_request.';

-- ---- rr_finish_match ---------------------------------------------------------
-- Books the result of the player's pending match. The Edge Function has
-- replayed the match and computed Elo change, arena, gold and whether a pack
-- is due. 'abandoned' only closes the match: profile and packs stay untouched
-- (all amounts must then be 0 / false). Returns the values after booking.
create function public.rr_finish_match(
  p_user uuid, p_match uuid, p_result text, p_picks jsonb,
  p_elo_delta integer, p_arena integer, p_gold integer, p_with_pack boolean)
returns table (elo integer, highest_arena integer, arena_unlocked boolean, gold integer, pack_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_arena integer;
begin
  if p_match is null or p_picks is null or jsonb_typeof(p_picks) <> 'array'
     or p_elo_delta is null or p_arena is null or p_gold is null or p_with_pack is null
     or p_result is null or p_result not in ('a_won', 'b_won', 'draw', 'abandoned')
     or (p_result = 'abandoned'
         and (p_elo_delta <> 0 or p_arena <> 0 or p_gold <> 0 or p_with_pack))
     or (p_result <> 'abandoned'
         and (p_arena not between 1 and 5 or p_gold < 0 or (p_with_pack and p_result <> 'a_won'))) then
    raise exception using errcode = 'P0001', message = 'rr:bad_request';
  end if;

  select p.highest_arena into v_old_arena from public.profiles as p where p.id = p_user for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'rr:not_found';
  end if;

  -- The WHERE clause makes this the single point of truth: only one call can
  -- move a match out of 'pending'.
  update public.matches as m
     set result = p_result,
         picks = p_picks,
         elo_delta_a = p_elo_delta,
         finished_at = now()
   where m.id = p_match and m.player_a = p_user and m.result = 'pending';
  if not found then
    if exists (select 1 from public.matches as m where m.id = p_match and m.player_a = p_user) then
      raise exception using errcode = 'P0001', message = 'rr:match_not_pending';
    end if;
    raise exception using errcode = 'P0001', message = 'rr:match_not_found';
  end if;

  pack_id := null;
  if p_result = 'abandoned' then
    select p.elo, p.highest_arena, p.gold
      into elo, highest_arena, gold
      from public.profiles as p
     where p.id = p_user;
    arena_unlocked := false;
    return next;
    return;
  end if;

  update public.profiles as p
     set elo = greatest(0, p.elo + p_elo_delta),
         games_played = p.games_played + 1,
         highest_arena = greatest(p.highest_arena, p_arena),
         gold = p.gold + p_gold
   where p.id = p_user
  returning p.elo, p.highest_arena, p.gold into elo, highest_arena, gold;
  arena_unlocked := highest_arena > v_old_arena;

  if p_with_pack then
    insert into public.packs as k (user_id, kind, match_id)
    values (p_user, 'match', p_match)
    returning k.id into pack_id;
  end if;
  return next;
end;
$$;

comment on function public.rr_finish_match(uuid, uuid, text, jsonb, integer, integer, integer, boolean) is
  'report_match: books the result of a pending match (Elo, games, arena, gold, pack after a win). Errors rr:match_not_found | match_not_pending | not_found | bad_request.';

-- ---- rr_open_pack ------------------------------------------------------------
-- Opens an unopened pack of the player with the reward rolled by the Edge
-- Function and books it. p_contents is one of
--   {"kind": "cards", "card": "<id>", "copies": n}
--   {"kind": "gold", "gold": n}
--   {"kind": "jokers", "jokers": n}
-- with an integer n > 0 and no other keys. It is stored normalised.
create function public.rr_open_pack(p_user uuid, p_pack uuid, p_contents jsonb)
returns table (card_unlocked boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind       text;
  v_amount_key text;
  v_number     numeric;
  v_amount     integer;
  v_card       text;
  v_contents   jsonb;
begin
  -- Checked step by step (SQL does not promise to evaluate OR from left to
  -- right, and jsonb_object_keys fails on anything but an object).
  if jsonb_typeof(p_contents) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'rr:bad_request';
  end if;
  v_kind := p_contents ->> 'kind';
  v_amount_key := case v_kind when 'cards' then 'copies' when 'gold' then 'gold' when 'jokers' then 'jokers' end;
  if v_amount_key is null then
    raise exception using errcode = 'P0001', message = 'rr:bad_request';
  end if;
  if (select array_agg(k.key order by k.key) from jsonb_object_keys(p_contents) as k (key))
       is distinct from (case v_kind
                           when 'cards' then array['card', 'copies', 'kind']
                           else array[v_amount_key, 'kind'] end)
     or jsonb_typeof(p_contents -> v_amount_key) is distinct from 'number'
     or (v_kind = 'cards' and jsonb_typeof(p_contents -> 'card') is distinct from 'string') then
    raise exception using errcode = 'P0001', message = 'rr:bad_request';
  end if;
  v_number := (p_contents ->> v_amount_key)::numeric;
  if v_number <> trunc(v_number) or v_number not between 1 and 2147483647 then
    raise exception using errcode = 'P0001', message = 'rr:bad_request';
  end if;
  v_amount := v_number::integer;
  v_card := p_contents ->> 'card';
  v_contents := case v_kind
                  when 'cards' then jsonb_build_object('kind', v_kind, 'card', v_card, 'copies', v_amount)
                  else jsonb_build_object('kind', v_kind, v_amount_key, v_amount) end;

  perform 1 from public.profiles as p where p.id = p_user for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'rr:not_found';
  end if;

  -- Only one call can move a pack from unopened to opened.
  update public.packs as k
     set opened = true,
         contents = v_contents
   where k.id = p_pack and k.user_id = p_user and not k.opened;
  if not found then
    if exists (select 1 from public.packs as k where k.id = p_pack and k.user_id = p_user) then
      raise exception using errcode = 'P0001', message = 'rr:pack_already_opened';
    end if;
    raise exception using errcode = 'P0001', message = 'rr:pack_not_found';
  end if;

  card_unlocked := false;
  if v_kind = 'cards' then
    update public.player_cards as c
       set copies = c.copies + v_amount
     where c.user_id = p_user and c.card_id = v_card;
    if not found then
      begin
        insert into public.player_cards (user_id, card_id, level, copies)
        values (p_user, v_card, 1, v_amount);
      exception
        when check_violation then
          raise exception using errcode = 'P0001', message = 'rr:bad_request';
      end;
      card_unlocked := true;
    end if;
  elsif v_kind = 'gold' then
    update public.profiles as p set gold = p.gold + v_amount where p.id = p_user;
  else
    update public.profiles as p set jokers = p.jokers + v_amount where p.id = p_user;
  end if;
  return next;
end;
$$;

comment on function public.rr_open_pack(uuid, uuid, jsonb) is
  'open_pack: opens an unopened pack of the player and books the reward. Errors rr:pack_not_found | pack_already_opened | not_found | bad_request.';

-- ---- Privileges of the functions ---------------------------------------------
-- Only the Edge Function (service_role) may call them.
revoke all on function
  public.rr_set_username(uuid, text, integer),
  public.rr_set_deck(uuid, text[]),
  public.rr_level_up_card(uuid, text, integer, integer, integer),
  public.rr_unlock_upgrade(uuid, text, integer, integer, integer),
  public.rr_spend_jokers(uuid, text, integer, integer),
  public.rr_create_match(uuid, text, text, bigint, integer),
  public.rr_finish_match(uuid, uuid, text, jsonb, integer, integer, integer, boolean),
  public.rr_open_pack(uuid, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function
  public.rr_set_username(uuid, text, integer),
  public.rr_set_deck(uuid, text[]),
  public.rr_level_up_card(uuid, text, integer, integer, integer),
  public.rr_unlock_upgrade(uuid, text, integer, integer, integer),
  public.rr_spend_jokers(uuid, text, integer, integer),
  public.rr_create_match(uuid, text, text, bigint, integer),
  public.rr_finish_match(uuid, uuid, text, jsonb, integer, integer, integer, boolean),
  public.rr_open_pack(uuid, uuid, jsonb)
  to service_role;
