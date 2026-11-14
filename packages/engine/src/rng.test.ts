import { describe, expect, it } from 'vitest';
import {
  nextInt,
  nextU32,
  seedRng,
  shuffle,
  STREAM_BATTLE,
  STREAM_MATCH,
  STREAM_OFFERS,
  STREAM_PLACEMENT,
} from './rng.ts';
import type { RngState } from './types.ts';

/** Independent reference: xoshiro128** written with BigInt, straight from the paper. */
function referenceXoshiro(seed: readonly number[]): () => number {
  const mask = 0xffffffffn;
  const s = seed.map((v) => BigInt(v));
  const rotl = (x: bigint, k: bigint): bigint => ((x << k) | (x >> (32n - k))) & mask;
  return () => {
    const [s0, s1, s2, s3] = s as [bigint, bigint, bigint, bigint];
    const result = (rotl((s1 * 5n) & mask, 7n) * 9n) & mask;
    const t = (s1 << 9n) & mask;
    const n2 = s2 ^ s0;
    const n3 = s3 ^ s1;
    s[1] = s1 ^ n2;
    s[0] = s0 ^ n3;
    s[2] = n2 ^ t;
    s[3] = rotl(n3, 11n);
    return Number(result);
  };
}

function popcount(x: number): number {
  let v = x >>> 0;
  let c = 0;
  while (v !== 0) {
    c += v & 1;
    v >>>= 1;
  }
  return c;
}

describe('xoshiro128**', () => {
  it('produces the published first values for state [1, 2, 3, 4]', () => {
    const rng: RngState = [1, 2, 3, 4];
    expect([nextU32(rng), nextU32(rng), nextU32(rng)]).toEqual([11520, 0, 5927040]);
  });

  it.each([
    [[1, 2, 3, 4]],
    [[0xffffffff, 0x80000000, 0x12345678, 0xdeadbeef]],
    [seedRng(0, STREAM_MATCH)],
    [seedRng(2 ** 53 - 1, STREAM_BATTLE)],
  ])('matches a BigInt reference for 2000 outputs from %j', (start) => {
    const rng: RngState = [start[0], start[1], start[2], start[3]] as RngState;
    const ref = referenceXoshiro(start);
    for (let i = 0; i < 2000; i++) expect(nextU32(rng)).toBe(ref());
  });

  it('returns unsigned 32-bit integers and keeps the state unsigned', () => {
    const rng = seedRng(123, STREAM_OFFERS);
    for (let i = 0; i < 5000; i++) {
      const v = nextU32(rng);
      expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff).toBe(true);
      for (const w of rng) expect(w >= 0 && w <= 0xffffffff && Number.isInteger(w)).toBe(true);
    }
  });
});

describe('seedRng', () => {
  it('is deterministic', () => {
    expect(seedRng(42, 3)).toEqual(seedRng(42, 3));
    const a = seedRng(987654321, STREAM_PLACEMENT);
    const b = seedRng(987654321, STREAM_PLACEMENT);
    for (let i = 0; i < 100; i++) expect(nextU32(a)).toBe(nextU32(b));
  });

  it('never yields the all-zero state', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (let stream = 0; stream < 6; stream++) {
        expect(seedRng(seed, stream).some((w) => w !== 0)).toBe(true);
      }
    }
  });

  it('exports four distinct stream constants', () => {
    expect([STREAM_MATCH, STREAM_OFFERS, STREAM_PLACEMENT, STREAM_BATTLE]).toEqual([1, 2, 3, 4]);
  });

  it('gives unrelated sequences for the streams of one seed', () => {
    for (const seed of [0, 1, 42, 2 ** 40 + 7]) {
      const streams = [STREAM_MATCH, STREAM_OFFERS, STREAM_PLACEMENT, STREAM_BATTLE].map((s) =>
        seedRng(seed, s),
      );
      const outputs = streams.map((r) => Array.from({ length: 200 }, () => nextU32(r)));
      for (let a = 0; a < outputs.length; a++) {
        for (let b = a + 1; b < outputs.length; b++) {
          const oa = outputs[a] as number[];
          const ob = outputs[b] as number[];
          // Average Hamming distance of independent words is 16 bits.
          let bits = 0;
          for (let i = 0; i < oa.length; i++)
            bits += popcount((oa[i] as number) ^ (ob[i] as number));
          const avg = bits / oa.length;
          expect(avg).toBeGreaterThan(15);
          expect(avg).toBeLessThan(17);
        }
      }
    }
  });

  it('gives different states for neighbouring seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 1000; seed++) seen.add(seedRng(seed, STREAM_MATCH).join(','));
    expect(seen.size).toBe(1000);
  });

  it('uses the high bits of seeds above 2^32', () => {
    for (const low of [0, 1, 12345, 0xffffffff]) {
      const base = seedRng(low, STREAM_OFFERS);
      for (const high of [1, 2, 0x1fffff]) {
        const big = seedRng(high * 2 ** 32 + low, STREAM_OFFERS);
        expect(big).not.toEqual(base);
      }
    }
    expect(seedRng(2 ** 53 - 1, 1)).not.toEqual(seedRng(2 ** 53 - 2, 1));
  });

  it.each([-1, 1.5, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY])('rejects seed %s', (seed) => {
    expect(() => seedRng(seed, 1)).toThrow(/seed/);
  });

  it.each([-1, 0.5, 2 ** 32])('rejects stream %s', (stream) => {
    expect(() => seedRng(1, stream)).toThrow(/stream/);
  });
});

describe('nextInt', () => {
  it('stays in [0, n)', () => {
    const rng = seedRng(7, STREAM_BATTLE);
    for (const n of [1, 2, 3, 7, 12, 1000, 2 ** 31 + 1, 2 ** 32]) {
      for (let i = 0; i < 500; i++) {
        const v = nextInt(rng, n);
        expect(Number.isInteger(v) && v >= 0 && v < n).toBe(true);
      }
    }
  });

  it('always returns 0 for n = 1', () => {
    const rng = seedRng(7, 1);
    for (let i = 0; i < 50; i++) expect(nextInt(rng, 1)).toBe(0);
  });

  it('is roughly uniform', () => {
    const rng = seedRng(2024, STREAM_OFFERS);
    const n = 6;
    const draws = 60000;
    const counts = new Array<number>(n).fill(0);
    for (let i = 0; i < draws; i++) {
      const v = nextInt(rng, n);
      counts[v] = (counts[v] as number) + 1;
    }
    for (const c of counts) {
      expect(c).toBeGreaterThan((draws / n) * 0.95);
      expect(c).toBeLessThan((draws / n) * 1.05);
    }
  });

  it('has no modulo bias (rejection sampling)', () => {
    // With n = 3 * 2^30 a plain modulo would hit [0, 2^30) twice as often (1/2 instead of 1/3).
    const n = 3 * 2 ** 30;
    const rng = seedRng(99, STREAM_MATCH);
    const draws = 30000;
    let low = 0;
    for (let i = 0; i < draws; i++) if (nextInt(rng, n) < 2 ** 30) low++;
    expect(low / draws).toBeGreaterThan(0.31);
    expect(low / draws).toBeLessThan(0.36);
  });

  it('consumes exactly one raw value when nothing is rejected', () => {
    const a = seedRng(5, 2);
    const b = seedRng(5, 2);
    nextInt(a, 4); // 2^32 is divisible by 4: never rejects
    nextU32(b);
    expect(a).toEqual(b);
  });

  it.each([0, -3, 1.5, 2 ** 32 + 1, Number.NaN])('rejects n = %s', (n) => {
    expect(() => nextInt(seedRng(1, 1), n)).toThrow(/nextInt/);
  });
});

describe('shuffle', () => {
  it('permutes in place and keeps all elements', () => {
    const rng = seedRng(11, STREAM_OFFERS);
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    shuffle(rng, arr);
    expect([...arr].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('is deterministic and uses length - 1 draws', () => {
    const a = seedRng(11, STREAM_OFFERS);
    const b = seedRng(11, STREAM_OFFERS);
    const x = ['a', 'b', 'c', 'd'];
    const y = ['a', 'b', 'c', 'd'];
    shuffle(a, x);
    shuffle(b, y);
    expect(x).toEqual(y);

    const c = seedRng(11, STREAM_OFFERS);
    nextInt(c, 4);
    nextInt(c, 3);
    nextInt(c, 2);
    expect(a).toEqual(c);
  });

  it('handles empty and single-element arrays without drawing', () => {
    const rng = seedRng(3, 3);
    const before = [...rng];
    const empty: number[] = [];
    const one = [1];
    shuffle(rng, empty);
    shuffle(rng, one);
    expect(empty).toEqual([]);
    expect(one).toEqual([1]);
    expect(rng).toEqual(before);
  });

  it('reaches every permutation of 3 elements about equally often', () => {
    const rng = seedRng(77, STREAM_PLACEMENT);
    const counts = new Map<string, number>();
    const draws = 24000;
    for (let i = 0; i < draws; i++) {
      const arr = [1, 2, 3];
      shuffle(rng, arr);
      const key = arr.join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const c of counts.values()) {
      expect(c).toBeGreaterThan((draws / 6) * 0.93);
      expect(c).toBeLessThan((draws / 6) * 1.07);
    }
  });
});
