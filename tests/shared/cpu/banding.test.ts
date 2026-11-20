/**
 * Banding (CPU banding spec §3): a CPU stretches toward the best-placed
 * person, so a race against it is decided late. The "person" here is a
 * scripted racer -- a personality whose player is not a CPU -- at a pace the
 * CPU would otherwise outrun or fall behind.
 */
import { describe, expect, it } from "vitest";
import { PERSONALITIES, type Personality } from "@floor-fifty/shared/cpu/personalities";
import { race, SURVEY } from "./support";

const NO_BANDS: Personality["bands"] = { cruising: {}, pushing: {} };
/** The same CPU with its moods switched off: what it did before banding. */
const unbanded = (personality: Personality): Personality => ({ ...personality, bands: NO_BANDS });
/** Only its pushing band: how it chases, with no waiting mixed in. */
const pushingOnly = (personality: Personality): Personality => ({ ...personality, bands: { cruising: {}, pushing: personality.bands.pushing } });

/** A slow person: steady, but slow of hand and slip-prone. */
const SLOW_PERSON: Personality = { ...PERSONALITIES.cyan, name: "Slow", reactionTicks: 12, slipChance: 0.25, bands: NO_BANDS };
/** A quick person: the reference controller's pace, near enough. */
const QUICK_PERSON: Personality = { ...PERSONALITIES.cyan, name: "Quick", reactionTicks: 4, slipChance: 0, linedUpFraction: 0.8, bands: NO_BANDS };

/**
 * How far apart a CPU and the person are when the race ends, in floors,
 * averaged over the survey: the margin a race is decided by.
 */
function meanGap(cpu: Personality, person: Personality): number {
  const seeds = SURVEY.slice(0, 12);
  const total = seeds.reduce((sum, seed) => {
    // Racer 1 is the CPU (the controller knows itself as one); racer 2 is a person.
    const [mine, theirs] = race(seed, [cpu, person]);
    return sum + Math.abs(mine!.score - theirs!.score);
  }, 0);
  return total / seeds.length;
}

describe("banding toward the best-placed person", { timeout: 120_000 }, () => {
  for (const colour of ["scarlet", "gold", "violet"] as const) {
    const personality = PERSONALITIES[colour];
    it(`${personality.name} finishes closer to a slow person than it would unbanded`, () => {
      expect(meanGap(personality, SLOW_PERSON)).toBeLessThan(meanGap(unbanded(personality), SLOW_PERSON));
    });
  }

  it("leaves Koi, the benchmark, all but unbanded: within a floor of its unbanded margin", () => {
    expect(Math.abs(meanGap(PERSONALITIES.cyan, SLOW_PERSON) - meanGap(unbanded(PERSONALITIES.cyan), SLOW_PERSON))).toBeLessThan(1);
  });

  // Pushing alone: with cruising in, a CPU also waits while a quick person who
  // fell climbs back, which is banding working even when the CPU then loses.
  it("never lets a CPU's pushing leave it further behind a quick person than unbanded", () => {
    for (const colour of ["scarlet", "gold", "violet"] as const) {
      const personality = PERSONALITIES[colour];
      expect(meanGap(pushingOnly(personality), QUICK_PERSON), personality.name).toBeLessThanOrEqual(meanGap(unbanded(personality), QUICK_PERSON) + 0.5);
    }
  });
});
