// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PulseFrame } from "../../../../apps/client/src/features/render/music-pulse";
import { StageReactor, intensityAt, slamsInView } from "../../../../apps/client/src/features/render/stage-reactor";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";

const JOLT = GENERATED_CONTENT.content.juice.springs.jolt;
const pulse = (beats: number, kick: number): PulseFrame => ({ phase: 0, spike: 0, beats, progress: 0, kick });
const quiet = { pulse: undefined, intensity: 0, slams: 0, streak: 0, reduced: false } as const;

describe("StageReactor (Wonder spec §6.2–6.3)", () => {
  it("rises in five bands of a fifth of the climb", () => {
    const height = 50 * 128.57;
    expect([0, 0.19, 0.21, 0.5, 0.79, 0.81, 1].map((share) => intensityAt(share * height, height))).toEqual([0, 0, 0.25, 0.5, 0.75, 1, 1]);
    expect(intensityAt(-100, height)).toBe(0);
    expect(intensityAt(5 * height, height)).toBe(1);
  });

  it("bobs on each beat, more at higher intensity, drawn on whole units", () => {
    const peak = (intensity: number) => {
      const reactor = new StageReactor(() => JOLT);
      let most = 0;
      for (let i = 0; i < 30; i += 1) {
        const motion = reactor.update({ ...quiet, dtSeconds: 1 / 60, pulse: pulse(i === 0 ? 0 : 1, 0), intensity });
        expect(Number.isInteger(motion.bob)).toBe(true);
        most = Math.max(most, Math.abs(motion.bob));
      }
      return most;
    };
    expect(peak(1)).toBeGreaterThan(peak(0));
    expect(peak(0)).toBeGreaterThanOrEqual(1);
  });

  it("bobs once per beat, not every frame of it", () => {
    const reactor = new StageReactor(() => JOLT);
    reactor.update({ ...quiet, dtSeconds: 1 / 60, pulse: pulse(0, 0) });
    const motions = Array.from({ length: 60 }, () => reactor.update({ ...quiet, dtSeconds: 1 / 60, pulse: pulse(0, 0) }));
    expect(motions.every((motion) => motion.bob === 0)).toBe(true);
  });

  it("jolts the near city on a slam and flashes the windows for one beat", () => {
    const reactor = new StageReactor(() => JOLT);
    const motion = reactor.update({ ...quiet, dtSeconds: 1 / 60, slams: 1 });
    expect(Math.abs(motion.jolt)).toBeGreaterThan(0);
    expect(reactor.windowFlash).toBeGreaterThan(0);
    for (let i = 0; i < 60; i += 1) reactor.update({ ...quiet, dtSeconds: 1 / 60 });
    expect(reactor.windowFlash).toBe(0);
  });

  it("surges the drift on a heavy kick, and not on a light one", () => {
    const reactor = new StageReactor(() => JOLT);
    reactor.update({ ...quiet, dtSeconds: 1 / 60, pulse: pulse(0, 0.3) });
    expect(reactor.update({ ...quiet, dtSeconds: 1 / 60, pulse: pulse(0, 0.3) }).surge).toBe(0);
    const heavy = reactor.update({ ...quiet, dtSeconds: 1 / 60, pulse: pulse(0, 0.95) });
    expect(heavy.surge).toBeGreaterThan(0);
    const later = reactor.update({ ...quiet, dtSeconds: 1 / 60, pulse: pulse(0, 0.95) });
    expect(later.surge).toBeGreaterThan(heavy.surge); // accumulated, never rescaled
  });

  it("lifts the glow a step from a streak of five, and with the climb", () => {
    const reactor = new StageReactor(() => JOLT);
    reactor.update({ ...quiet, dtSeconds: 1 / 60, streak: 4 });
    const below = reactor.glowLift;
    reactor.update({ ...quiet, dtSeconds: 1 / 60, streak: 5 });
    expect(reactor.glowLift).toBeGreaterThan(below);
    reactor.update({ ...quiet, dtSeconds: 1 / 60, streak: 5, intensity: 1 });
    expect(reactor.glowLift).toBeGreaterThan(below + 0.5);
  });

  it("moves nothing and flashes nothing under reduced motion, and keeps the steady light", () => {
    const reactor = new StageReactor(() => JOLT);
    const motion = reactor.update({ dtSeconds: 1 / 60, pulse: pulse(1, 1), intensity: 1, slams: 1, streak: 9, reduced: true });
    expect(motion).toEqual({ bob: 0, jolt: 0, surge: 0 });
    expect(reactor.glowLift).toBeGreaterThan(0);
    expect(reactor.windowFlash).toBe(0);
  });

  it("moves nothing at low quality, where the stage only glows (Wonder spec §6.6)", () => {
    const reactor = new StageReactor(() => JOLT);
    reactor.update({ ...quiet, dtSeconds: 1 / 60, pulse: pulse(0, 0) });
    const motion = reactor.update({ dtSeconds: 1 / 60, pulse: pulse(1, 1), intensity: 1, slams: 1, streak: 0, reduced: false, low: true });
    expect(motion).toEqual({ bob: 0, jolt: 0, surge: 0 });
  });

  it("flashes the windows no more than three times a second, however often racers slam", () => {
    const reactor = new StageReactor(() => JOLT);
    let starts = 0;
    let last = 0;
    for (let i = 0; i < 60; i += 1) {
      reactor.update({ ...quiet, dtSeconds: 1 / 60, slams: i % 6 === 0 ? 1 : 0 }); // a slam every 100 ms
      if (reactor.windowFlash === 1 && last < 1) starts += 1;
      last = reactor.windowFlash;
    }
    expect(starts).toBeLessThanOrEqual(3);
  });

  it("counts only the slams the camera can see", () => {
    const slam = (y: number) => ({ kind: "slam" as const, y });
    const moments = [slam(1000), slam(1250), slam(1600), { kind: "bounce" as const, y: 1000 }];
    expect(slamsInView(moments, 1000, 270)).toBe(2);
    expect(slamsInView(moments, 5000, 270)).toBe(0);
  });
});

describe("StageReactor with stage effects switched off", () => {
  it("holds the city still and unlit: no bob, jolt, surge, glow or flash", () => {
    const reactor = new StageReactor(() => JOLT);
    for (let i = 0; i < 30; i += 1) {
      const motion = reactor.update({ ...quiet, dtSeconds: 1 / 60, pulse: pulse(i, 1), intensity: 1, slams: 2, streak: 9, off: true });
      expect(motion).toEqual({ bob: 0, jolt: 0, surge: 0 });
      expect(reactor.glowLift).toBe(0);
      expect(reactor.windowFlash).toBe(0);
    }
  });

  it("switching off mid-flash puts the windows out at once", () => {
    const reactor = new StageReactor(() => JOLT);
    reactor.update({ ...quiet, dtSeconds: 1 / 60, slams: 1, intensity: 1 });
    expect(reactor.windowFlash).toBeGreaterThan(0);
    reactor.update({ ...quiet, dtSeconds: 1 / 60, intensity: 1, off: true });
    expect(reactor.windowFlash).toBe(0);
    expect(reactor.glowLift).toBe(0);
  });
});
