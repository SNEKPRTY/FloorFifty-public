// @vitest-environment node
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { describe, expect, it } from "vitest";
import { HitStop } from "../../../../../apps/client/src/features/race/juice/hit-stop";
import { RoomBeats } from "../../../../../apps/client/src/features/race/juice/room-beats";

const landed = (tick: number, id = `${tick}:floorLanded:p1:f3`): RaceEvent =>
  ({ id, tick, type: "floorLanded", playerId: "p1", floorId: "f3", floorIndex: 3 }) as RaceEvent;

describe("HitStop", () => {
  it("freezes for its milliseconds and no longer", () => {
    const stop = new HitStop();
    stop.start(100, 50);
    expect(stop.frozen(99)).toBe(false);
    expect(stop.frozen(120)).toBe(true);
    expect(stop.frozen(150)).toBe(false);
  });

  it("never shortens a freeze already running", () => {
    const stop = new HitStop();
    stop.start(100, 50);
    stop.start(110, 10);
    expect(stop.frozen(140)).toBe(true);
  });

  it("settle ends it at once", () => {
    const stop = new HitStop();
    stop.start(200, 50);
    stop.settle();
    expect(stop.frozen(210)).toBe(false);
  });
});

describe("RoomBeats", () => {
  it("holds a room event until the drawn tick reaches it, and gives it once", () => {
    const beats = new RoomBeats();
    beats.noteAt([landed(30)]);
    beats.noteAt([landed(30)]);
    expect(beats.reach(29)).toEqual([]);
    expect(beats.reach(30)).toEqual([landed(30)]);
    expect(beats.reach(31)).toEqual([]);
  });

  it("refuses a batch delivered again after it was reached", () => {
    const beats = new RoomBeats();
    beats.noteAt([landed(30)]);
    beats.reach(30);
    beats.noteAt([landed(30)]);
    expect(beats.reach(31)).toEqual([]);
  });

  it("gives due events in tick order", () => {
    const beats = new RoomBeats();
    beats.noteAt([landed(32, "b"), landed(30, "a")]);
    expect(beats.reach(40).map((event) => event.id)).toEqual(["a", "b"]);
  });

  it("drops, unanswered, what the picture passed long ago, so a tab back from the background does not flood", () => {
    const beats = new RoomBeats();
    beats.noteAt([landed(10, "old-a"), landed(12, "old-b"), landed(95, "fresh")]);
    expect(beats.reach(100).map((event) => event.id)).toEqual(["fresh"]);
    expect(beats.reach(200)).toEqual([]);
  });

  it("still answers an event a moment behind the picture", () => {
    const beats = new RoomBeats();
    beats.noteAt([landed(90, "late")]);
    expect(beats.reach(100).map((event) => event.id)).toEqual(["late"]);
  });

  it("forgets IDs long behind the drawn tick, so a race does not grow it", () => {
    const beats = new RoomBeats();
    for (let tick = 0; tick < 2_000; tick += 1) {
      beats.noteAt([landed(tick)]);
      beats.reach(tick);
    }
    expect(beats.remembered).toBeLessThanOrEqual(601);
  });
});
