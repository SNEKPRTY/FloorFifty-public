// @vitest-environment node
/**
 * The race's mix snapshots: the pause's muffle, and the breath held from
 * "LAST FLOOR!" to the finish.
 */

import { describe, expect, it } from "vitest";
import { BREATH_MAX_MS, RaceMix } from "../../../../apps/client/src/features/audio/race-mix";

const quiet = { lastFloor: false, release: false };

describe("the race's mix", () => {
  it("is the race's own until something asks otherwise", () => {
    expect(new RaceMix().frame({ nowMs: 0, ...quiet })).toBe("race");
  });

  it("holds its breath from the last floor until the finish lets it go", () => {
    const mix = new RaceMix();
    expect(mix.frame({ nowMs: 100, lastFloor: true, release: false })).toBe("breath");
    expect(mix.frame({ nowMs: 1_000, ...quiet })).toBe("breath");
    expect(mix.frame({ nowMs: 1_500, lastFloor: false, release: true })).toBe("race");
  });

  it("lets go on its own if the last floor takes too long", () => {
    const mix = new RaceMix();
    mix.frame({ nowMs: 0, lastFloor: true, release: false });
    expect(mix.frame({ nowMs: BREATH_MAX_MS - 1, ...quiet })).toBe("breath");
    expect(mix.frame({ nowMs: BREATH_MAX_MS, ...quiet })).toBe("race");
  });

  it("muffles under the pause, over a breath, and comes back to whichever holds", () => {
    const mix = new RaceMix();
    mix.setPaused(true);
    expect(mix.frame({ nowMs: 0, ...quiet })).toBe("paused");
    expect(mix.frame({ nowMs: 10, lastFloor: true, release: false })).toBe("paused");
    mix.setPaused(false);
    expect(mix.frame({ nowMs: 20, ...quiet })).toBe("breath");
  });

  it("forgets a breath on a rewind", () => {
    const mix = new RaceMix();
    mix.frame({ nowMs: 0, lastFloor: true, release: false });
    mix.reset();
    expect(mix.frame({ nowMs: 10, ...quiet })).toBe("race");
  });
});
