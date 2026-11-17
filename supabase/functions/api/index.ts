/**
 * Edge Function `api`: the one server entry point for every write action of the game
 * (SPEC 14.2, D-082). POST `{ action, ...parameters }` with the player's access token.
 *
 * The game logic lives in the shared code (handlers.ts), loaded from the generated copy in
 * ../_shared (D-083, `pnpm sync:functions`). This file only wires Deno, supabase-js and the
 * database adapter together.
 */
import { createClient, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { configFrom } from './config.ts';
import { createApiHandler } from './handler.ts';
import { createRandInt } from './random.ts';
import { SupabaseStore } from './supabaseStore.ts';
import type { DbClient } from './supabaseStore.ts';

const config = configFrom((name) => Deno.env.get(name));

/** Admin client: service role rights, bypasses RLS. Never sees a user session. */
const admin = createClient(config.url, config.secretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/**
 * The account id of an access token. An answer of the auth server that rejects the token (4xx)
 * gives null; a failed check (network, 5xx) throws and becomes a 500.
 */
async function authenticate(token: string): Promise<string | null> {
  const { data, error } = await admin.auth.getUser(token);
  if (error !== null) {
    const status = error.status ?? 0;
    if (isAuthRetryableFetchError(error) || status === 0 || status >= 500) {
      throw new Error(`auth check failed (${error.name}, status ${status})`);
    }
    return null;
  }
  return data.user?.id ?? null;
}

// DbClient is the subset of the supabase-js client the store uses (from/select/eq/maybeSingle,
// rpc). The cast is needed because TypeScript cannot compare the deeply generic supabase-js
// types structurally ("excessively deep"); the unit tests of the store pin the calls it makes.
const db = admin as unknown as DbClient;

const handler = createApiHandler({
  authenticate,
  store: new SupabaseStore(db),
  env: { randInt: createRandInt(), now: () => performance.now() },
});

Deno.serve(handler);
