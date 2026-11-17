import { defineConfig } from 'vitest/config';

/**
 * `pnpm test`: the unit tests of this package (no Docker needed). The tests against the local
 * Supabase stack run with `pnpm test:backend` (vitest.backend.config.ts).
 */
export default defineConfig({
  test: {
    include: ['src/unit/**/*.test.ts'],
  },
});
