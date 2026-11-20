import { describe, expect, it } from "vitest";
import { VIEWPORT } from "@floor-fifty/shared/common/constants";
import { logLerp, shortestWrappedOffset, wrapSymmetric } from "@floor-fifty/shared/common/math";
import { wrappedOffset } from "@floor-fifty/shared/level/steering";

const WIDTH = VIEWPORT.width;

describe("interpolating in octaves", () => {
  it("lands exactly on its ends and clamps past them", () => {
    expect(logLerp(20_000, 1_400, 0)).toBe(20_000);
    expect(logLerp(20_000, 1_400, 1)).toBe(1_400);
    expect(logLerp(20_000, 1_400, -1)).toBe(20_000);
    expect(logLerp(20_000, 1_400, 2)).toBe(1_400);
  });

  it("is the geometric middle halfway: as many octaves either side", () => {
    expect(logLerp(400, 1_600, 0.5)).toBeCloseTo(800, 9);
  });
});

describe("the shortest way round a wrapping course", () => {
  it("is the plain difference when the seam is not between the two points", () => {
    expect(shortestWrappedOffset(-100, 200, WIDTH)).toBe(300);
    expect(shortestWrappedOffset(200, -100, WIDTH)).toBe(-300);
  });

  it("goes through the seam when that is nearer", () => {
    // Near the right edge to near the left edge is a short hop across the wrap,
    // not a journey back across the whole course.
    expect(shortestWrappedOffset(460, -460, WIDTH)).toBe(40);
    expect(shortestWrappedOffset(-460, 460, WIDTH)).toBe(-40);
  });

  it("is zero between a point and itself", () => {
    expect(shortestWrappedOffset(123, 123, WIDTH)).toBe(0);
  });

  it("never returns further than half the course", () => {
    for (let from = -WIDTH / 2; from <= WIDTH / 2; from += 37) {
      for (let to = -WIDTH / 2; to <= WIDTH / 2; to += 37) {
        expect(Math.abs(shortestWrappedOffset(from, to, WIDTH))).toBeLessThanOrEqual(WIDTH / 2);
      }
    }
  });

  it("lands on the target when applied and wrapped", () => {
    const from = 470;
    const to = -430;
    const arrived = wrapSymmetric(from + shortestWrappedOffset(from, to, WIDTH), WIDTH / 2);
    expect(arrived).toBeCloseTo(to);
  });

  it("is the rule the reference controller already steers by", () => {
    // One implementation, two callers: the bot that climbs a course in a test
    // and the client that predicts its own horizontal movement.
    for (const [from, to] of [
      [0, 100],
      [470, -430],
      [-470, 430],
      [-200, 200],
    ] as const) {
      expect(wrappedOffset(from, to)).toBe(shortestWrappedOffset(from, to, WIDTH));
    }
  });
});
