// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MonotonicProgress, weighted } from "../../../../../apps/client/src/features/profile/progress.svelte";

describe("progress", () => {
  it("never moves backwards and stays in [0, 1]", () => {
    const progress = new MonotonicProgress();
    for (const fraction of [0.5, 0.3, 0.8, 1.4, -1]) progress.report(fraction);
    expect(progress.value).toBe(1);
    const seen: number[] = [];
    const again = new MonotonicProgress();
    for (const fraction of [0.5, 0.3, 0.8]) {
      again.report(fraction);
      seen.push(again.value);
    }
    expect(seen).toEqual([0.5, 0.5, 0.8]);
  });

  it("weights consecutive loads into one bar", () => {
    const at = weighted([0.6, 0.2, 0.2]);
    expect(at(0, 0.5)).toBeCloseTo(0.3);
    expect(at(1, 0)).toBeCloseTo(0.6);
    expect(at(2, 1)).toBeCloseTo(1);
  });
});
