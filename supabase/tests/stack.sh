#!/usr/bin/env bash
# =============================================================================
# The local Supabase stack for the backend tests (VM and CI).
#
#   bash supabase/tests/stack.sh up            start (if not running) and wait for the function
#   bash supabase/tests/stack.sh reset         fresh database: all migrations again, no data
#   bash supabase/tests/stack.sh functions     reload the Edge Functions after a code change
#   bash supabase/tests/stack.sh down          stop, keep nothing
#   bash supabase/tests/stack.sh status        show what runs
#   eval "$(bash supabase/tests/stack.sh env)" export API_URL and the keys for the tests
#   bash supabase/tests/stack.sh env --plain   the same as KEY=value lines (for $GITHUB_ENV)
#
# Only the services the game needs run (database, auth, REST API, gateway, Edge Functions),
# to save memory. `supabase start` serves the functions in supabase/functions itself (Edge
# Runtime container, config from supabase/config.toml), so no `supabase functions serve` is
# needed; `up` waits until the function `api` answers. The running workers do NOT pick up
# code changes by themselves: `functions` restarts the Edge Runtime container.
#
# The keys printed by `env` are the public default keys of the LOCAL stack. They are read at
# run time and never written into a file of the repo.
#
# If the current shell is not yet in the group `docker` (right after installing Docker in the
# VM), the commands run through `sg docker`.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

EXCLUDE="studio,imgproxy,storage-api,logflare,vector,realtime,postgres-meta,supavisor,mailpit"
FUNCTION_URL_PATH="/functions/v1/api"
WAIT_SECONDS=90

# Runs `supabase <args>`, through `sg docker` if Docker is not usable directly.
sb() {
  if docker info >/dev/null 2>&1; then
    supabase "$@"
  elif command -v sg >/dev/null 2>&1 && getent group docker | grep -qw "$(id -un)"; then
    sg docker -c "$(printf '%q ' supabase "$@")"
  else
    echo "stack.sh: Docker is not reachable (is it installed and running?)" >&2
    exit 1
  fi
}

# `supabase status -o env` as KEY="value" lines (stderr hides the list of stopped services).
status_env() {
  sb status -o env 2>/dev/null
}

is_running() {
  status_env | grep -q '^API_URL='
}

value_of() {
  # $1 = name; prints the value without quotes.
  status_env | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" | head -n 1
}

wait_for_function() {
  local url
  url="$(value_of API_URL)${FUNCTION_URL_PATH}"
  local deadline=$((SECONDS + WAIT_SECONDS))
  while ((SECONDS < deadline)); do
    # The preflight needs no token; 204 means the function itself answered.
    if [[ "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "${url}")" == "204" ]]; then
      echo "Function api answers at ${url}"
      return 0
    fi
    sleep 2
  done
  echo "stack.sh: the function api did not answer within ${WAIT_SECONDS} s (${url})" >&2
  sb status >&2 || true
  return 1
}

cmd_up() {
  if is_running; then
    echo "Stack is running already."
  else
    sb start -x "${EXCLUDE}"
  fi
  wait_for_function
}

cmd_reset() {
  sb db reset
  wait_for_function
}

cmd_functions() {
  local project
  project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)"
  if docker info >/dev/null 2>&1; then
    docker restart "supabase_edge_runtime_${project}" >/dev/null
  else
    sg docker -c "docker restart supabase_edge_runtime_${project}" >/dev/null
  fi
  wait_for_function
}

cmd_down() {
  sb stop --no-backup
}

cmd_env() {
  local plain=0
  [[ "${1:-}" == "--plain" ]] && plain=1
  if ! is_running; then
    echo "stack.sh: the stack is not running (bash supabase/tests/stack.sh up)" >&2
    exit 1
  fi
  local name value
  for name in API_URL PUBLISHABLE_KEY ANON_KEY SECRET_KEY SERVICE_ROLE_KEY; do
    value="$(value_of "${name}")"
    [[ -z "${value}" ]] && continue
    if [[ "${plain}" -eq 1 ]]; then
      printf '%s=%s\n' "${name}" "${value}"
    else
      printf 'export %s=%q\n' "${name}" "${value}"
    fi
  done
}

case "${1:-}" in
  up) cmd_up ;;
  reset) cmd_reset ;;
  functions) cmd_functions ;;
  down) cmd_down ;;
  status) sb status ;;
  env) cmd_env "${2:-}" ;;
  *)
    echo "usage: bash supabase/tests/stack.sh up|reset|functions|down|status|env [--plain]" >&2
    exit 2
    ;;
esac
