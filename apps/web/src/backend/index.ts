/** Chooses the backend by configuration: Supabase if configured, else local in-browser mode. */
import { createLocalBackend } from './local.ts';
import { createSupabaseBackend } from './supabase.ts';
import type { Backend } from './types.ts';

export type { AuthUser, Backend, PackInfo, PlayerState } from './types.ts';
export { BackendUnavailableError } from './types.ts';

export interface BackendConfig {
  supabase: { url: string; key: string; google: boolean; email: boolean } | null;
}

type EnvLike = Record<string, string | boolean | undefined>;

function str(value: string | boolean | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Pure: reads the VITE_* variables. */
export function readConfig(env: EnvLike): BackendConfig {
  const url = str(env['VITE_SUPABASE_URL']);
  const key = str(env['VITE_SUPABASE_PUBLISHABLE_KEY']) || str(env['VITE_SUPABASE_ANON_KEY']);
  if (!url || !key) return { supabase: null };
  return {
    supabase: {
      url,
      key,
      google: str(env['VITE_AUTH_GOOGLE']) === '1',
      email: str(env['VITE_AUTH_EMAIL']) === '1',
    },
  };
}

let instance: Backend | null = null;

export function getBackend(): Backend {
  if (!instance) {
    const config = readConfig(import.meta.env as unknown as EnvLike);
    instance = config.supabase ? createSupabaseBackend(config.supabase) : createLocalBackend();
  }
  return instance;
}

/** Tests: inject a fake backend, or null to reset. */
export function setBackendForTests(backend: Backend | null): void {
  instance = backend;
}
