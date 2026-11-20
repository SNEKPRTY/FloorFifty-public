/**
 * The roulette's randomness (stage, song and character select spec §5.3).
 *
 * One generator per room, round and step, derived from the room seed, so the
 * same seed, round and picks always resolve the same way, and a replay reads
 * the result rather than re-running the draw.
 */

import { createRng, deriveSeed, type Rng } from "../level/rng";

export const ROULETTE_STEP = { character: 1, stage: 2, song: 3 } as const;

export function rouletteRng(roomSeed: number, round: number, step: keyof typeof ROULETTE_STEP): Rng {
  return createRng(deriveSeed(deriveSeed(roomSeed, round), ROULETTE_STEP[step]));
}

/** One item, uniformly. Throws on an empty list: a caller always has at least one. */
export function drawUniform<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("the roulette has nothing to draw from");
  return items[rng.nextInt(0, items.length - 1)]!;
}
