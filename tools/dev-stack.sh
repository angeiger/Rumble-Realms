#!/usr/bin/env bash
# =============================================================================
# Starts the app for development (pnpm dev, http://localhost:5173) against the LOCAL
# Supabase stack instead of the local mode: real guest sign-in, database and Edge Function.
#
#   pnpm dev:stack
#
# Starts the stack if needed. The browser talks to the stack directly at
# http://127.0.0.1:54321, so when the browser runs on another machine (tunnel to the VM),
# port 54321 has to be forwarded as well as 5173. The keys are the public default keys of
# the local stack; they are read at run time and never written into a file.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

bash supabase/tests/stack.sh up
eval "$(bash supabase/tests/stack.sh env)"
export VITE_SUPABASE_URL="${API_URL}"
export VITE_SUPABASE_PUBLISHABLE_KEY="${PUBLISHABLE_KEY:-${ANON_KEY}}"
exec pnpm dev
