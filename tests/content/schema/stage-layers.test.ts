/**
 * A stage's scenery layers, as data.
 *
 * The list is the composition: its order is the depth order, so the rules here
 * are the ones a hand-written list breaks quietly. Each case is a mistake an
 * author can make in TOML that would otherwise render as a wrong picture
 * rather than fail.
 */
import { describe, expect, it } from "vitest";
import { stageLayersSchema } from "../../../packages/content/src/schema/stage";

const far = { alias: "world.cityFar", plate: "city", depth: 0.15, sink: 240, extend: "skirt" } as const;
const near = { alias: "world.cityNear", plate: "city", depth: 0.35, sink: 290, extend: "skirt" } as const;
const sky = { alias: "world.dawnSky", plate: "sky", depth: 0.06, sink: 440, extend: "plate" } as const;

const issues = (value: unknown): string[] => {
  const result = stageLayersSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("a stage's layer list", () => {
  it("accepts layers listed back to front within each plate", () => {
    expect(issues([sky, far, near])).toEqual([]);
  });

  it("refuses a city layer nearer than the one after it", () => {
    expect(issues([near, far])).toEqual([expect.stringMatching(/^1\.depth: .*back to front/)]);
  });

  it("orders each plate on its own, so a sky layer after a city one is fine", () => {
    expect(issues([far, sky])).toEqual([]);
  });

  it("keeps two layers at the same depth in list order", () => {
    const windows = { ...near, alias: "world.lanterns", extend: "tile" } as const;
    expect(issues([near, windows])).toEqual([]);
  });

  it("refuses the same alias twice", () => {
    expect(issues([far, { ...near, alias: "world.cityFar" }])).toEqual([
      expect.stringMatching(/^1\.alias: .*already/),
    ]);
  });

  it("allows a full-frame plate only in the sky", () => {
    expect(issues([{ ...far, extend: "plate" }])).toEqual([expect.stringMatching(/^0\.extend: /)]);
  });

  it("puts a sky plate first among the sky layers", () => {
    // `StageLayers` draws only a leading plate behind the light; one listed
    // after another sky layer would cover it.
    const drift = { alias: "world.clouds", plate: "sky", depth: 0.06, sink: 0, extend: "none" } as const;
    expect(issues([far, sky, drift, near])).toEqual([]);
    expect(issues([drift, sky])).toEqual([expect.stringMatching(/^1\.extend: .*first sky layer/)]);
  });

  it("gives the ascent arc to city layers only", () => {
    expect(issues([{ ...sky, extend: "none", arc: 0.5 }])).toEqual([expect.stringMatching(/^0\.arc: /)]);
  });

  it("refuses a drifting sky plate", () => {
    expect(issues([{ ...sky, drift: 1 }])).toEqual([expect.stringMatching(/^0\.drift: /)]);
  });

  it("refuses an empty list and unknown keys", () => {
    expect(issues([])).not.toEqual([]);
    expect(issues([{ ...far, height: 360 }])).not.toEqual([]);
  });

  it("lets a sky layer stand above the origin with a negative sink", () => {
    expect(issues([{ alias: "world.cloudsHigh", plate: "sky", depth: 0.06, sink: -330, extend: "none" }])).toEqual([]);
  });

  it("bounds every number", () => {
    expect(issues([{ ...far, depth: 1.5 }])).not.toEqual([]);
    expect(issues([{ ...far, sink: -721 }])).not.toEqual([]);
    expect(issues([{ ...far, haze: -0.1 }])).not.toEqual([]);
    expect(issues([{ ...far, drift: 4 }])).not.toEqual([]);
  });
});
