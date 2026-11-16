/**
 * Settings of the local stack, from the environment (`eval "$(bash supabase/tests/stack.sh env)"`).
 * New key names first (publishable / secret), the legacy JWT keys as fallback.
 */
function first(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

export const API_URL = first('API_URL');
/** The public key of the app (role anon until a user signs in). */
export const CLIENT_KEY = first('PUBLISHABLE_KEY', 'ANON_KEY');
/** The server key (role service_role); only for preparing and checking data in the tests. */
export const ADMIN_KEY = first('SECRET_KEY', 'SERVICE_ROLE_KEY');

export function missingSettings(): string[] {
  const missing: string[] = [];
  if (API_URL === undefined) missing.push('API_URL');
  if (CLIENT_KEY === undefined) missing.push('PUBLISHABLE_KEY/ANON_KEY');
  if (ADMIN_KEY === undefined) missing.push('SECRET_KEY/SERVICE_ROLE_KEY');
  return missing;
}

/** true if the backend tests can run; else every `describe.skipIf(!CONFIGURED)` skips. */
export const CONFIGURED = missingSettings().length === 0;
