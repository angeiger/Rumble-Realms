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
  -- change). The Edge Function `set_username` enforces the rule.
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
  -- Match seed, 0 .. 2^53 - 1 (D-029).
  seed           bigint      not null,
  -- ENGINE_VERSION used for the simulation (D-006).
  engine_version integer     not null,
  -- Draft picks in order (SPEC 14.3), a JSON array.
  picks          jsonb       not null default '[]'::jsonb,
  result         text        not null default 'pending',
  -- Elo change per side; NULL until booked (and always NULL for the bot side).
  elo_delta_a    integer,
  elo_delta_b    integer,
  created_at     timestamptz not null default now(),

  -- Exactly one opponent: a human or a bot.
  constraint matches_one_opponent check ((player_b is null) <> (bot_level is null)),
  constraint matches_not_self     check (player_b is null or player_b <> player_a),
  -- easy / medium / hard / master = Leicht / Mittel / Schwer / Meister (SPEC 8.1),
  -- same ids as BotLevelId in the engine.
  constraint matches_bot_level_valid
    check (bot_level is null or bot_level in ('easy', 'medium', 'hard', 'master')),
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
  constraint matches_bot_has_no_delta_b check (player_b is not null or elo_delta_b is null)
);

comment on table public.matches is
  'One row per match (bot or human). Readable by both participants. Created by create_match, completed by report_match.';
comment on column public.matches.bot_level is
  'easy | medium | hard | master (SPEC 8.1). NULL for human vs human.';
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
  -- Match that earned the pack; NULL for packs without a match (the first
  -- onboarding pack, SPEC 9). Kept when the match row disappears.
  match_id   uuid        unique references public.matches (id) on delete set null,
  opened     boolean     not null default false,
  -- Reward, rolled server-side by open_pack; NULL while unopened.
  contents   jsonb,
  created_at timestamptz not null default now(),

  constraint packs_opened_has_contents check (not opened or contents is not null),
  constraint packs_contents_object check (contents is null or jsonb_typeof(contents) = 'object')
);

comment on table public.packs is
  'Reward packs. At most one pack per match. Private to its owner. Rolled and opened by open_pack.';
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
