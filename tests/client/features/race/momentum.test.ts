// @vitest-environment node
/**
 * The climb's intensity.
 *
 * The design's Non-Goals refuse rhythm scoring, streaks and Flow, so the tests
 * that matter most here are the ones establishing that this is none of them: it
 * reads a number the simulation already owns, it drives only presentation, and
 * a reset turns it down because the reset took the ascent it was measuring.
 */

import { describe, expect, it } from "vitest";
import { MOMENTUM, MomentumTracker, intensityFor } from "../../../../apps/client/src/features/race/momentum";

const settle = (tracker: MomentumTracker, seconds = 10): number => {
  for (let step = 0; step < seconds * 60; step += 1) tracker.advance(1000 / 60);
  return tracker.intensity;
};

describe("intensity from progress", () => {
  it("is nothing at the bottom and everything at the top", () => {
    expect(intensityFor(0)).toBe(0);
    expect(intensityFor(1)).toBe(1);
  });

  it("rises without ever falling", () => {
    let previous = -1;
    for (let progress = 0; progress <= 1; progress += 0.01) {
      const value = intensityFor(progress);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("stays quiet through the teaching phrase and builds toward the top", () => {
    // The opening is where the course teaches and should not be loud; the
    // finish asks for three near-maximum commitments and is where the world
    // should be at its most insistent.
    expect(intensityFor(0.25)).toBeLessThan(0.15);
    expect(intensityFor(0.9)).toBeGreaterThan(0.75);
  });

  it("ignores a progress outside the ascent rather than trusting it", () => {
    expect(intensityFor(-1)).toBe(0);
    expect(intensityFor(4)).toBe(1);
  });
});

describe("the glide", () => {
  it("eases toward a new target rather than stepping to it", () => {
    // Snapshots arrive twenty times a second; stepping to each would make the
    // music gain audibly staircase.
    const tracker = new MomentumTracker();
    tracker.observe(1);
    tracker.advance(1000 / 60);
    expect(tracker.intensity).toBeGreaterThan(0);
    expect(tracker.intensity).toBeLessThan(0.1);
  });

  it("arrives, given time", () => {
    const tracker = new MomentumTracker();
    tracker.observe(1);
    expect(settle(tracker)).toBeCloseTo(1, 5);
  });

  it("descends when an ascent is lost, at the same rate it climbed", () => {
    // A reset clears `visitedFloorIds` back to the starting floor, so progress
    // falls and this follows it. Falling rather than switching off: losing
    // height should feel like losing height.
    const tracker = new MomentumTracker();
    tracker.observe(1);
    settle(tracker);

    tracker.observe(0);
    tracker.advance(1000 / 60);
    expect(tracker.intensity).toBeLessThan(1);
    expect(tracker.intensity).toBeGreaterThan(0.9);
    expect(settle(tracker)).toBe(0);
  });
});

describe("what it drives", () => {
  it("muffles the music at the bottom and opens it fully at the top", () => {
    const tracker = new MomentumTracker();
    expect(tracker.musicCutoffHz).toBeCloseTo(MOMENTUM.musicCutoffFloorHz, 5);
    // Muffled, not gone: the melody lives under two kilohertz.
    expect(MOMENTUM.musicCutoffFloorHz).toBeGreaterThanOrEqual(1_000);

    tracker.observe(1);
    settle(tracker);
    expect(tracker.musicCutoffHz).toBeCloseTo(MOMENTUM.musicCutoffCeilingHz, 5);
    expect(MOMENTUM.musicCutoffCeilingHz).toBeGreaterThanOrEqual(18_000);
  });

  it("opens the music steadily rather than all at the top", () => {
    // The pulse is weighted late; the ear hears a filter shut through half
    // the climb as nothing happening, then as one swell.
    const octavesAt = (progress: number): number => {
      const tracker = new MomentumTracker();
      tracker.observe(progress);
      settle(tracker);
      return Math.log2(tracker.musicCutoffHz / MOMENTUM.musicCutoffFloorHz);
    };
    const total = Math.log2(MOMENTUM.musicCutoffCeilingHz / MOMENTUM.musicCutoffFloorHz);
    expect(octavesAt(0.25) / total).toBeGreaterThan(0.1);
    expect(octavesAt(0.5) / total).toBeCloseTo(0.5, 5);
  });

  it("keeps the world pulsing at the bottom of a climb", () => {
    // A still world at the start reads as broken rather than as calm.
    expect(new MomentumTracker().pulseScale).toBe(MOMENTUM.pulseFloor);
    expect(MOMENTUM.pulseFloor).toBeGreaterThan(0);
  });

  it("drives nothing that could change a race", async () => {
    // The rule the Non-Goals set, checked against the source rather than
    // trusted. Nothing here may reach the simulation, the tuning, or a score.
    const [{ readFileSync }, { resolve }] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);
    // Comments stripped first. The prose here says what this is not -- "it is
    // not a score", "no streak" -- and a scan that read those would be
    // catching the explanation rather than the thing explained.
    const code = readFileSync(
      resolve(process.cwd(), "apps/client/src/features/race/momentum.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    for (const forbidden of ["createRaceSimulation", "RaceState", "ResolvedTuning", "score", "streak"]) {
      expect(code, `momentum.ts references ${forbidden}`).not.toContain(forbidden);
    }
  });
});
