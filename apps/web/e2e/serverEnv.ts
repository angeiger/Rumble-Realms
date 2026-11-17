/**
 * Settings of the local Supabase stack for the end-to-end tests against a real server, read from
 * the environment (`eval "$(bash supabase/tests/stack.sh env)"`). Same names and fallbacks as
 * tools/backend-tests. The keys are the public default keys of the LOCAL stack; they are only
 * read at run time and never written into a file.
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
/** The server key (role service_role); only to prepare and check data in the tests. */
export const ADMIN_KEY = first('SECRET_KEY', 'SERVICE_ROLE_KEY');

export function missingSettings(): string[] {
  const missing: string[] = [];
  if (API_URL === undefined) missing.push('API_URL');
  if (CLIENT_KEY === undefined) missing.push('PUBLISHABLE_KEY/ANON_KEY');
  if (ADMIN_KEY === undefined) missing.push('SECRET_KEY/SERVICE_ROLE_KEY');
  return missing;
}

export function missingMessage(missing: string[]): string {
  return (
    `Server e2e tests SKIPPED: ${missing.join(', ')} not set. Start the local stack and load its ` +
    'settings first:\n  bash supabase/tests/stack.sh up\n  eval "$(bash supabase/tests/stack.sh env)"'
  );
}
