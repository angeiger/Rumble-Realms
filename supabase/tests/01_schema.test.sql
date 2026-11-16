-- =============================================================================
-- Structural checks on the catalog: RLS everywhere, read-only policies only,
-- no client write privileges. These checks cover every relation in schema
-- public, so a table added later without proper rules also fails here.
-- =============================================================================

do $$
declare
  t text;
  expected_tables constant text[] :=
    array['decks', 'friendships', 'matches', 'packs', 'player_cards', 'profiles'];
begin
  perform tests.eq(
    (select array_agg(c.relname::text order by c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')),
    expected_tables,
    'schema public contains exactly the six SPEC tables');

  foreach t in array expected_tables loop
    perform tests.ok(
      (select c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = t),
      format('RLS is enabled on %s', t));
  end loop;
end;
$$;

-- No policy other than SELECT, and only for role authenticated.
do $$
begin
  perform tests.eq(
    (select count(*) from pg_policies where schemaname = 'public' and cmd <> 'SELECT'),
    0::bigint,
    'no INSERT/UPDATE/DELETE/ALL policy exists in schema public');
  perform tests.eq(
    (select count(*) from pg_policies
      where schemaname = 'public' and roles <> array['authenticated']::name[]),
    0::bigint,
    'every policy applies to role authenticated only');
  perform tests.eq(
    (select count(distinct tablename) from pg_policies where schemaname = 'public'),
    6::bigint,
    'every table has a read policy');
end;
$$;

-- Privileges on every table and view in public.
do $$
declare
  rel record;
  priv text;
begin
  for rel in
    select format('public.%I', c.relname) as name, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      perform tests.ok(not has_table_privilege('anon', rel.name, priv),
                       format('anon has no %s on %s', priv, rel.name));
    end loop;
    foreach priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      perform tests.ok(not has_table_privilege('authenticated', rel.name, priv),
                       format('authenticated has no %s on %s', priv, rel.name));
    end loop;
    perform tests.ok(has_table_privilege('authenticated', rel.name, 'SELECT'),
                     format('authenticated may SELECT %s', rel.name));
    perform tests.ok(not has_any_column_privilege('anon', rel.name, 'SELECT'),
                     format('anon has no column SELECT on %s', rel.name));
  end loop;
end;
$$;

-- The public view exposes exactly the public columns.
do $$
begin
  perform tests.eq(
    (select array_agg(column_name::text order by ordinal_position)
       from information_schema.columns
      where table_schema = 'public' and table_name = 'public_profiles'),
    array['id', 'username', 'elo', 'highest_arena'],
    'public_profiles has exactly id, username, elo, highest_arena');
end;
$$;

-- Functions in public: none callable by clients.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    perform tests.ok(not has_function_privilege('anon', fn.sig, 'EXECUTE'),
                     format('anon cannot execute %s', fn.sig));
    perform tests.ok(not has_function_privilege('authenticated', fn.sig, 'EXECUTE'),
                     format('authenticated cannot execute %s', fn.sig));
  end loop;

  perform tests.ok(
    (select p.prosecdef and p.proconfig @> array['search_path=""']
       from pg_proc p where p.oid = 'public.handle_new_player()'::regprocedure),
    'handle_new_player is security definer with an empty search_path');

  perform tests.eq(
    (select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'citext'),
    'extensions',
    'citext lives in schema extensions');
end;
$$;
