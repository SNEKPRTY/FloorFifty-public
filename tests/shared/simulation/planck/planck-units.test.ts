import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VIEWPORT } from "@floor-fifty/shared/common/constants";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import {
  FLOOR_CATEGORY,
  FOOT_SENSOR_CATEGORY,
  POSITION_ITERATIONS,
  RACER_CATEGORY,
  VELOCITY_ITERATIONS,
} from "@floor-fifty/shared/simulation/planck/config";
import {
  PIXELS_PER_METER,
  toMeters,
  toPixels,
} from "@floor-fifty/shared/simulation/planck/units";

const tuning = resolveTuning();

describe("planck units", () => {
  it("round-trips every authored length without loss", () => {
    for (const value of Object.values(tuning)) {
      expect(toPixels(toMeters(value))).toBeCloseTo(value, 9);
    }
  });

  it("keeps the whole world inside the solver's comfortable range", () => {
    expect(toMeters(VIEWPORT.width)).toBeLessThan(50);
    expect(toMeters(tuning.PLAYER_WIDTH)).toBeGreaterThan(0.1);
    expect(toMeters(tuning.FLOOR_HEIGHT)).toBeGreaterThan(0.1);
  });

  it("pins the scale and the solver iteration counts", () => {
    expect(PIXELS_PER_METER).toBe(50);
    expect(VELOCITY_ITERATIONS).toBe(8);
    expect(POSITION_ITERATIONS).toBe(3);
  });

  it("gives racers a category they can never collide with", () => {
    expect(RACER_CATEGORY & FLOOR_CATEGORY).toBe(0);
    expect(RACER_CATEGORY & FOOT_SENSOR_CATEGORY).toBe(0);
  });
});

describe("the planck dependency", () => {
  it("is pinned to an exact version", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../../../packages/shared/package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies["planck"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
