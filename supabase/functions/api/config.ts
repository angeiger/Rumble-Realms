/**
 * Settings of the Edge Function from its environment. Supabase provides them to every
 * function; nothing here is configured by hand.
 */

export interface FunctionConfig {
  url: string;
  /** A key with the rights of `service_role` (bypasses RLS). Never logged. */
  secretKey: string;
}

/**
 * The secret key: `SUPABASE_SECRET_KEYS` is a JSON object name -> key (new API keys); its
 * entry `default` wins, else the first one. Without it the legacy `SUPABASE_SERVICE_ROLE_KEY`
 * (the legacy keys end in late 2026). null if neither is usable.
 */
export function secretKeyFrom(get: (name: string) => string | undefined): string | null {
  const keys = get('SUPABASE_SECRET_KEYS');
  if (keys !== undefined && keys.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(keys);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const preferred = record['default'];
        if (typeof preferred === 'string' && preferred !== '') return preferred;
        for (const value of Object.values(record)) {
          if (typeof value === 'string' && value !== '') return value;
        }
      }
    } catch {
      // Not JSON: fall back to the legacy key below.
    }
  }
  const legacy = get('SUPABASE_SERVICE_ROLE_KEY');
  return legacy !== undefined && legacy !== '' ? legacy : null;
}

/** URL and secret key, or an error naming what is missing (without any value). */
export function configFrom(get: (name: string) => string | undefined): FunctionConfig {
  const url = get('SUPABASE_URL');
  const secretKey = secretKeyFrom(get);
  if (url === undefined || url === '') throw new Error('api: SUPABASE_URL is not set');
  if (secretKey === null) {
    throw new Error('api: neither SUPABASE_SECRET_KEYS nor SUPABASE_SERVICE_ROLE_KEY is set');
  }
  return { url, secretKey };
}
