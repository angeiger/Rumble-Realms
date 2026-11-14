import { describe, expect, it } from 'vitest';
import { cloneState, createBattle, spawnUnit } from './battle/state.ts';
import { hashState } from './hash.ts';
import { seedRng } from './rng.ts';

describe('hashState', () => {
  it('returns 16 lowercase hex characters', () => {
    for (const v of [null, 0, '', [], {}, { a: [1, 'x', true] }]) {
      expect(hashState(v)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('is deterministic', () => {
    const v = { a: [1, 2, { b: 'c' }], d: null, e: false, f: -12345678901 };
    expect(hashState(v)).toBe(hashState(v));
    expect(hashState(v)).toBe(hashState(cloneState(v)));
  });

  it('ignores the insertion order of object keys', () => {
    expect(hashState({ a: 1, b: 2, c: { x: 1, y: 2 } })).toBe(
      hashState({ c: { y: 2, x: 1 }, b: 2, a: 1 }),
    );
  });

  it('depends on array order', () => {
    expect(hashState([1, 2])).not.toBe(hashState([2, 1]));
    expect(hashState(['a', 'b'])).not.toBe(hashState(['b', 'a']));
  });

  it('distinguishes types and structures', () => {
    const values: unknown[] = [
      1,
      '1',
      true,
      false,
      0,
      '',
      null,
      [],
      {},
      [null],
      [[]],
      [{}],
      { a: 1 },
      { a: '1' },
      { a: true },
      { b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 1 },
      { ab: 1 },
      { a: 'b1' },
      [[1], [2]],
      [[1, 2]],
      [1, 2],
      [[1], 2],
      [1, [2]],
      'a',
      'a\0',
      'ab',
      'ba',
      ['a', 'b'],
      ['ab'],
      2 ** 32,
      2 ** 32 + 1,
      -1,
      0xffffffff,
      2 ** 53,
      -(2 ** 53),
      2 ** 53 - 1,
    ];
    const hashes = values.map((v) => hashState(v));
    expect(new Set(hashes).size).toBe(values.length);
  });

  it('treats -0 like 0 (JSON has no negative zero)', () => {
    expect(hashState(-0)).toBe(hashState(0));
  });

  it('handles non-ASCII strings', () => {
    expect(hashState('Größe')).toBe(hashState('Größe'));
    expect(hashState('Größe')).not.toBe(hashState('Grösse'));
    expect(hashState('🙂')).not.toBe(hashState('🙃'));
  });

  it('has no collisions on many small values', () => {
    const seen = new Set<string>();
    for (let i = -5000; i < 5000; i++) seen.add(hashState(i));
    for (let i = 0; i < 5000; i++) seen.add(hashState({ id: i, hp: 100 }));
    for (let i = 0; i < 5000; i++) seen.add(hashState([i, i + 1]));
    expect(seen.size).toBe(20000);
  });

  it('changes when a single unit of a battle changes', () => {
    const b = createBattle(seedRng(1, 4));
    spawnUnit(b, 0, 'knight', 1, 3, 10);
    spawnUnit(b, 1, 'archer', 2, 5, 20);
    const before = hashState(b);
    const copy = cloneState(b);
    expect(hashState(copy)).toBe(before);
    (copy.units[1] as { hp: number }).hp -= 1;
    expect(hashState(copy)).not.toBe(before);
  });

  it.each([
    [1.5, /non-integer number 1\.5 at root/],
    [Number.NaN, /non-integer/],
    [Number.POSITIVE_INFINITY, /non-integer/],
    [2 ** 53 + 2, /non-integer/],
    [undefined, /undefined at root/],
    [{ a: { b: [1, 0.25] } }, /at \.a\.b\[1\]/],
    [{ a: undefined }, /undefined at \.a/],
    [[1, undefined], /undefined at \[1\]/],
    [() => 1, /function/],
    [10n, /bigint/],
    [Symbol('s'), /symbol/],
    [new Map(), /non-plain object/],
    [{ s: new Set([1]) }, /non-plain object .* at \.s$/],
  ])('rejects %s', (value, message) => {
    expect(() => hashState(value)).toThrow(message);
  });

  it('accepts objects without prototype', () => {
    const o = Object.create(null) as Record<string, number>;
    o.a = 1;
    expect(hashState(o)).toBe(hashState({ a: 1 }));
  });

  it('recovers after an error', () => {
    const h = hashState({ a: 1 });
    expect(() => hashState({ a: 0.5 })).toThrow();
    expect(hashState({ a: 1 })).toBe(h);
  });
});
