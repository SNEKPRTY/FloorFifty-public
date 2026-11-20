/**
 * Deterministic pseudo-random numbers.
 *
 * The generator is local and integer-based rather than `Math.random`, because
 * the server and a later browser-side host must produce byte-identical courses
 * from the same seed.
 *
 * The algorithm is SplitMix32: a 32-bit counter advanced by the golden-ratio
 * increment `0x9e3779b9`, then avalanched with two xor-shift/multiply rounds.
 * It is chosen for having no warm-up requirement, so a stream seeded from a
 * single floor index is as well-distributed as one read sequentially.
 */

const GOLDEN_GAMMA = 0x9e3779b9;
const MIX_A = 0x85ebca6b;
const MIX_B = 0xc2b2ae35;
const UINT32_SPAN = 0x100000000;

/** Avalanches a 32-bit state into a well-distributed 32-bit output. */
function mix(state: number): number {
  let value = state;
  value ^= value >>> 16;
  value = Math.imul(value, MIX_A);
  value ^= value >>> 13;
  value = Math.imul(value, MIX_B);
  value ^= value >>> 16;
  return value >>> 0;
}

/**
 * Derives an independent seed from a base seed and a salt.
 *
 * The course generator uses the floor index as the salt so that each floor is
 * a function of its own index alone. That is what makes the first `n` floors of
 * a tall course identical to a course of exactly `n` floors.
 */
export function deriveSeed(seed: number, salt: number): number {
  return mix((seed ^ Math.imul(salt + 1, GOLDEN_GAMMA)) >>> 0);
}

export type Rng = {
  /** Next raw 32-bit value. */
  nextUint32(): number;
  /** Next value in `[0, 1)`. */
  nextFloat(): number;
  /** Next integer in the inclusive range `[min, max]`. */
  nextInt(min: number, max: number): number;
  /** Next value in the half-open range `[min, max)`. */
  nextRange(min: number, max: number): number;
};

/** Creates an independent stream from a 32-bit seed. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const nextUint32 = (): number => {
    state = (state + GOLDEN_GAMMA) >>> 0;
    return mix(state);
  };
  const nextFloat = (): number => nextUint32() / UINT32_SPAN;

  return {
    nextUint32,
    nextFloat,
    nextInt: (min, max) => min + Math.floor(nextFloat() * (max - min + 1)),
    nextRange: (min, max) => min + nextFloat() * (max - min),
  };
}
