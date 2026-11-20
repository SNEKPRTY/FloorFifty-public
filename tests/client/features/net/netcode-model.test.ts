/**
 * Does a networked race play as if it were local? The deterministic model.
 *
 * The real client netcode, the room's real input queue and the real
 * simulation, joined by a modelled link on virtual time. It replaces a test
 * that measured the drawn position across a reconcile -- a quantity the
 * smoothing offset makes zero by construction, so it could not fail.
 *
 * What it measures instead is the question itself: for every tick the client
 * predicted, how far was the racer it simulated from the racer the room
 * decided? Zero is "as if local". Before input was stamped with its tick this
 * was 36 units at the 99th percentile on a 100 ms round trip; the budgets
 * below are the spec's (`2026-09-23-netcode-telemetry-and-input-alignment-design.md`).
 */

import { describe, expect, it } from "vitest";
import { createMovingFloorStates } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createCourse } from "@floor-fifty/shared/level/course";
import { runModelRace, standOnMovingFloor } from "../../support/model-room";

const lateShare = (report: { late: number; accepted: number }): number =>
  report.late / Math.max(1, report.late + report.accepted);

describe("the netcode, modelled", () => {
  it("is exact on a perfect link", () => {
    const report = runModelRace({ link: { upMs: 0, downMs: 0, jitterMs: 0 } });
    expect(report.late).toBe(0);
    expect(report.wholeRaceMisprediction.p99).toBeLessThanOrEqual(1);
    expect(report.drawnOffset.p99).toBeLessThanOrEqual(1);
  });

  it("predicts an endless climb that grows past floor 50 and moves its window (race-options spec §8)", { timeout: 120_000 }, () => {
    const tuning = resolveTuning({ COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 });
    const report = runModelRace({
      link: { upMs: 50, downMs: 50, jitterMs: 10 },
      seconds: 60,
      tuning,
      // Rooftops' seed, which the reference controller climbs past floor 50
      // in under a minute; the model's own seed stalls it low on the course.
      start: (race) => {
        const course = createCourse(35_229, tuning);
        return { ...race, seed: 35_229, course, movingFloors: createMovingFloorStates(course) };
      },
    });
    expect(report.finalFloorCount).toBeGreaterThan(50);
    expect(lateShare(report)).toBeLessThanOrEqual(0.01);
    expect(report.wholeRaceMisprediction.p99).toBeLessThanOrEqual(1);
    expect(report.drawnOffset.p99).toBeLessThanOrEqual(1);
    // Prediction at the ticks an endless window moved on (spec §8, departure 16),
    // keyed on the server tick: the windows moved, and the lead held as exactly as
    // anywhere. The count guards against an empty sample passing as p99 0.
    expect(report.windowChanges).toBeGreaterThan(10);
    expect(report.windowChangeMisprediction.count).toBeGreaterThan(250);
    expect(report.windowChangeMisprediction.p99).toBeLessThanOrEqual(1);
  });

  it("plays as if local at a hundred-millisecond round trip", () => {
    const report = runModelRace({ link: { upMs: 50, downMs: 50, jitterMs: 10 } });
    expect(lateShare(report)).toBeLessThanOrEqual(0.01);
    expect(report.wholeRaceMisprediction.p99).toBeLessThanOrEqual(1);
    expect(report.drawnOffset.p99).toBeLessThanOrEqual(1);
    // It led by about the round trip, which is what made that possible: with
    // no lead at all, every input change cost two ticks of travel and more.
    expect(report.leadTicks).toBeGreaterThan(6);
    expect(report.client.prediction.replayTicks.p50).toBeGreaterThan(5);
  });

  it("holds its budget at a two-hundred-millisecond round trip with jitter", () => {
    const report = runModelRace({ link: { upMs: 100, downMs: 100, jitterMs: 25 } });
    expect(lateShare(report)).toBeLessThanOrEqual(0.05);
    expect(report.wholeRaceMisprediction.p99).toBeLessThanOrEqual(6);
    expect(report.drawnOffset.p99).toBeLessThanOrEqual(12);
  });

  it("recovers within its first probes when nothing measured the trip beforehand", () => {
    // A client that joined and raced before its first probe came back guesses
    // its lead. Its first inputs may be late -- that is a real correction, and
    // it is bounded -- but once the room has answered, it is exact again.
    const report = runModelRace({
      link: { upMs: 50, downMs: 50, jitterMs: 10 },
      roundTripMs: null,
    });
    expect(report.misprediction.p99).toBeLessThanOrEqual(1);
    expect(report.misprediction.lifetimeMax).toBeLessThanOrEqual(1);
  });

  it("climbs as far over the network as it does locally", () => {
    const local = runModelRace({ link: { upMs: 0, downMs: 0, jitterMs: 0 } });
    const remote = runModelRace({ link: { upMs: 50, downMs: 50, jitterMs: 10 } });
    expect(remote.floors).toBeGreaterThanOrEqual(local.floors - 1);
  });

  it("predicts a lapping racer tick for tick", () => {
    const report = runModelRace({
      link: { upMs: 40, downMs: 40, jitterMs: 0 },
      lapCount: 3,
      seconds: 120,
    });
    expect(report.laps).toBeGreaterThanOrEqual(2);
    expect(report.wholeRaceMisprediction.p99).toBeLessThanOrEqual(1);
  });

  it("predicts a racer riding a moving floor tick for tick", () => {
    // Stood on the first moving floor and holding fast fall: pinned, and
    // carried every tick (race-flow spec §4.2).
    const report = runModelRace({
      link: { upMs: 40, downMs: 40, jitterMs: 0 },
      seconds: 8,
      start: standOnMovingFloor,
      script: (_frame, intent) => ({ ...intent, left: false, right: false, fastFall: true }),
    });
    expect(report.carriedTicks).toBeGreaterThan(60);
    expect(report.wholeRaceMisprediction.p99).toBeLessThanOrEqual(1);
  });

  it("predicts a manual reset on the very tick the room applies it", () => {
    // A tap on R, eight seconds in: the press and the release both land
    // between two ticks, and the respawn must still happen once, on the same
    // tick, on both sides.
    const report = runModelRace({
      link: { upMs: 50, downMs: 50, jitterMs: 10 },
      seconds: 12,
      script: (frame, intent) => (frame === 480 ? { ...intent, reset: true } : intent),
    });
    expect(report.serverResets).toHaveLength(1);
    expect(report.predictedResets).toContain(report.serverResets[0]);
  });
});
