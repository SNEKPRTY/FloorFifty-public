import { describe, expect, it } from "vitest";
import { TUNABLES, resolveTuning } from "@floor-fifty/shared/common/tuning";

describe("tuning declarations", () => {
  it("resolves Survival's edge defaults (survival spec §3)", () => {
    const tuning = resolveTuning();
    expect([
      tuning.SURVIVAL_VIEW_HEIGHT,
      tuning.SURVIVAL_GRACE_TICKS,
      tuning.SURVIVAL_RISE_START,
      tuning.SURVIVAL_RISE_STEP,
      tuning.SURVIVAL_RISE_STEP_TICKS,
      tuning.SURVIVAL_RISE_CAP,
      tuning.SURVIVAL_PUSH_AT,
      tuning.SURVIVAL_PUSH_SPEED,
      tuning.SURVIVAL_BAND_AHEAD_STEP,
      tuning.SURVIVAL_BAND_AHEAD_MAX,
      tuning.SURVIVAL_BAND_BEHIND_STEP,
      tuning.SURVIVAL_BAND_BEHIND_MIN,
    ]).toEqual([480, 180, 55, 20, 1800, 150, 0.55, 300, 0.1, 1.5, 0.05, 0.7]);
  });

  it("declares a 10-second start wait, the value the shipped tuning carries (first-race spec §2)", () => {
    expect(TUNABLES.SURVIVAL_START_WAIT_TICKS).toEqual({ type: "int", min: 0, max: 3600, default: 600 });
    expect(resolveTuning().SURVIVAL_START_WAIT_TICKS).toBe(600);
  });

  it("declares the tutorial's slow edge (first-race spec §1): its speed and how far under her it starts", () => {
    expect(TUNABLES.TUTORIAL_EDGE_RISE).toEqual({ type: "float", min: 5, max: 200, default: 30 });
    expect(TUNABLES.TUTORIAL_EDGE_START_BELOW).toEqual({ type: "float", min: 60, max: 600, default: 240 });
    expect(resolveTuning()).toMatchObject({ TUTORIAL_EDGE_RISE: 30, TUTORIAL_EDGE_START_BELOW: 240 });
  });

  it("declares every tunable with a type, inclusive range, and default", () => {
    for (const tunable of Object.values(TUNABLES)) {
      expect(tunable).toMatchObject({
        type: expect.any(String),
        min: expect.any(Number),
        max: expect.any(Number),
      });
      expect(tunable.default).toBeGreaterThanOrEqual(tunable.min);
      expect(tunable.default).toBeLessThanOrEqual(tunable.max);
    }
  });

  it("resolves to the declared defaults when no override is supplied", () => {
    const tuning = resolveTuning();
    for (const [name, tunable] of Object.entries(TUNABLES)) {
      expect(tuning[name as keyof typeof TUNABLES]).toBe(tunable.default);
    }
  });

  it("rejects a tuning override outside its declared range", () => {
    expect(() => resolveTuning({ COURSE_FLOOR_COUNT: 101 })).toThrow(/COURSE_FLOOR_COUNT/);
    expect(() => resolveTuning({ COURSE_FLOOR_COUNT: 19 })).toThrow(/COURSE_FLOOR_COUNT/);
  });

  it("rejects a non-integer override for an int tunable", () => {
    expect(() => resolveTuning({ COURSE_FLOOR_COUNT: 20.5 })).toThrow(/COURSE_FLOOR_COUNT/);
  });

  it("accepts an in-range override and leaves the rest at their defaults", () => {
    const tuning = resolveTuning({ COURSE_FLOOR_COUNT: 50 });
    expect(tuning.COURSE_FLOOR_COUNT).toBe(50);
    expect(tuning.GRAVITY).toBe(TUNABLES.GRAVITY.default);
  });
});
