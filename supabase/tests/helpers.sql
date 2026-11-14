-- =============================================================================
-- TEST HELPER ONLY - never run this on Supabase.
-- Assertion helpers for the plain-psql tests. Every helper raises an
-- exception on failure; run_local.sh uses ON_ERROR_STOP, so the first failed
-- assertion stops the run. Passed assertions are counted in tests.results.
-- =============================================================================

create schema tests;
grant usage on schema tests to public;

create table tests.results (
  id      bigserial primary key,
  message text not null
);

-- Records a passed assertion. security definer so that every role
-- (anon, authenticated, service_role) can count without table rights.
create function tests.pass(message text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into tests.results (message) values (message);
$$;

create function tests.ok(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception 'FAILED: %', message;
  end if;
  perform tests.pass(message);
end;
$$;

create function tests.eq(actual anyelement, expected anyelement, message text)
returns void
language plpgsql
as $$
begin
  if actual is distinct from expected then
    raise exception 'FAILED: % (expected %, got %)', message, expected, actual;
  end if;
  perform tests.pass(message);
end;
$$;

-- Runs `statement` with the rights of the current role and expects it to fail
-- with SQLSTATE `expected_state` (e.g. 42501 insufficient_privilege,
-- 23514 check_violation, 23505 unique_violation).
create function tests.throws(statement text, expected_state text, message text)
returns void
language plpgsql
as $$
declare
  got_state text;
  got_message text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics got_state = returned_sqlstate, got_message = message_text;
  end;
  if got_state is null then
    raise exception 'FAILED: % (statement succeeded: %)', message, statement;
  end if;
  if got_state <> expected_state then
    raise exception 'FAILED: % (expected SQLSTATE %, got % "%")',
      message, expected_state, got_state, got_message;
  end if;
  perform tests.pass(message);
end;
$$;

-- Runs `statement` and expects it to succeed.
create function tests.lives(statement text, message text)
returns void
language plpgsql
as $$
declare
  got_message text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics got_message = message_text;
    raise exception 'FAILED: % (%: %)', message, sqlstate, got_message;
  end;
  perform tests.pass(message);
end;
$$;

-- Simulates the JWT that PostgREST passes for a signed-in user. Use together
-- with `set role authenticated;` in the test script.
create function tests.authenticate(user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', user_id, 'role', 'authenticated')::text, false);
$$;

create function tests.clear_auth()
returns void
language sql
as $$
  select set_config('request.jwt.claims', '', false);
$$;

grant execute on all functions in schema tests to public;
