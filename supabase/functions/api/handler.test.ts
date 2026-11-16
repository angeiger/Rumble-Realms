import assert from 'node:assert/strict';
import { createMemoryStore } from '../_shared/packages/shared/src/index.ts';
import type { ServerEnv, Store } from '../_shared/packages/shared/src/index.ts';
import { createApiHandler } from './handler.ts';
import type { ApiHandlerDeps } from './handler.ts';

const USER = '00000000-0000-4000-8000-0000000000aa';
const TOKEN = 'token-of-the-player';
const ENV: ServerEnv = { randInt: () => 0, now: () => 0 };

interface Setup {
  handle: (req: Request) => Promise<Response>;
  logs: string[];
  tokens: string[];
}

function setup(over: Partial<ApiHandlerDeps> = {}): Setup {
  const store = createMemoryStore();
  store.addUser(USER);
  const logs: string[] = [];
  const tokens: string[] = [];
  const handle = createApiHandler({
    authenticate: (token) => {
      tokens.push(token);
      return Promise.resolve(token === TOKEN ? USER : null);
    },
    store,
    env: ENV,
    logError: (m) => logs.push(m),
    ...over,
  });
  return { handle, logs, tokens };
}

function request(method: string, body?: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers['Authorization'] = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('http://localhost/functions/v1/api', init);
}

function assertCors(res: Response): void {
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
}

Deno.test('OPTIONS answers the preflight without a token', async () => {
  const { handle, tokens } = setup();
  const res = await handle(request('OPTIONS', undefined, null));
  assert.equal(res.status, 204);
  assertCors(res);
  assert.deepEqual(tokens, []);
});

Deno.test('other methods than POST give 405', async () => {
  const { handle } = setup();
  const res = await handle(request('GET'));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'POST, OPTIONS');
  assertCors(res);
  assert.deepEqual(await res.json(), { ok: false, error: { code: 'bad_request' } });
});

Deno.test('a missing or rejected token gives 401 with CORS headers', async () => {
  const { handle, tokens } = setup();
  for (const token of [null, 'wrong']) {
    const res = await handle(request('POST', { action: 'set_username', username: 'abc' }, token));
    assert.equal(res.status, 401);
    assertCors(res);
    assert.deepEqual(await res.json(), { ok: false, error: { code: 'unauthorized' } });
  }
  assert.deepEqual(tokens, ['wrong']);
});

Deno.test('a body that is not a valid call gives bad_request with status 200', async () => {
  const { handle } = setup();
  for (const body of ['not json', { action: 'unknown' }, 'x'.repeat(20_000)]) {
    const res = await handle(request('POST', body));
    assert.equal(res.status, 200);
    assertCors(res);
    assert.deepEqual(await res.json(), { ok: false, error: { code: 'bad_request' } });
  }
});

Deno.test('a valid call runs the action for the authenticated account', async () => {
  const { handle } = setup();
  const res = await handle(request('POST', { action: 'set_username', username: 'Hero_1' }));
  assert.equal(res.status, 200);
  assertCors(res);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.username, 'Hero_1');
  assert.equal(typeof body.data.welcomePackId, 'string');

  const again = await handle(request('POST', { action: 'set_username', username: 'ab' }));
  assert.deepEqual(await again.json(), { ok: false, error: { code: 'username_invalid' } });
});

Deno.test('an exception gives 500 and a log line without the token', async () => {
  const store = createMemoryStore();
  store.addUser(USER);
  const broken: Store = {
    ...store,
    getProfile: () => Promise.reject(new Error('connection reset')),
    getCards: () => Promise.reject(new Error('connection reset')),
  };
  const { handle, logs } = setup({ store: broken });
  const res = await handle(request('POST', { action: 'set_deck', cards: ['archer'] }));
  assert.equal(res.status, 500);
  assertCors(res);
  assert.deepEqual(await res.json(), { ok: false, error: { code: 'internal' } });
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? '', new RegExp(`user ${USER}, action set_deck.*connection reset`));
  assert.ok(!(logs[0] ?? '').includes(TOKEN));
});

Deno.test('a failing token check gives 500, not 401', async () => {
  const { handle, logs } = setup({
    authenticate: () => Promise.reject(new Error('auth server down')),
  });
  const res = await handle(request('POST', { action: 'set_username', username: 'abc' }));
  assert.equal(res.status, 500);
  assert.match(logs[0] ?? '', /user -, action \?.*auth server down/);
});

Deno.test('an unexpected store code (internal) is answered with 500', async () => {
  const store = createMemoryStore();
  store.addUser(USER);
  const odd: Store = { ...store, setUsername: () => Promise.resolve({ ok: false, code: 'stale' }) };
  const { handle, logs } = setup({ store: odd });
  const res = await handle(request('POST', { action: 'set_username', username: 'abc' }));
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error.code, 'internal');
  assert.match(logs[0] ?? '', /set_username: unexpected store error stale/);
});
