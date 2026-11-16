/**
 * Runs once before the backend tests: says clearly when they are skipped. In CI
 * (BACKEND_TESTS_REQUIRED=1) missing settings are an error instead, so the job cannot pass by
 * skipping everything.
 */
import { missingSettings } from './env.ts';

export default function setup(): void {
  const missing = missingSettings();
  if (missing.length === 0) return;
  const message =
    `Backend tests SKIPPED: ${missing.join(', ')} not set. Start the local stack and load its ` +
    'settings first:\n  bash supabase/tests/stack.sh up\n  eval "$(bash supabase/tests/stack.sh env)"';
  if (process.env.BACKEND_TESTS_REQUIRED === '1') throw new Error(message);
  console.warn(`\n${message}\n`);
}
