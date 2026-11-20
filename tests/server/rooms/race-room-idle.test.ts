import { afterEach, describe, expect, it } from "vitest";
import { ROOM_IDLE_TICKS } from "@floor-fifty/shared/common/constants";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

/**
 * The production audit's B1: a room with a connected player never expired, so
 * a tab left on a lobby or a results screen held a room slot for ever. The
 * deadline is counted in the room's own ticks, short here so no test steps ten
 * minutes of them.
 */

// Longer than a select step, so a race can be reached without the deadline ending the room first.
const IDLE = 1200;
let harness: ColyseusHarness;

const open = async (): Promise<ColyseusHarness> => {
  harness = await createColyseusHarness(4182, { roomIdleTicks: IDLE });
  return harness;
};
afterEach(async () => {
  await harness.close();
});

/** A twenty-floor race, which ends only when someone finishes it, so a quiet racer leaves it running. */
const startQuietRace = async (host: { send(type: string, payload?: unknown): void }): Promise<void> => {
  host.send("setMode", { requestId: nextRequestId(), modeId: "floors-20" });
  await harness.advanceTicks(1);
  await harness.startRace();
};

const roomIsLive = (): boolean => harness.server.getRoomById(harness.room.roomId) !== undefined;

describe("a room nobody is using", () => {
  it("uses ROOM_IDLE_TICKS unless told otherwise", async () => {
    harness = await createColyseusHarness();
    await harness.create("Kite");
    expect(harness.room.idleTicks).toBe(ROOM_IDLE_TICKS);
  });

  it("closes a lobby that hears no command for the idle deadline, and says why", async () => {
    await open();
    const host = await harness.create("Kite");
    await harness.advanceTicks(IDLE + 1);
    await harness.waitForDisposal();
    expect(host.messages("serverError")).toEqual([
      expect.objectContaining({ code: "ROOM_CLOSED", message: expect.stringContaining("nobody was using") }),
    ]);
  });

  it("is kept open by a command, for another whole deadline", async () => {
    await open();
    const host = await harness.create("Kite");
    await harness.advanceTicks(IDLE - 10);
    host.send("setReady", { requestId: nextRequestId(), ready: true });
    await harness.advanceTicks(IDLE - 10);
    expect(roomIsLive()).toBe(true);
    await harness.advanceTicks(20);
    await harness.waitForDisposal();
  });

  it("is not kept open by a socket that does nothing", async () => {
    await open();
    await harness.create("Kite");
    await harness.advanceTicks(IDLE - 10);
    expect(roomIsLive()).toBe(true);
    await harness.advanceTicks(20);
    await harness.waitForDisposal();
  });

  it("closes a results screen nobody leaves, counted from the finish", async () => {
    await open();
    await startQuietRace(await harness.create("Kite"));
    // However long the race took, the results screen has its own whole deadline.
    await harness.advanceTicks(IDLE * 2);
    expect(roomIsLive()).toBe(true);
    harness.room.finishForTest();
    await harness.advanceTicks(IDLE - 10);
    expect(roomIsLive()).toBe(true);
    await harness.advanceTicks(20);
    await harness.waitForDisposal();
  });

  it("never closes a race in progress, however quiet the room", async () => {
    await open();
    await startQuietRace(await harness.create("Kite"));
    await harness.advanceTicks(IDLE * 2);
    expect(harness.room.raceState.phase).toBe("racing");
    expect(roomIsLive()).toBe(true);
  });

  it("closes a halted room, whose race is stopped for good", async () => {
    await open();
    await harness.create("Kite");
    await harness.startRace();
    harness.breakTheSimulation();
    await harness.advanceTicks(1);
    await harness.advanceTicks(IDLE + 1);
    await harness.waitForDisposal();
  });
});
