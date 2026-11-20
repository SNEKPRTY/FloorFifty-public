// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RACE_HINT_MS, currentHint, hintsSpent, raceHints } from "../../../../apps/client/src/features/race/race-hints";

// Which one-time hints a race shows, and when (first-race spec parts 4 and 5).
const fresh = { edgeLine: false, climbHints: false };
const race = { replay: false, seated: true, coachDue: false, seen: fresh };

describe("which hints a race shows", () => {
  it("names the lava once, in a first Survival race without the swipe coach", () => {
    expect(raceHints({ ...race, endless: true })).toEqual(["edge"]);
    expect(raceHints({ ...race, endless: true, seen: { ...fresh, edgeLine: true } })).toEqual(["rotate"]);
  });

  it("teaches the floors, then the restart, in a first 20- or 50-floor race", () => {
    expect(raceHints({ ...race, endless: false })).toEqual(["floors", "restart"]);
    expect(raceHints({ ...race, endless: false, seen: { ...fresh, climbHints: true } })).toEqual(["rotate"]);
  });

  it("lets the swipe coach have its race; the others wait for the next", () => {
    expect(raceHints({ ...race, endless: false, coachDue: true })).toEqual(["swipe"]);
    expect(raceHints({ ...race, endless: true, coachDue: true })).toEqual(["swipe"]);
  });

  it("shows nothing on a replay", () => {
    expect(raceHints({ ...race, endless: true, replay: true })).toEqual([]);
    expect(raceHints({ ...race, endless: false, replay: true })).toEqual([]);
  });

  it("shows nothing to a watcher with no seat, in either kind of race", () => {
    expect(raceHints({ ...race, endless: true, seated: false })).toEqual([]);
    expect(raceHints({ ...race, endless: false, seated: false, coachDue: true })).toEqual([]);
  });
});

describe("which hint is on screen", () => {
  const queue = ["floors", "restart"] as const;

  it("holds the first hint until 6 s after her first input, then the next, then none", () => {
    expect(RACE_HINT_MS).toBe(6000);
    expect(currentHint(queue, undefined, false)).toBe("floors");
    expect(currentHint(queue, 0, false)).toBe("floors");
    expect(currentHint(queue, 5999, false)).toBe("floors");
    expect(currentHint(queue, 6000, false)).toBe("restart");
    expect(currentHint(queue, 11999, false)).toBe("restart");
    expect(currentHint(queue, 12000, false)).toBeUndefined();
  });

  it("says when every timed hint has had its time, and not before her first input", () => {
    expect(hintsSpent(queue, undefined)).toBe(false);
    expect(hintsSpent(queue, 11999)).toBe(false);
    expect(hintsSpent(queue, 12000)).toBe(true);
    expect(hintsSpent(["edge"], 6000)).toBe(true);
  });

  it("holds the swipe coach and the rotate hint until she is out, as today, and never spends them", () => {
    expect(currentHint(["swipe"], undefined, false)).toBe("swipe");
    expect(currentHint(["swipe"], 600_000, false)).toBe("swipe");
    expect(currentHint(["rotate"], 600_000, false)).toBe("rotate");
    expect(hintsSpent(["swipe"], 600_000)).toBe(false);
    expect(hintsSpent(["rotate"], 600_000)).toBe(false);
  });

  it("has nothing to show or to spend for an empty queue", () => {
    expect(currentHint([], 0, false)).toBeUndefined();
    expect(hintsSpent([], 0)).toBe(false);
  });

  it("clears the slot when she is out, whatever was showing", () => {
    expect(currentHint(["edge"], 100, true)).toBeUndefined();
    expect(currentHint(["swipe"], undefined, true)).toBeUndefined();
    expect(currentHint(["rotate"], undefined, true)).toBeUndefined();
  });
});
