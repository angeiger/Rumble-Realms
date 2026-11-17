import assert from 'node:assert/strict';
import { configFrom, secretKeyFrom } from './config.ts';

function envOf(values: Record<string, string>): (name: string) => string | undefined {
  return (name) => values[name];
}

Deno.test('secretKeyFrom prefers the default entry of SUPABASE_SECRET_KEYS', () => {
  const get = envOf({
    SUPABASE_SECRET_KEYS: JSON.stringify({ other: 'k-other', default: 'k-default' }),
    SUPABASE_SERVICE_ROLE_KEY: 'k-legacy',
  });
  assert.equal(secretKeyFrom(get), 'k-default');
});

Deno.test('secretKeyFrom takes the first entry without a default', () => {
  const get = envOf({ SUPABASE_SECRET_KEYS: JSON.stringify({ ci: 'k-ci', b: 'k-b' }) });
  assert.equal(secretKeyFrom(get), 'k-ci');
});

Deno.test('secretKeyFrom falls back to the legacy service role key', () => {
  assert.equal(secretKeyFrom(envOf({ SUPABASE_SERVICE_ROLE_KEY: 'k-legacy' })), 'k-legacy');
  for (const keys of ['not json', '[]', '{}', '{"default":""}', '{"default":3}', '']) {
    const get = envOf({ SUPABASE_SECRET_KEYS: keys, SUPABASE_SERVICE_ROLE_KEY: 'k-legacy' });
    assert.equal(secretKeyFrom(get), 'k-legacy', keys);
  }
  assert.equal(secretKeyFrom(envOf({})), null);
  assert.equal(secretKeyFrom(envOf({ SUPABASE_SERVICE_ROLE_KEY: '' })), null);
});

Deno.test('configFrom needs the URL and a key and never prints a value', () => {
  assert.deepEqual(
    configFrom(envOf({ SUPABASE_URL: 'http://kong:8000', SUPABASE_SERVICE_ROLE_KEY: 'k' })),
    { url: 'http://kong:8000', secretKey: 'k' },
  );
  assert.throws(() => configFrom(envOf({ SUPABASE_SERVICE_ROLE_KEY: 'k' })), /SUPABASE_URL/);
  assert.throws(
    () => configFrom(envOf({ SUPABASE_URL: 'http://kong:8000' })),
    (e: Error) => /SUPABASE_SECRET_KEYS/.test(e.message) && !e.message.includes('kong'),
  );
});
