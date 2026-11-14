#!/usr/bin/env bash
# =============================================================================
# Runs the database tests against a local PostgreSQL (no Supabase, no Docker).
#
#   bash supabase/tests/run_local.sh          # run and clean up
#   bash supabase/tests/run_local.sh --keep   # keep the database for a look
#
# Steps: create a fresh database rr_test, load setup_local.sql (minimal
# Supabase stand-in), apply every file in supabase/migrations/ in order, load
# the test helpers and fixtures, run every *.test.sql. The first error stops
# the run (exit code != 0). The database is dropped at the end.
#
# Requires a local PostgreSQL server (sudo apt-get install postgresql
# postgresql-contrib). Connects as OS user postgres via peer authentication
# (sudo), so no password is needed or stored anywhere.
# =============================================================================
set -euo pipefail

DB_NAME="rr_test"
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "${TESTS_DIR}/../migrations" && pwd)"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

# Files are piped via stdin, because the postgres OS user may not be able to
# read the home directory. Query results are discarded (-o /dev/null);
# errors and notices still appear on stderr.
pg() { sudo -u postgres "$@"; }
run_sql() {
  local file="$1"
  echo "  -> $(basename "$(dirname "${file}")")/$(basename "${file}")"
  pg psql -X -q -v ON_ERROR_STOP=1 --single-transaction -o /dev/null -d "${DB_NAME}" < "${file}"
}
cleanup() {
  if [[ "${KEEP}" -eq 0 ]]; then
    pg dropdb --if-exists --force "${DB_NAME}" 2>/dev/null || true
  fi
}

pg psql -X -q -v ON_ERROR_STOP=1 -d postgres \
  -c "set client_min_messages = warning" -c "drop database if exists ${DB_NAME} with (force)"
pg createdb "${DB_NAME}"
trap cleanup EXIT

echo "Supabase stand-in:"
run_sql "${TESTS_DIR}/setup_local.sql"

echo "Migrations:"
shopt -s nullglob
migrations=("${MIGRATIONS_DIR}"/*.sql)
if [[ ${#migrations[@]} -eq 0 ]]; then
  echo "No migrations found in ${MIGRATIONS_DIR}" >&2
  exit 1
fi
for file in "${migrations[@]}"; do
  run_sql "${file}"
done

echo "Test helpers and fixtures:"
run_sql "${TESTS_DIR}/helpers.sql"
run_sql "${TESTS_DIR}/fixtures.sql"

echo "Tests:"
for file in "${TESTS_DIR}"/*.test.sql; do
  run_sql "${file}"
done

count="$(pg psql -X -At -d "${DB_NAME}" -c 'select count(*) from tests.results')"
echo "OK: ${count} assertions passed."
if [[ "${KEEP}" -eq 1 ]]; then
  echo "Database ${DB_NAME} kept (sudo -u postgres psql -d ${DB_NAME})."
fi
