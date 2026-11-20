import { describe, expect, it } from "vitest";
import {
  MISSED_FLOOR_CUE,
  MissedFloorCueTracker,
  missedFloorCue,
} from "../../../../apps/client/src/features/race/race-cues";

describe("missed floor audio cues", () => {
  it("defines floorMissed cue with moderate gain on effects bus", () => {
    expect(MISSED_FLOOR_CUE.alias).toBe("sfx.floorMissed");
    expect(MISSED_FLOOR_CUE.bus).toBe("effects");
    expect(MISSED_FLOOR_CUE.gain).toBeGreaterThan(0.2);
    expect(MISSED_FLOOR_CUE.gain).toBeLessThan(0.7);
  });

  it("produces missedFloorCue with distinct eventId per ascent", () => {
    const cue0 = missedFloorCue(0);
    const cue1 = missedFloorCue(1);
    expect(cue0.alias).toBe("sfx.floorMissed");
    expect(cue0.eventId).not.toBe(cue1.eventId);
  });

  it("MissedFloorCueTracker triggers cue once on first missed floor and throttles subsequent ones", () => {
    const tracker = new MissedFloorCueTracker();
    expect(tracker.hasPlayedThisAscent).toBe(false);

    // No missed floors yet
    expect(tracker.observe(false)).toBeUndefined();
    expect(tracker.hasPlayedThisAscent).toBe(false);

    // First missed floor triggers cue
    const cue = tracker.observe(true);
    expect(cue).toBeDefined();
    expect(cue?.alias).toBe("sfx.floorMissed");
    expect(tracker.hasPlayedThisAscent).toBe(true);

    // Additional missed floors in same ascent are throttled
    expect(tracker.observe(true)).toBeUndefined();
    expect(tracker.observe(false)).toBeUndefined();
    expect(tracker.observe(true)).toBeUndefined();
  });

  it("MissedFloorCueTracker resets on new ascent, allowing cue to play again", () => {
    const tracker = new MissedFloorCueTracker();
    tracker.observe(true);
    expect(tracker.hasPlayedThisAscent).toBe(true);

    // Reset for new ascent (e.g. after fall/respawn or lap complete)
    tracker.resetAscent();
    expect(tracker.hasPlayedThisAscent).toBe(false);

    // Next missed event plays with new event ID
    const nextCue = tracker.observe(true);
    expect(nextCue).toBeDefined();
    expect(nextCue?.eventId).toContain("1");
  });
});
