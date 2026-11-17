/**
 * Deterministic hash of JSON-like engine state (SPEC 6.1, 12).
 *
 * The value is walked recursively and fed word by word into two independent 32-bit hashes
 * (no intermediate string). Object keys are visited in sorted order, so insertion order does
 * not matter; array order and value types do. Every value is prefixed with a type tag and
 * containers with their length, so the encoding is unambiguous.
 *
 * Non-integers, numbers beyond +-2^53, `undefined`, functions, symbols, bigints and
 * non-plain objects (Map, Set, class instances) throw: they point to a determinism bug.
 */

const TAG_NULL = 1;
const TAG_FALSE = 2;
const TAG_TRUE = 3;
const TAG_INT32 = 4;
const TAG_INT53 = 5;
const TAG_STRING = 6;
const TAG_ARRAY = 7;
const TAG_OBJECT = 8;

const TWO_POW_32 = 4294967296;
const MAX_ABS = 9007199254740992; // 2^53

// Running hash state. hashState is synchronous and resets these on every call.
let h1 = 0;
let h2 = 0;

function feed(word: number): void {
  // h1: murmur3 block step.
  let k = Math.imul(word, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h1 ^= k;
  h1 = (h1 << 13) | (h1 >>> 19);
  h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  // h2: different multiplier, seed and shifts (xor-multiply-xorshift).
  h2 = Math.imul(h2 ^ word, 0x2c1b3c6d);
  h2 ^= h2 >>> 15;
  h2 = (h2 + 0x297a2d39) | 0;
}

function fmix32(value: number): number {
  let h = value;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function feedString(s: string): void {
  const len = s.length;
  feed(TAG_STRING);
  feed(len);
  let i = 0;
  for (; i + 1 < len; i += 2) feed(s.charCodeAt(i) | (s.charCodeAt(i + 1) << 16));
  if (i < len) feed(s.charCodeAt(i));
}

/** Thrown inside the walk; containers prepend their key while it bubbles up. */
class HashPathError extends Error {
  path = '';
}

function fail(message: string): never {
  throw new HashPathError(message);
}

function rethrow(err: unknown, step: string): never {
  if (err instanceof HashPathError) err.path = step + err.path;
  throw err;
}

function feedValue(value: unknown): void {
  switch (typeof value) {
    case 'number': {
      if (!Number.isInteger(value) || value > MAX_ABS || value < -MAX_ABS) {
        fail(`non-integer number ${value}`);
      }
      if ((value | 0) === value) {
        feed(TAG_INT32);
        feed(value);
      } else {
        const hi = Math.floor(value / TWO_POW_32);
        feed(TAG_INT53);
        feed(value - hi * TWO_POW_32);
        feed(hi);
      }
      return;
    }
    case 'string':
      feedString(value);
      return;
    case 'boolean':
      feed(value ? TAG_TRUE : TAG_FALSE);
      return;
    case 'object': {
      if (value === null) {
        feed(TAG_NULL);
        return;
      }
      if (Array.isArray(value)) {
        const arr = value as unknown[];
        const len = arr.length;
        feed(TAG_ARRAY);
        feed(len);
        let i = 0;
        try {
          for (; i < len; i++) feedValue(arr[i]);
        } catch (err) {
          rethrow(err, `[${i}]`);
        }
        return;
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        fail('non-plain object (Map, Set or class instance)');
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      feed(TAG_OBJECT);
      feed(keys.length);
      let key = '';
      try {
        for (key of keys) {
          feedString(key);
          feedValue(obj[key]);
        }
      } catch (err) {
        rethrow(err, `.${key}`);
      }
      return;
    }
    default:
      fail(`unsupported value of type ${typeof value}`);
  }
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/** 16 hex characters identifying `state` (two independent 32-bit hashes). */
export function hashState(state: unknown): string {
  h1 = 0x3c6ef372;
  h2 = 0x6a09e667;
  try {
    feedValue(state);
  } catch (err) {
    if (err instanceof HashPathError) {
      throw new Error(`hashState: ${err.message} at ${err.path === '' ? 'root' : err.path}`, {
        cause: err,
      });
    }
    throw err;
  }
  return hex8(fmix32(h1)) + hex8(fmix32(h2));
}
