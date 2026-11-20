import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "@floor-fifty/shared/common/protocol";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";
import { COUNTDOWN_TICKS } from "@floor-fifty/shared/common/constants";

let harness: ColyseusHarness;
beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

const lastResult = (client: { messages(type: string): unknown[] }): CommandResult =>
  client.messages("commandResult").at(-1) as CommandResult;
const EVERYONE = { stages: ["rooftops"], songs: ["chrome-in-the-rain"], characters: ["ninja", "frog", "diver", "robo", "kitsune"] };

describe("characters in the room", () => {
  it("starts every seat as the ninja", async () => {
    const host = await harness.create("Kite");
    expect(host.state.players.get(host.sessionPlayerId)!.characterId).toBe("ninja");
  });

  it("dresses a seat in a body its report grants", async () => {
    const host = await harness.create("Kite", { access: EVERYONE });
    await host.pickCharacter("frog");
    expect(host.state.players.get(host.sessionPlayerId)!.characterId).toBe("frog");
    expect(lastResult(host).ok).toBe(true);
  });

  it("refuses a body the seat has no access to", async () => {
    const host = await harness.create("Kite"); // no report: the open set, the ninja alone
    await host.pickCharacter("robo");
    const result = lastResult(host) as Extract<CommandResult, { ok: false }>;
    expect(result.error.code).toBe("MALFORMED_MESSAGE");
    expect(host.state.players.get(host.sessionPlayerId)!.characterId).toBe("ninja");
  });

  it("reportAccess drops a character the seat no longer has", async () => {
    const host = await harness.create("Kite", { access: EVERYONE });
    await host.pickCharacter("robo");
    host.send("reportAccess", { requestId: nextRequestId(), access: { stages: [], songs: [], characters: ["ninja", "ghost"] } });
    await harness.advanceTicks(1);
    expect(host.state.players.get(host.sessionPlayerId)!.characterId).toBe("ninja");
  });

  it("keeps a body through a race and back to the ready room", async () => {
    const host = await harness.create("Kite", { access: EVERYONE });
    await host.pickCharacter("diver");
    await harness.startRace();
    expect(harness.room.raceState.round).toBe(1);
    await harness.driveUntilFinished();
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(host.state.phase).toBe("lobby");
    expect(host.state.players.get(host.sessionPlayerId)!.characterId).toBe("diver");
  });

  it("resolves ? by the time the race starts", async () => {
    const host = await harness.create("Kite", { access: EVERYONE });
    await host.pickCharacter("?");
    await harness.setReady(host, true);
    // Select opens with every ? already a body (select spec §5.2).
    expect(EVERYONE.characters).toContain(harness.room.raceState.players[host.sessionPlayerId]!.characterId);
    await harness.passSelect();
    await harness.advanceTicks(COUNTDOWN_TICKS + 1);
    // Layer by layer, so a failure says where: the room's own race, then the wire.
    const race = harness.room.raceState;
    expect({ phase: race.phase, tick: race.tick, endsAt: race.countdownEndsAtTick }).toMatchObject({ phase: "racing" });
    expect(EVERYONE.characters).toContain(race.players[host.sessionPlayerId]!.characterId);
    // The race's first patch carries the whole rebuilt race, so on a loaded
    // runner it can land after the room has broadcast it: wait for the client
    // to see the race, then read what it drew.
    await vi.waitFor(() => expect(host.state.phase).toBe("racing"), { timeout: 2_000 });
    expect(EVERYONE.characters).toContain(host.state.players.get(host.sessionPlayerId)!.characterId);
  });
});
