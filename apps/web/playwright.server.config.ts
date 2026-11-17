/**
 * End-to-end tests against the LOCAL Supabase stack (real guest sign-in, real database, real
 * Edge Function). Separate from playwright.config.ts: own test files (*.server.e2e.ts), own build
 * (dist-server, built with the stack's address and public key) and own port, so the two kinds of
 * tests never share a build or a server. Without the stack's settings the tests are skipped with
 * a hint; with BACKEND_TESTS_REQUIRED=1 (CI) that is an error instead.
 */
import { defineConfig, devices } from '@playwright/test';
import { API_URL, CLIENT_KEY, missingMessage, missingSettings } from './e2e/serverEnv.ts';

const PORT = 4174;
const OUT_DIR = 'dist-server';

const missing = missingSettings();
if (missing.length > 0) {
  if (process.env['BACKEND_TESTS_REQUIRED'] === '1') throw new Error(missingMessage(missing));
  console.warn(`\n${missingMessage(missing)}\n`);
}

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.server.e2e.ts',
  outputDir: 'test-results-server',
  // A whole bot match plays in real time (several minutes with the software renderer).
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-server' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 412, height: 915 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 1,
      },
    },
  ],
  // Only started when the settings exist (otherwise every test skips itself).
  ...(missing.length > 0
    ? {}
    : {
        webServer: {
          command:
            `pnpm exec vite build --outDir ${OUT_DIR} --emptyOutDir && ` +
            `pnpm exec vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
          url: `http://127.0.0.1:${PORT}`,
          // Never reuse: the build has to carry the address and key of the stack that is running now.
          reuseExistingServer: false,
          timeout: 180_000,
          env: {
            VITE_SUPABASE_URL: API_URL ?? '',
            VITE_SUPABASE_PUBLISHABLE_KEY: CLIENT_KEY ?? '',
          },
        },
      }),
});
