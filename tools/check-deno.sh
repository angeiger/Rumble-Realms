#!/usr/bin/env bash
# Type check and unit tests of the Edge Function `api` with Deno (pnpm check:deno).
#
# The function is Deno code (Deno.serve, npm: imports), so it is checked by Deno, not by the
# repo's tsc projects. The config of the function (its deno.json with the pinned supabase-js)
# is passed explicitly, because Deno would otherwise look for a config from the current folder.
# Deno is taken from PATH, else from its default install folder ~/.deno/bin (VM).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCTION_DIR="${ROOT}/supabase/functions/api"

DENO="$(command -v deno || true)"
if [[ -z "${DENO}" && -x "${HOME}/.deno/bin/deno" ]]; then
  DENO="${HOME}/.deno/bin/deno"
fi
if [[ -z "${DENO}" ]]; then
  echo "check:deno: Deno not found. Install it (https://deno.com) or add ~/.deno/bin to PATH." >&2
  exit 1
fi

cd "${ROOT}"
"${DENO}" check --quiet --config "${FUNCTION_DIR}/deno.json" "${FUNCTION_DIR}/"
"${DENO}" test --quiet --no-check --config "${FUNCTION_DIR}/deno.json" "${FUNCTION_DIR}/"
