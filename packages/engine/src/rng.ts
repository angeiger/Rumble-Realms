/**
 * Seeded random numbers: xoshiro128** on a plain `RngState` (SPEC 6.1, D-029).
 *
 * All arithmetic is 32-bit integer arithmetic (`Math.imul`, shifts, `>>> 0`), so every
 * device produces the same sequence. The state is a plain array and can be stored or hashed.
 */
import type { RngState } from './types.ts';

/** Coin flips (who starts a round). */
export const STREAM_MATCH = 1;
/** Card offers during the draft. */
export const STREAM_OFFERS = 2;
/** Center column of a placed card. */
export const STREAM_PLACEMENT = 3;
/** Random decisions inside the battle simulation. */
export const STREAM_BATTLE = 4;

const TWO_POW_32 = 4294967296;
const GOLDEN = 0x9e3779b9;

/** murmur3 finaliser: a bijective 32-bit mixer with good avalanche. */
function fmix32(value: number): number {
  let h = value | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Derives a generator state from a match seed and a stream number.
 * `seed`: non-negative safe integer (up to 2^53 - 1), `stream`: integer 0..2^32 - 1.
 * Every state word depends on all bits of seed and stream; for fixed (hi, stream) each word
 * is a bijection of the low seed word, so distinct seeds never collide word by word.
 */
export function seedRng(seed: number, stream: number): RngState {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error(`seedRng: seed must be a non-negative safe integer, got ${seed}`);
  }
  if (!Number.isInteger(stream) || stream < 0 || stream >= TWO_POW_32) {
    throw new Error(`seedRng: stream must be an integer 0..2^32-1, got ${stream}`);
  }
  const lo = seed >>> 0;
  const hi = Math.floor(seed / TWO_POW_32) >>> 0;
  const state: RngState = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    let h = fmix32((lo + Math.imul(i + 1, GOLDEN)) | 0);
    h = fmix32(h ^ hi ^ Math.imul(i + 1, 0x7f4a7c15));
    h = fmix32((h + Math.imul(stream ^ 0x5bd1e995, 0x27d4eb2f) + i) | 0);
    state[i] = h;
  }
  // xoshiro must never start from the all-zero state (it would stay there forever).
  if (state[0] === 0 && state[1] === 0 && state[2] === 0 && state[3] === 0) state[0] = 1;
  return state;
}

/** Next unsigned 32-bit value; advances `rng` in place. */
export function nextU32(rng: RngState): number {
  const s0 = rng[0];
  const s1 = rng[1];
  let s2 = rng[2];
  let s3 = rng[3];

  const m = Math.imul(s1, 5);
  const result = Math.imul((m << 7) | (m >>> 25), 9) >>> 0;

  const t = s1 << 9;
  s2 ^= s0;
  s3 ^= s1;
  const n1 = s1 ^ s2;
  const n0 = s0 ^ s3;
  s2 ^= t;
  s3 = (s3 << 11) | (s3 >>> 21);

  rng[0] = n0 >>> 0;
  rng[1] = n1 >>> 0;
  rng[2] = s2 >>> 0;
  rng[3] = s3 >>> 0;
  return result;
}

/**
 * Uniform integer in [0, n) for an integer 1 <= n <= 2^32, without modulo bias:
 * raw values from the incomplete last block are rejected and redrawn.
 */
export function nextInt(rng: RngState, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > TWO_POW_32) {
    throw new Error(`nextInt: n must be an integer 1..2^32, got ${n}`);
  }
  const limit = TWO_POW_32 - (TWO_POW_32 % n);
  let x = nextU32(rng);
  while (x >= limit) x = nextU32(rng);
  return x % n;
}

/** Fisher-Yates shuffle in place. Always uses `arr.length - 1` calls of `nextInt`. */
export function shuffle<T>(rng: RngState, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
}
