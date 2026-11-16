import { describe, expect, it } from 'vitest';
import { readConfig } from './index.ts';

describe('readConfig', () => {
  it('uses local mode without url or key', () => {
    expect(readConfig({})).toEqual({ supabase: null });
    expect(readConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toEqual({ supabase: null });
    expect(readConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toEqual({ supabase: null });
    expect(readConfig({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toEqual({
      supabase: null,
    });
  });

  it('switches to supabase with url and key, auth methods off by default', () => {
    expect(
      readConfig({
        VITE_SUPABASE_URL: 'https://x.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'k',
      }),
    ).toEqual({
      supabase: { url: 'https://x.supabase.co', key: 'k', google: false, email: false },
    });
  });

  it('falls back to the anon key name and prefers the publishable key', () => {
    const base = { VITE_SUPABASE_URL: 'u' };
    expect(readConfig({ ...base, VITE_SUPABASE_ANON_KEY: 'anon' }).supabase?.key).toBe('anon');
    expect(
      readConfig({ ...base, VITE_SUPABASE_ANON_KEY: 'anon', VITE_SUPABASE_PUBLISHABLE_KEY: 'pub' })
        .supabase?.key,
    ).toBe('pub');
  });

  it("enables auth methods only with '1'", () => {
    const c = readConfig({
      VITE_SUPABASE_URL: 'u',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'k',
      VITE_AUTH_GOOGLE: '1',
      VITE_AUTH_EMAIL: 'true',
    });
    expect(c.supabase).toMatchObject({ google: true, email: false });
  });
});
