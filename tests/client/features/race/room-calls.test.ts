/**
 * The ready room, heard: arrivals called by colour, the countdown called aloud,
 * and neither called twice.
 */

import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { RoomCalls } from "../../../../apps/client/src/features/race/room-calls";
import { LOCAL_ID, lobbySnapshot, playerSnapshot } from "../../support/snapshots";

const voice = (cues: readonly { alias: string; bus: string }[]) =>
  cues.filter((cue) => cue.bus === "voice").map((cue) => cue.alias);

describe("arrivals", () => {
  it("calls the player's own colour when they first see the room, not a roll call of everyone", () => {
    const calls = new RoomCalls(() => LOCAL_ID);
    // Local is the first seat: scarlet.
    expect(voice(calls.observe(lobbySnapshot(3)))).toEqual(["vo.red"]);
  });

  it("calls the player's own colour, whatever their seat", () => {
    const calls = new RoomCalls(() => LOCAL_ID);
    expect(voice(calls.observe(lobbySnapshot(1, { players: [playerSnapshot({ colour: "gold" })] })))).toEqual(["vo.orange"]);
  });

  it("calls a racer who joins afterwards by their seat's colour, under the join flourish", () => {
    const calls = new RoomCalls(() => LOCAL_ID);
    calls.observe(lobbySnapshot(1));
    const cues = calls.observe(lobbySnapshot(2, { tick: 40 }));
    expect(cues.map((cue) => cue.alias)).toEqual(["ui.join", "vo.blue"]);
  });

  it("says nothing for a room that has not changed", () => {
    const calls = new RoomCalls(() => LOCAL_ID);
    calls.observe(lobbySnapshot(2));
    expect(calls.observe(lobbySnapshot(2, { tick: 1 }))).toEqual([]);
  });

  it("calls the player's own colour once their seat is known, even if the room was seen first", () => {
    let local: typeof LOCAL_ID | undefined;
    const calls = new RoomCalls(() => local);
    expect(voice(calls.observe(lobbySnapshot(1)))).toEqual([]);
    local = LOCAL_ID;
    expect(voice(calls.observe(lobbySnapshot(1, { tick: 1 })))).toEqual(["vo.red"]);
    expect(voice(calls.observe(lobbySnapshot(1, { tick: 2 })))).toEqual([]);
  });

  it("does not call racers who were seated before the lobby opened, only the player arriving", () => {
    const calls = new RoomCalls(() => LOCAL_ID);
    calls.seed(lobbySnapshot(3));
    expect(voice(calls.observe(lobbySnapshot(3, { tick: 1 })))).toEqual(["vo.red"]);
  });
});

describe("the countdown", () => {
  it("is scheduled once, from the ticks left, however many snapshots carry it", () => {
    const calls = new RoomCalls(() => LOCAL_ID);
    calls.observe(lobbySnapshot(2));
    const counting = (tick: number) =>
      lobbySnapshot(2, { tick, phase: "countdown", countdownEndsAtTick: 3 * TICK_HZ });

    const first = calls.observe(counting(0));
    expect(voice(first)).toEqual(["vo.three", "vo.two", "vo.one", "vo.climb"]);
    expect(first.find((cue) => cue.alias === "vo.climb")!.delayMs).toBeCloseTo(3_000);
    expect(calls.observe(counting(3))).toEqual([]);
  });

  it("is called again for the next round's countdown, once the room is back in the lobby", () => {
    const calls = new RoomCalls(() => LOCAL_ID);
    calls.observe(lobbySnapshot(2));
    calls.observe(lobbySnapshot(2, { phase: "countdown", countdownEndsAtTick: 180 }));
    calls.observe(lobbySnapshot(2, { tick: 60, phase: "lobby" }));
    const again = calls.observe(lobbySnapshot(2, { tick: 200, phase: "countdown", countdownEndsAtTick: 380 }));
    expect(voice(again)).toContain("vo.climb");
  });

});
