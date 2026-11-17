-- =============================================================================
-- TEST HELPER ONLY - never run this on Supabase.
-- =============================================================================
-- Recreates the small part of a Supabase database that the migrations rely
-- on, so they can be tested on a plain local PostgreSQL:
--   * roles anon, authenticated, service_role (service_role bypasses RLS),
--   * schema extensions,
--   * schema auth with a minimal auth.users table and auth.uid(),
--   * Supabase's default privileges, which grant ALL on every new object in
--     schema public to anon/authenticated/service_role. The migration must
--     revoke them itself, so the tests only pass if it really does.
--
-- It lives in supabase/tests/ and not in supabase/migrations/ on purpose:
-- the GitHub integration applies everything in migrations/ to production.
-- Used by run_local.sh against a throw-away database (rr_test).
-- =============================================================================

-- Roles are cluster-wide; create them only once.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  -- The role Supabase Auth uses to create accounts; it has no rights on public.
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end;
$$;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Supabase puts schema extensions on the search_path of its roles, so that
-- e.g. the citext comparison operators are found without qualification.
do $$
begin
  execute format('alter database %I set search_path = "$user", public, extensions',
                 current_database());
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Same default privileges as on Supabase (owner of migration objects: postgres).
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

-- Minimal auth schema.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id           uuid primary key,
  email        text,
  is_anonymous boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Same logic as Supabase's auth.uid(): the user id from the JWT claims that
-- PostgREST puts into the session settings.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase Auth inserts into auth.users as supabase_auth_admin.
grant usage on schema auth to supabase_auth_admin;
grant select, insert, update, delete on auth.users to supabase_auth_admin;
