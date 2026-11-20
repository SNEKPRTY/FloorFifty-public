/**
 * The four CPU racers (CPU players spec §4).
 *
 * One per seat colour, one shared strength, four styles. The numbers are
 * tuning, never rules: only the server reads them, the replay records what
 * the CPUs sent rather than how they decided, and no revision moves when they
 * change. `tests/shared/cpu/strength.test.ts` holds every personality inside
 * `CPU_MEDIAN_BAND_SECONDS`.
 */

import type { SeatColour } from "../common/seats";

/** The knobs a mood may move (CPU banding spec §3). */
export type BandKnobs = Partial<
  Pick<Personality, "reactionTicks" | "linedUpFraction" | "eagerDrop" | "slipChance" | "slipTicks" | "movingFloorPause" | "leadEase" | "easeTicks">
>;

export type Personality = {
  /** Shown on the seat, the HUD and the results. A proper noun, never translated. */
  readonly name: string;
  /** Ticks between deciding and acting: a frame decided now is held this many ticks later. */
  readonly reactionTicks: number;
  /** `steerPlayer`'s lined-up fraction: higher drops earlier and sloppier. */
  readonly linedUpFraction: number;
  /** Chance, per tick above its target and not yet lined up, of fast-falling anyway: committing early. */
  readonly eagerDrop: number;
  /** Ticks with no new floor before it resets the ascent. */
  readonly stallTicks: number;
  /** Chance, per new target floor, of fumbling the approach (steering the wrong way). */
  readonly slipChance: number;
  /** How long a fumble lasts, in ticks. */
  readonly slipTicks: number;
  /** Ticks it hangs back, hands off, when its new target is a moving floor; 0 never. */
  readonly movingFloorPause: number;
  /** Chance, per new target floor while it leads every other racer, of easing off. */
  readonly leadEase: number;
  /** How long it eases off, in ticks. */
  readonly easeTicks: number;
  /**
   * How it bands toward the best-placed person (CPU banding spec §3): the
   * knobs it drives with while cruising ahead, and while pushing from behind.
   * Reaction stays at 12 ticks or fewer, the range measured stable.
   */
  readonly bands: { readonly cruising: BandKnobs; readonly pushing: BandKnobs };
};

export const PERSONALITIES: Readonly<Record<SeatColour, Personality>> = {
  // The rusher: commits to drops early and quick hands; misses and resets more than the rest.
  scarlet: { name: "Blaze", reactionTicks: 8, linedUpFraction: 1, eagerDrop: 0.05, stallTicks: 540, slipChance: 0.1, slipTicks: 14, movingFloorPause: 0, leadEase: 0, easeTicks: 0,
    // Ahead, it eases off a little; behind, it gets reckless.
    bands: { cruising: { leadEase: 0.85, easeTicks: 55 }, pushing: { reactionTicks: 6, eagerDrop: 0, slipChance: 0.07 } } },
  // The steady one: lines up carefully, rarely errs, never quickest on a floor.
  cyan: { name: "Koi", reactionTicks: 9, linedUpFraction: 0.65, eagerDrop: 0, stallTicks: 900, slipChance: 0.02, slipTicks: 10, movingFloorPause: 0, leadEase: 0, easeTicks: 0,
    // The benchmark: barely eases, barely tightens.
    bands: { cruising: { leadEase: 0.1, easeTicks: 12 }, pushing: { reactionTicks: 8 } } },
  // The showboat: plays well, then eases off while it leads.
  gold: { name: "Sunny", reactionTicks: 9, linedUpFraction: 0.8, eagerDrop: 0, stallTicks: 720, slipChance: 0.1, slipTicks: 12, movingFloorPause: 0, leadEase: 0.6, easeTicks: 30,
    // Ahead, it showboats: eases off often and long. Behind, it tightens.
    bands: { cruising: { leadEase: 1, easeTicks: 70 }, pushing: { reactionTicks: 7, slipChance: 0.05 } } },
  // The nervous one: hangs back from moving floors, resets early when stuck.
  violet: { name: "Moth", reactionTicks: 8, linedUpFraction: 0.8, eagerDrop: 0, stallTicks: 480, slipChance: 0.05, slipTicks: 10, movingFloorPause: 14, leadEase: 0, easeTicks: 0,
    // Ahead, it eases off; behind, it panics: the fastest hands, and more slips.
    bands: { cruising: { leadEase: 0.7, easeTicks: 45 }, pushing: { reactionTicks: 5, slipChance: 0.12, movingFloorPause: 6 } } },
};

/**
 * Where every personality's median solo 20-floor finish must fall, in seconds.
 * The reference controller's median is 15.9 s; a decent human's is slower.
 * Moved to the owner's own playtest times at the gate (plan Task 9).
 */
export const CPU_MEDIAN_BAND_SECONDS = { min: 18, max: 26 } as const;
