// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WINDOW_GLOW_GAIN, windowStep, type WindowStep } from "../../../../apps/client/src/features/render/window-breath";

const steps = (seconds: number, glow = 0): WindowStep[] =>
  Array.from({ length: 64 }, (_unused, id) => windowStep(id, seconds, glow));

describe("windowStep", () => {
  it("rests the windows at different steps, so the building is never one colour", () => {
    expect(new Set(steps(3)).size).toBeGreaterThanOrEqual(3);
  });

  it("breathes: windows change step as the clock runs", () => {
    const before = steps(3);
    const after = steps(9);
    expect(before.filter((step, id) => step !== after[id]).length).toBeGreaterThan(0);
  });

  it("holds still while the clock does", () => {
    expect(steps(5)).toEqual(steps(5));
  });

  it("lifts windows up the ramp on the beat's glow", () => {
    const order: WindowStep[] = ["out", "dim", "window", "bright", "hot"];
    const rank = (all: WindowStep[]) => all.reduce((sum, step) => sum + order.indexOf(step), 0);
    expect(rank(steps(4, 4))).toBeGreaterThan(rank(steps(4, 0)));
  });

  it("keeps the city shader's glow gain, raised so the windows dance (Wonder spec §6.2)", () => {
    const shader = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/render/filters/city-atmosphere.ts"), "utf8");
    const gain = Number(/const float GLOW_GAIN = ([\d.]+);/.exec(shader)?.[1]);
    expect(WINDOW_GLOW_GAIN).toBe(gain);
    expect(gain).toBeCloseTo(0.3, 6);
  });
});
