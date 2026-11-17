/** Short commit id injected by vite.config.ts; empty if unavailable. */
declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Legacy name of the publishable key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** '1' switches Google sign-in on. */
  readonly VITE_AUTH_GOOGLE?: string;
  /** '1' switches e-mail magic-link sign-in on. */
  readonly VITE_AUTH_EMAIL?: string;
}
