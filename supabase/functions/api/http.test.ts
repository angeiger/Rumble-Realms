import assert from 'node:assert/strict';
import {
  bearerToken,
  CORS_HEADERS,
  jsonResponse,
  MAX_BODY_BYTES,
  preflightResponse,
  readJsonBody,
} from './http.ts';

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api', { method: 'POST', body, headers });
}

function assertCors(res: Response): void {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    assert.equal(res.headers.get(name), value, name);
  }
}

Deno.test('CORS headers name the methods and the headers of supabase-js', () => {
  assert.equal(CORS_HEADERS['Access-Control-Allow-Origin'], '*');
  assert.equal(CORS_HEADERS['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  assert.equal(
    CORS_HEADERS['Access-Control-Allow-Headers'],
    'authorization, x-client-info, apikey, content-type',
  );
});

Deno.test('jsonResponse sends JSON with CORS headers and keeps extra headers', async () => {
  const res = jsonResponse(405, { ok: false }, { Allow: 'POST, OPTIONS' });
  assert.equal(res.status, 405);
  assertCors(res);
  assert.equal(res.headers.get('Allow'), 'POST, OPTIONS');
  assert.match(res.headers.get('Content-Type') ?? '', /^application\/json/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), { ok: false });
});

Deno.test('preflightResponse is an empty 204 with CORS headers', async () => {
  const res = preflightResponse();
  assert.equal(res.status, 204);
  assertCors(res);
  assert.equal(await res.text(), '');
});

Deno.test('bearerToken reads the token of the Authorization header', () => {
  assert.equal(bearerToken(post(null, { Authorization: 'Bearer abc.def' })), 'abc.def');
  assert.equal(bearerToken(post(null, { Authorization: 'bearer   xyz ' })), 'xyz');
  assert.equal(bearerToken(post(null)), null);
  assert.equal(bearerToken(post(null, { Authorization: 'Basic abc' })), null);
  assert.equal(bearerToken(post(null, { Authorization: 'Bearer' })), null);
  assert.equal(bearerToken(post(null, { Authorization: 'Bearer a b' })), null);
});

Deno.test('readJsonBody parses JSON up to the limit', async () => {
  assert.deepEqual(await readJsonBody(post('{"action":"x"}')), {
    ok: true,
    value: { action: 'x' },
  });
  const exact = JSON.stringify('a'.repeat(MAX_BODY_BYTES - 2));
  assert.equal(exact.length, MAX_BODY_BYTES);
  assert.equal((await readJsonBody(post(exact))).ok, true);
});

Deno.test('readJsonBody rejects large, empty, broken and non-UTF-8 bodies', async () => {
  const tooLarge = JSON.stringify('a'.repeat(MAX_BODY_BYTES));
  assert.deepEqual(await readJsonBody(post(tooLarge)), { ok: false });
  assert.deepEqual(await readJsonBody(post('{}', { 'Content-Length': '999999' })), { ok: false });
  assert.deepEqual(await readJsonBody(post(null)), { ok: false });
  assert.deepEqual(await readJsonBody(post('')), { ok: false });
  assert.deepEqual(await readJsonBody(post('{"a":')), { ok: false });
  assert.deepEqual(await readJsonBody(post(new Uint8Array([0x22, 0xff, 0x22]))), { ok: false });
});

Deno.test('readJsonBody stops a stream without Content-Length at the limit', async () => {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(4096).fill(0x20));
    },
  });
  const res = await readJsonBody(post(stream), 10_000);
  assert.deepEqual(res, { ok: false });
  assert.ok(pulled <= 4, `read ${pulled} chunks`);
});
