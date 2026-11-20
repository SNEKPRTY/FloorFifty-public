// @vitest-environment node
/**
 * Trauma shake: a 0-to-1 budget that moments add to and time drains, with the
 * shake its square.
 */

import { describe, expect, it } from "vitest";
import { Trauma } from "../../../../../apps/client/src/features/race/juice/trauma";

const SHAKE = { maxUnits: 6, decayPerSecond: 1.6, hz: 18 };

describe("trauma", () => {
  it("rests still at zero", () => {
    const trauma = new Trauma();
    expect(trauma.offset(1.234, SHAKE)).toEqual({ x: 0, y: 0 });
  });

  it("adds up, never past one", () => {
    const trauma = new Trauma();
    trauma.add(0.35);
    trauma.add(0.35);
    expect(trauma.level).toBeCloseTo(0.7, 6);
    trauma.add(0.6);
    expect(trauma.level).toBe(1);
  });

  it("drains at its rate and stops at zero", () => {
    const trauma = new Trauma();
    trauma.add(0.8);
    trauma.update(0.25, SHAKE.decayPerSecond);
    expect(trauma.level).toBeCloseTo(0.4, 6);
    trauma.update(10, SHAKE.decayPerSecond);
    expect(trauma.level).toBe(0);
  });

  it("shakes by its square: half the trauma is a quarter of the shake", () => {
    const full = new Trauma();
    full.add(1);
    const half = new Trauma();
    half.add(0.5);
    let fullPeak = 0;
    let halfPeak = 0;
    for (let t = 0; t < 2; t += 0.004) {
      fullPeak = Math.max(fullPeak, Math.abs(full.offset(t, SHAKE).x));
      halfPeak = Math.max(halfPeak, Math.abs(half.offset(t, SHAKE).x));
    }
    expect(fullPeak).toBeLessThanOrEqual(SHAKE.maxUnits);
    expect(fullPeak).toBeGreaterThan(SHAKE.maxUnits * 0.6);
    expect(halfPeak / fullPeak).toBeCloseTo(0.25, 2);
  });

  it("is the same shake for the same moment: deterministic, never random", () => {
    const a = new Trauma();
    const b = new Trauma();
    a.add(0.6);
    b.add(0.6);
    expect(a.offset(0.42, SHAKE)).toEqual(b.offset(0.42, SHAKE));
  });

  it("moves x and y differently, so it reads as a shake and not a slide", () => {
    const trauma = new Trauma();
    trauma.add(1);
    const { x, y } = trauma.offset(0.37, SHAKE);
    expect(x).not.toBeCloseTo(y, 3);
  });

  it("settles at once", () => {
    const trauma = new Trauma();
    trauma.add(1);
    trauma.settle();
    expect(trauma.level).toBe(0);
  });
});
