/**
 * Secure random integers for the server (`ServerEnv.randInt`): seeds, bot profiles, packs.
 */

const TWO_POW_32 = 2 ** 32;

/** Fills the array with secure random values (default: Web Crypto). */
export type FillRandom = (array: Uint32Array) => void;

const webCrypto: FillRandom = (array) => {
  crypto.getRandomValues(array);
};

/**
 * `randInt(n)`: a uniform integer in 0..n-1 for every integer n in 1..2^32. Rejection sampling
 * on 32-bit values, so there is no modulo bias. Throws on any other n.
 */
export function createRandInt(fill: FillRandom = webCrypto): (n: number) => number {
  const buffer = new Uint32Array(1);
  const next = (): number => {
    fill(buffer);
    return buffer[0] as number;
  };
  return (n: number): number => {
    if (!Number.isInteger(n) || n < 1 || n > TWO_POW_32) {
      throw new RangeError(`randInt: n must be an integer in 1..2^32, got ${n}`);
    }
    if (n === TWO_POW_32) return next();
    // The largest multiple of n not above 2^32; values from there on would favour small results.
    const limit = TWO_POW_32 - (TWO_POW_32 % n);
    for (;;) {
      const x = next();
      if (x < limit) return x % n;
    }
  };
}
