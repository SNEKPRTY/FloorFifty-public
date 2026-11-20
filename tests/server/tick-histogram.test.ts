import { describe, expect, it } from "vitest";
import { Distribution } from "@floor-fifty/shared/common/telemetry";
import { BUCKET_MS, TickHistogram } from "../../apps/server/src/rooms/tick-histogram";
import { RoomTelemetry } from "../../apps/server/src/rooms/room-telemetry";

// Exact percentiles of every sample, nearest rank, as the histogram claims to approximate.
const exact = (samples: number[], q: number): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(q * sorted.length) - 1]!;
};

// 3,000 ticks with the slow ones first: a window of the last 512 sees only fast ones.
const minute = (): number[] => [
  ...Array.from({ length: 600 }, (_, i) => 8 + (i % 40) * 0.1),
  ...Array.from({ length: 2400 }, (_, i) => 1 + (i % 50) * 0.01),
];

describe("a minute of tick costs (server-down email spec, Design 4)", () => {
  it("gives every tick's percentiles within one bucket, where a 512-sample window does not", () => {
    const samples = minute();
    const histogram = new TickHistogram();
    for (const ms of samples) histogram.add(ms);
    const got = histogram.take()!;
    expect(got.n).toBe(3000);
    for (const [key, q] of [["p50", 0.5], ["p90", 0.9], ["p99", 0.99]] as const) {
      expect(got[key]).toBeGreaterThanOrEqual(exact(samples, q) - 1e-9);
      expect(got[key] - exact(samples, q)).toBeLessThanOrEqual(BUCKET_MS + 1e-9);
    }
    expect(got.max).toBe(Math.max(...samples));

    // The trap the plan audit found: a Distribution's p90 here misses the slow start entirely.
    const windowed = new Distribution();
    for (const ms of samples) windowed.add(ms);
    expect(Math.abs(windowed.summary().p90 - exact(samples, 0.9))).toBeGreaterThan(BUCKET_MS);
  });

  it("starts each minute empty, and has nothing to say for a minute with no tick", () => {
    const histogram = new TickHistogram();
    expect(histogram.take()).toBeUndefined();
    histogram.add(3);
    expect(histogram.take()?.n).toBe(1);
    expect(histogram.take()).toBeUndefined();
  });

  it("reports the exact max for a tick past the top bucket, and ignores nonsense", () => {
    const histogram = new TickHistogram();
    histogram.add(72.5);
    histogram.add(Number.NaN);
    histogram.add(-1);
    expect(histogram.take()).toEqual({ n: 1, p50: 72.5, p90: 72.5, p99: 72.5, max: 72.5 });
  });

  it("is fed each finished tick's cost by the room's telemetry", () => {
    let now = 0;
    const costs: number[] = [];
    const telemetry = new RoomTelemetry({ serial: 1, now: () => now, tickCost: (ms) => costs.push(ms) });
    telemetry.tickStarted();
    now = 2.5;
    telemetry.tickFinished({ stepMs: 1, projectMs: 1 });
    telemetry.dispose();
    expect(costs).toEqual([2.5]);
  });
});
