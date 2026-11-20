import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandResult } from "@floor-fifty/shared/common/protocol";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

let harness: ColyseusHarness;
beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

const lastResult = (client: { messages(type: string): unknown[] }): CommandResult =>
  client.messages("commandResult").at(-1) as CommandResult;
const colourOf = (client: { state: { players: { get(id: string): { colour: string } | undefined } } }, id: string) =>
  client.state.players.get(id)!.colour;

async function pick(client: { send(type: string, payload?: unknown): void }, colour: string): Promise<void> {
  client.send("pickColour", { requestId: nextRequestId(), colour });
  await harness.advanceTicks(1);
}

describe("colours in the room", () => {
  it("gives each joiner the first colour nobody holds", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Sable");
    expect(colourOf(host, host.sessionPlayerId)).toBe("scarlet");
    expect(colourOf(host, guest.sessionPlayerId)).toBe("cyan");
  });

  it("gives a joiner the colour they bring, when nobody holds it", async () => {
    const host = await harness.create("Kite", { colour: "violet" });
    const guest = await harness.joinById(host.roomId, "Sable", { colour: "gold" });
    expect(colourOf(host, host.sessionPlayerId)).toBe("violet");
    expect(colourOf(host, guest.sessionPlayerId)).toBe("gold");
  });

  it("gives a joiner the first free colour when the one they bring is held", async () => {
    const host = await harness.create("Kite", { colour: "cyan" });
    const guest = await harness.joinById(host.roomId, "Sable", { colour: "cyan" });
    expect(colourOf(host, guest.sessionPlayerId)).toBe("scarlet");
  });

  it("dresses a player in a free colour, and everyone sees it", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Sable");
    await pick(guest, "gold");
    expect(lastResult(guest).ok).toBe(true);
    expect(colourOf(host, guest.sessionPlayerId)).toBe("gold");
  });

  it("refuses a colour another player holds", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Sable");
    await pick(guest, "scarlet");
    expect((lastResult(guest) as Extract<CommandResult, { ok: false }>).error.code).toBe("MALFORMED_MESSAGE");
    expect(colourOf(host, guest.sessionPlayerId)).toBe("cyan");
  });

  it("the first of two asks wins", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Sable");
    host.send("pickColour", { requestId: nextRequestId(), colour: "violet" });
    guest.send("pickColour", { requestId: nextRequestId(), colour: "violet" });
    await harness.advanceTicks(1);
    expect(colourOf(host, host.sessionPlayerId)).toBe("violet");
    expect(colourOf(host, guest.sessionPlayerId)).toBe("cyan");
  });

  it("a leaver frees their colour for the next joiner", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Sable");
    await harness.leave(guest);
    await harness.advanceTicks(1);
    const next = await harness.joinById(host.roomId, "Wren");
    expect(colourOf(host, next.sessionPlayerId)).toBe("cyan");
  });

  it("a reconnection keeps its colour", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Sable");
    await pick(guest, "violet");
    const token = guest.reconnectionToken;
    await harness.drop(guest);
    await harness.advanceTicks(5);
    const resumed = await harness.reconnect(token);
    await resumed.waitForNextPatch();
    expect(colourOf(resumed, guest.sessionPlayerId)).toBe("violet");
  });

  it("keeps a colour through a race and back to the ready room", async () => {
    const host = await harness.create("Kite");
    await pick(host, "gold");
    await harness.startRace();
    expect(harness.room.raceState.players[host.sessionPlayerId]!.colour).toBe("gold");
    await harness.driveUntilFinished();
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(colourOf(host, host.sessionPlayerId)).toBe("gold");
  });
});
