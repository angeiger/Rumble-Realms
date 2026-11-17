import { defineConfig } from 'vitest/config';

/**
 * `pnpm test:backend`: tests against the local Supabase stack (supabase/tests/stack.sh).
 * Every test creates its own guest accounts, so the files may run in parallel; two at a time
 * keep the load of the small VM low.
 */
export default defineConfig({
  test: {
    include: ['src/backend/**/*.test.ts'],
    globalSetup: ['src/backend/globalSetup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxWorkers: 2,
    // Show the printed measurements (http.test.ts) also when the tests pass.
    silent: false,
  },
});
