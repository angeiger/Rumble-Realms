/**
 * HTTP behaviour of the function as a browser sees it: CORS on every answer (the Supabase
 * gateway adds none since CLI 3.1), methods, body limit, and two measurements (printed only).
 */
import { ENGINE_VERSION } from '@rumble-realms/engine';
import { describe, expect, it } from 'vitest';
import { CONFIGURED } from './env.ts';
import { call, functionUrl, namedGuest, ok, playMatch, raw } from './helpers.ts';

function expectCors(headers: Headers): void {
  expect(headers.get('access-control-allow-origin')).toBe('*');
  expect(headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
  expect(headers.get('access-control-allow-headers')).toBe(
    'authorization, x-client-info, apikey, content-type',
  );
}

describe.skipIf(!CONFIGURED)('HTTP and CORS', () => {
  it('lets a browser preflight pass (gateway or function)', async () => {
    // Locally the gateway (Kong) answers a preflight with an Origin header itself (200); on
    // the hosted platform the function may get it. Either way the browser must be allowed.
    const res = await fetch(functionUrl(), {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, apikey, content-type, x-client-info',
      },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    for (const h of ['authorization', 'apikey', 'content-type', 'x-client-info']) {
      expect(allowed).toContain(h);
    }
  });

  it('answers a preflight that reaches it with 204 and its CORS headers', async () => {
    const res = await raw({ method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expectCors(res.headers);
  });

  it('sends the CORS headers with errors too', async () => {
    const unauthorized = await raw({ token: null, body: '{}' });
    expect(unauthorized.status).toBe(401);
    expectCors(unauthorized.headers);

    const p = await namedGuest();
    const get = await raw({ method: 'GET', token: p.token });
    expect(get.status).toBe(405);
    expectCors(get.headers);

    const broken = await raw({ token: p.token, body: '{"action":' });
    expect(broken.status).toBe(200);
    expect(broken.body).toEqual({ ok: false, error: { code: 'bad_request' } });
    expectCors(broken.headers);

    const big = await raw({
      token: p.token,
      body: JSON.stringify({ action: 'set_username', username: 'x'.repeat(20_000) }),
    });
    expect(big.body).toEqual({ ok: false, error: { code: 'bad_request' } });
    expectCors(big.headers);

    const domain = await call(p, 'open_pack', { packId: '00000000-0000-4000-8000-000000000000' });
    expect(domain.body).toEqual({ ok: false, error: { code: 'pack_not_found' } });
  });
});

describe.skipIf(!CONFIGURED)('measurements (printed, no limit)', () => {
  it('times a preflight, small calls and report_match of a hard match', async () => {
    const first = await raw({ method: 'OPTIONS' });
    const p = await namedGuest();
    const small: number[] = [];
    for (let i = 0; i < 5; i++) {
      small.push(
        (await call(p, 'set_deck', { cards: ['archer', 'knight', 'skeleton', 'bat'] })).ms,
      );
    }

    const { ticket } = await ok(p, 'create_match', {
      botLevel: 'hard',
      engineVersion: ENGINE_VERSION,
    });
    const t0 = performance.now();
    const played = playMatch(ticket, 1);
    const playMs = performance.now() - t0;
    const report = await call(p, 'report_match', { matchId: ticket.matchId, picks: played.picks });
    expect(report.status).toBe(200);
    expect(report.body.ok, JSON.stringify(report.body)).toBe(true);

    const median = [...small].sort((a, b) => a - b)[2] ?? 0;
    console.log(
      [
        'Measurements (local stack):',
        `  first request of this file (OPTIONS, cold if the worker was new): ${first.ms.toFixed(0)} ms`,
        `  set_deck, median of 5 warm calls: ${median.toFixed(0)} ms`,
        `  hard match played locally (client side): ${playMs.toFixed(0)} ms, ${played.picks.length} picks`,
        `  report_match of the hard match (answer time): ${report.ms.toFixed(0)} ms`,
      ].join('\n'),
    );
  });
});
