// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { FLICKER_LOW_ALPHA, RespawnFlicker } from "../../../../apps/client/src/features/race/respawn-flicker";

const reset = (id: string, playerId = "p1"): RaceEvent =>
  ({ id, tick: 10, type: "playerReset", playerId, reason: "fall" }) as RaceEvent;
const lap: RaceEvent = { id: "10:lapCompleted:p1:1", tick: 10, type: "lapCompleted", playerId: "p1", lap: 1 } as RaceEvent;

describe("the respawn flicker", () => {
  it("alternates the body's alpha at 12 Hz for 0.6 s", () => {
    const flicker = new RespawnFlicker();
    flicker.note([reset("10:playerReset:p1:fall")], 1_000);
    const half = 1000 / 12 / 2;
    // Sampled mid-phase: a phase edge is a float, and either side of it is fair.
    expect(flicker.alpha("p1", 1_000 + half * 0.5, false)).toBe(FLICKER_LOW_ALPHA);
    expect(flicker.alpha("p1", 1_000 + half * 1.5, false)).toBe(1);
    expect(flicker.alpha("p1", 1_000 + half * 2.5, false)).toBe(FLICKER_LOW_ALPHA);
    expect(flicker.alpha("p1", 1_600, false)).toBe(1);
  });

  it("holds a steady 50% for 0.6 s under reduced motion", () => {
    const flicker = new RespawnFlicker();
    flicker.note([reset("10:playerReset:p1:fall")], 0);
    for (const at of [0, 100, 300, 599]) expect(flicker.alpha("p1", at, true)).toBe(0.5);
    expect(flicker.alpha("p1", 600, true)).toBe(1);
  });

  it("starts once per event ID: a replayed snapshot, or a predicted reset later confirmed, never restarts it", () => {
    const flicker = new RespawnFlicker();
    flicker.note([reset("10:playerReset:p1:manual")], 0);
    flicker.note([reset("10:playerReset:p1:manual")], 500);
    expect(flicker.alpha("p1", 650, false)).toBe(1);
  });

  it("never plays on a lap", () => {
    const flicker = new RespawnFlicker();
    flicker.note([lap], 0);
    expect(flicker.alpha("p1", 0, false)).toBe(1);
  });

  it("flickers every racer, each on its own clock", () => {
    const flicker = new RespawnFlicker();
    flicker.note([reset("10:playerReset:p1:fall", "p1")], 0);
    flicker.note([reset("40:playerReset:p2:fall", "p2")], 500);
    expect(flicker.alpha("p1", 650, false)).toBe(1);
    expect(flicker.alpha("p2", 510, false)).toBe(FLICKER_LOW_ALPHA);
  });

  it("starts a reset from the room's batch when the drawn moment reaches it, not when the snapshot lands", () => {
    // Remote racers are drawn an interpolation delay behind the newest
    // snapshot: blinking on arrival would blink a racer still falling.
    const flicker = new RespawnFlicker();
    flicker.noteAt([{ ...reset("40:playerReset:p2:fall", "p2"), tick: 40 } as RaceEvent]);
    flicker.reach(36, 1_000);
    expect(flicker.alpha("p2", 1_010, false)).toBe(1);
    flicker.reach(40, 1_100);
    expect(flicker.alpha("p2", 1_110, false)).toBe(FLICKER_LOW_ALPHA);
  });

  it("does not restart a reset the prediction already started when the room's copy is drawn", () => {
    const flicker = new RespawnFlicker();
    flicker.note([reset("40:playerReset:p1:manual")], 0);
    flicker.noteAt([{ ...reset("40:playerReset:p1:manual"), tick: 40 } as RaceEvent]);
    flicker.reach(40, 500);
    expect(flicker.alpha("p1", 650, false)).toBe(1);
  });
});

