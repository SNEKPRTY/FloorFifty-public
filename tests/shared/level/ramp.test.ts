/**
 * The demand ramp (race-options spec §5.1): above floor 50, in bands of ten,
 * more floors move and they move faster, each to a cap. Floors 0-49 are drawn
 * exactly as before, and a ramped band consumes its stream as band 0 does.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveTuning, type ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { courseBounds, createCourse, rampBand } from "@floor-fifty/shared/level/course";
import { createRng, deriveSeed } from "@floor-fifty/shared/level/rng";

const TALL = (overrides: Partial<ResolvedTuning> = {}) => resolveTuning({ COURSE_FLOOR_COUNT: 100, ...overrides });

/** Measured at b7b3513, before the ramp existed (the phase 4 plan's header). */
const BAND_ZERO = {
  35229: "70f907b132cf89daeafa64dacf034c042e3d32236e8e75762d91861b59aee081",
  34528: "70e62ba16c4d6ece9613fd2b93671a2544ebc8eafd1f683344567ed0353f4587",
  107255: "a4cbb79973b51c5e596c0b3c6e8d120107edd2114f4bed588235f036183b8159",
} as const;

describe("the demand ramp (race-options spec §5.1)", () => {
  it.each(Object.entries(BAND_ZERO))("leaves seed %s's floors 0-49 as they were", (seed, hash) => {
    const floors = createCourse(Number(seed), resolveTuning({ COURSE_FLOOR_COUNT: 50 })).floors;
    expect(createHash("sha256").update(JSON.stringify(floors)).digest("hex")).toBe(hash);
  });

  it("bands floors in tens from floor 50", () => {
    const tuning = resolveTuning();
    expect([0, 49, 50, 59, 60, 99].map((i) => rampBand(i, tuning))).toEqual([0, 0, 1, 1, 2, 5]);
  });

  it("raises the moving share by its step per band", () => {
    const tuning = TALL();
    const seeds = Array.from({ length: 400 }, (_, i) => i * 7919 + 13);
    for (let band = 1; band <= 5; band += 1) {
      let moving = 0;
      let total = 0;
      for (const seed of seeds) {
        for (const floor of createCourse(seed, tuning).floors.filter((f) => rampBand(f.index, tuning) === band)) {
          total += 1;
          if (floor.kind === "moving") moving += 1;
        }
      }
      expect(Math.abs(moving / total - Math.min(0.5 + band * 0.05, 0.8))).toBeLessThan(0.03);
    }
  });

  it("stops the moving share at its cap", () => {
    const tuning = TALL({ MOVING_SHARE_STEP: 0.5, MOVING_SHARE_MAX: 0.8 });
    let moving = 0;
    let total = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      for (const floor of createCourse(seed, tuning).floors.slice(60)) {
        total += 1;
        if (floor.kind === "moving") moving += 1;
      }
    }
    expect(Math.abs(moving / total - 0.8)).toBeLessThan(0.03);
  });

  it("raises the speed range by its step per band, up to the cap", () => {
    const tuning = TALL({ MOVING_SPEED_STEP: 60, MOVING_FLOOR_SPEED_CAP: 300 });
    for (let seed = 0; seed < 50; seed += 1) {
      for (const floor of createCourse(seed, tuning).floors) {
        if (floor.kind !== "moving") continue;
        const band = rampBand(floor.index, tuning);
        const lo = band === 0 ? 100 : Math.min(100 + band * 60, 300);
        const hi = band === 0 ? 200 : Math.min(200 + band * 60, 300);
        expect(floor.speed).toBeGreaterThanOrEqual(lo);
        expect(lo === hi ? floor.speed === lo : floor.speed < hi).toBe(true);
      }
    }
  });

  it("consumes a band's stream as band 0 does: x, then the moving draw, then the speed draw", () => {
    const tuning = TALL();
    const bounds = courseBounds(tuning);
    for (const seed of [35229, 34528, 107255]) {
      for (const floor of createCourse(seed, tuning).floors.slice(50)) {
        const rng = createRng(deriveSeed(seed, floor.index));
        expect(floor.x).toBe(rng.nextRange(bounds.left, bounds.right));
        rng.nextUint32();
        const band = rampBand(floor.index, tuning);
        const speed = rng.nextRange(Math.min(100 + band * 10, 300), Math.min(200 + band * 10, 300));
        if (floor.kind === "moving") expect(floor.speed).toBe(speed);
      }
    }
  });
});
