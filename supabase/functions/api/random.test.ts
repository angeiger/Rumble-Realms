import assert from 'node:assert/strict';
import { createRandInt } from './random.ts';

/** A source that returns the given 32-bit values in order. */
function scripted(values: number[]): { fill: (a: Uint32Array) => void; used: () => number } {
  let i = 0;
  return {
    fill(a) {
      const v = values[i++];
      if (v === undefined) throw new Error('scripted source exhausted');
      a[0] = v;
    },
    used: () => i,
  };
}

Deno.test('randInt maps 32-bit values without modulo bias', () => {
  // n = 3: 2^32 % 3 = 1, so 2^32 - 1 is the only rejected value.
  const src = scripted([0xffffffff, 7, 0xfffffffe]);
  const randInt = createRandInt(src.fill);
  assert.equal(randInt(3), 7 % 3);
  assert.equal(src.used(), 2);
  assert.equal(randInt(3), 0xfffffffe % 3);
});

Deno.test('randInt(1) is always 0 and randInt(2^32) returns the raw value', () => {
  const src = scripted([123, 0xffffffff]);
  const randInt = createRandInt(src.fill);
  assert.equal(randInt(1), 0);
  assert.equal(randInt(2 ** 32), 0xffffffff);
});

Deno.test('randInt rejects values of n outside 1..2^32', () => {
  const randInt = createRandInt(scripted([]).fill);
  for (const n of [0, -1, 1.5, 2 ** 32 + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => randInt(n), RangeError, String(n));
  }
});

Deno.test('randInt with Web Crypto stays in range and covers every value', () => {
  const randInt = createRandInt();
  const seen = new Set<number>();
  for (let i = 0; i < 2000; i++) {
    const x = randInt(6);
    assert.ok(Number.isInteger(x) && x >= 0 && x < 6);
    seen.add(x);
  }
  assert.equal(seen.size, 6);
  const big = randInt(2 ** 21);
  assert.ok(big >= 0 && big < 2 ** 21);
});
