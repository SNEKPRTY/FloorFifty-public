import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECONNECT_GRACE_TICKS } from "@floor-fifty/shared/common/constants";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { RaceRoom } from "../../../apps/server/src/rooms/race-room";
import { createColyseusHarness, type ColyseusHarness } from "../support/colyseus-harness";

let harness: ColyseusHarness;

beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  RaceRoom.onSimulationFailure = undefined;
  await harness.close();
});

describe("race events", () => {
  it("delivers a batch only after the patch that explains it", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();

    const order: string[] = [];
    await harness.observeOrder(host, (kind) => order.push(kind));
    await harness.driveUntilFirstLanding();

    const firstEvent = order.indexOf("events");
    const patchBefore = order.lastIndexOf("patch", firstEvent);
    expect(firstEvent).toBeGreaterThan(-1);
    expect(patchBefore).toBeGreaterThan(-1);
    expect(patchBefore).toBeLessThan(firstEvent);
  });

  it("gives every event a stable id and never repeats one", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    await harness.driveTicks(300);

    const ids = (host.messages("raceEvents") as RaceEvent[][]).flat().map((event) => event.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not replay cosmetic cues to a client that arrives late", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await harness.startRace();
    await harness.driveTicks(300);

    const late = harness.seatLateArrivalForTest(host.roomId, "Late");
    expect(late.messages("raceEvents")).toHaveLength(0);
    // Progress is durable state, so it arrives with the next patch regardless.
    await harness.advanceTicks(1);
    expect(host.state.players.get(guest.sessionPlayerId)).toBeDefined();
    expect(host.state.players.get(late.playerId)).toBeDefined();
  });

  it("clears its pending batch so a quiet tick sends nothing", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    await harness.driveUntilFirstLanding();
    const before = host.messages("raceEvents").length;
    await harness.advanceTicks(1);
    expect(host.messages("raceEvents").length).toBe(before);
  });
});

describe("simulation failure", () => {
  it("stops the room and reports a typed error to every client", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();

    harness.breakTheSimulation();
    await harness.advanceTicks(1);

    expect(host.messages("serverError").at(-1)).toMatchObject({ code: "SIMULATION_FAILURE" });
    const tick = host.state.tick;
    await harness.advanceTicks(5);
    expect(host.state.tick).toBe(tick);
  });

  it("still closes a halted room once its players have gone", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    harness.breakTheSimulation();
    await harness.advanceTicks(1);

    await harness.drop(host);
    await harness.advanceTicks(RECONNECT_GRACE_TICKS + 1);
    await harness.waitForDisposal();
  });

  it("records a diagnostic carrying no player-identifying value", async () => {
    const diagnostics: unknown[] = [];
    RaceRoom.onSimulationFailure = (diagnostic) => diagnostics.push(diagnostic);

    const host = await harness.create("Kite");
    await harness.startRace();
    harness.breakTheSimulation();
    await harness.advanceTicks(1);

    expect(diagnostics).toHaveLength(1);
    const serialized = JSON.stringify(diagnostics[0]);
    expect(serialized).toContain("seed");
    expect(serialized).toContain("invariant");
    expect(serialized).not.toContain("Kite");
    expect(serialized).not.toContain(host.roomId);
    expect(serialized).not.toContain(host.sessionId);
    expect(Object.keys(diagnostics[0] as object).sort()).toEqual([
      "contentRevision",
      "invariant",
      "rulesetRevision",
      "seed",
      "tick",
    ]);
  });
});
