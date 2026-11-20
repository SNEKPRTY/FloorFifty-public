import { describe, expect, it } from "vitest";
import { SEAT_COLOURS } from "@floor-fifty/shared/common/seats";
import { CPU_MEDIAN_BAND_SECONDS, PERSONALITIES } from "@floor-fifty/shared/cpu/personalities";
import { median, race, SURVEY } from "./support";

describe("every CPU is one strength (CPU players spec §4)", () => {
  for (const colour of SEAT_COLOURS) {
    const personality = PERSONALITIES[colour];
    it(`${personality.name} finishes nearly every survey course, inside the band`, { timeout: 60_000 }, () => {
      const runs = SURVEY.map((seed) => ({ seed, ...race(seed, [personality])[0]! }));
      const failed = runs.filter((run) => !run.finished);
      expect(failed.length / runs.length, `unfinished: ${failed.map((run) => run.seed).join(", ")}`).toBeLessThanOrEqual(0.05);
      const finishedMedian = median(runs.filter((run) => run.finished).map((run) => run.seconds));
      expect(finishedMedian, `${personality.name}'s median`).toBeGreaterThanOrEqual(CPU_MEDIAN_BAND_SECONDS.min);
      expect(finishedMedian, `${personality.name}'s median`).toBeLessThanOrEqual(CPU_MEDIAN_BAND_SECONDS.max);
    });
  }
});
