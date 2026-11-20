import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

let harness: ColyseusHarness;
beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

const classOf = (client: { state: { players: { get(id: string): { deviceClass: string } | undefined } } }, id: string) =>
  client.state.players.get(id)!.deviceClass;

describe("device class in the room (unlockables spec §3)", () => {
  it("stores each seat's class and projects it to everyone", async () => {
    const host = await harness.create("Kite", { deviceClass: "phone" });
    const guest = await harness.joinById(host.roomId, "Sable", { deviceClass: "desktop" });
    await harness.advanceTicks(2);
    expect(classOf(guest, host.sessionPlayerId)).toBe("phone");
    expect(classOf(host, guest.sessionPlayerId)).toBe("desktop");
  });

  it("defaults a seat that sent no class to desktop", async () => {
    const host = await harness.create("Kite");
    await harness.advanceTicks(1);
    expect(classOf(host, host.sessionPlayerId)).toBe("desktop");
  });

  it("refuses a join with an unknown class before a seat exists", async () => {
    const host = await harness.create("Kite");
    await expect(harness.joinById(host.roomId, "Sable", { deviceClass: "fridge" })).rejects.toThrow();
    await harness.advanceTicks(1);
    expect(host.state.players.size).toBe(1);
  });

  it("keeps the class through a race and back to the ready room", async () => {
    const host = await harness.create("Kite", { deviceClass: "tablet" });
    await harness.startRace();
    expect(harness.room.raceState.players[host.sessionPlayerId]!.deviceClass).toBe("tablet");
    await harness.driveUntilFinished();
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(harness.room.raceState.players[host.sessionPlayerId]!.deviceClass).toBe("tablet");
    expect(classOf(host, host.sessionPlayerId)).toBe("tablet");
  });
});
