import { describe, expect, it } from "vitest";
import { Distribution, formatSummary } from "@floor-fifty/shared/common/telemetry";

describe("Distribution", () => {
  it("summarises a known set with nearest-rank percentiles", () => {
    const distribution = new Distribution(100);
    for (let value = 1; value <= 100; value += 1) distribution.add(value);

    const summary = distribution.summary();
    expect(summary.count).toBe(100);
    expect(summary.mean).toBeCloseTo(50.5, 9);
    expect(summary.min).toBe(1);
    expect(summary.max).toBe(100);
    expect(summary.p50).toBe(50);
    expect(summary.p90).toBe(90);
    expect(summary.p99).toBe(99);
  });

  it("keeps only the newest window of samples", () => {
    const distribution = new Distribution(3);
    for (const value of [100, 1, 2, 3]) distribution.add(value);

    const summary = distribution.summary();
    expect(summary.count).toBe(3);
    expect(summary.max).toBe(3);
    expect(summary.min).toBe(1);
  });

  it("remembers the lifetime count and worst sample after eviction", () => {
    const distribution = new Distribution(2);
    for (const value of [40, 1, 2, 3]) distribution.add(value);

    const summary = distribution.summary();
    expect(summary.lifetimeCount).toBe(4);
    expect(summary.lifetimeMax).toBe(40);
    expect(summary.max).toBe(3);
  });

  it("reports zeros when empty rather than infinities", () => {
    const summary = new Distribution().summary();
    expect(summary).toEqual({
      count: 0,
      mean: 0,
      min: 0,
      max: 0,
      p50: 0,
      p90: 0,
      p99: 0,
      lifetimeCount: 0,
      lifetimeMax: 0,
    });
  });

  it("ignores a non-finite sample instead of poisoning the summary", () => {
    const distribution = new Distribution();
    distribution.add(Number.NaN);
    distribution.add(Number.POSITIVE_INFINITY);
    distribution.add(2);

    expect(distribution.summary()).toMatchObject({ count: 1, mean: 2, lifetimeCount: 1 });
  });

  it("forgets everything on reset", () => {
    const distribution = new Distribution();
    distribution.add(5);
    distribution.reset();
    expect(distribution.summary().lifetimeCount).toBe(0);
    expect(distribution.lifetimeMax).toBe(0);
  });

  it("refuses a window that could hold nothing", () => {
    expect(() => new Distribution(0)).toThrow(/at least one sample/);
  });

  it("formats a summary as one short line", () => {
    const distribution = new Distribution();
    for (const value of [1, 2, 3]) distribution.add(value);
    expect(formatSummary(distribution.summary())).toBe("p50 2.0 p90 3.0 p99 3.0 max 3.0");
  });
});
