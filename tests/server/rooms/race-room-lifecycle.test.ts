import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COUNTDOWN_TICKS, MAX_PLAYERS, PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";
import { ROOM_CODE_ALPHABET } from "../../../apps/server/src/rooms/room-code";
import { ABSENT_TICK } from "../../../apps/server/src/rooms/race-room-state";
import {
  contentWithGravity,
  createColyseusHarness,
  nextRequestId,
  type ColyseusHarness,
} from "../support/colyseus-harness";

let harness: ColyseusHarness;

beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

describe("creating a room", () => {
  it("seats the host and publishes a six-character code", async () => {
    const client = await harness.create("Kite");
    expect(client.roomId).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{6}$`));
    await client.waitForNextPatch();
    expect(client.state.players.size).toBe(1);
    expect(client.state.hostId).toBe(client.sessionPlayerId);
    expect(client.state.phase).toBe("lobby");
    expect(client.state.floorCount).toBeGreaterThan(0);
  });

  it("gives a joining client the whole state, not a delta", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await guest.waitForNextPatch();
    expect(guest.state.players.size).toBe(2);
    expect(guest.state.seed).toBe(host.state.seed);
    expect(guest.state.tuning.GRAVITY).toBe(host.state.tuning.GRAVITY);
  });

  it("refuses a fifth player", async () => {
    const host = await harness.create("Kite");
    for (let index = 1; index < MAX_PLAYERS; index += 1) {
      await harness.joinById(host.roomId, `Ninja ${index}`);
    }
    await expect(harness.joinById(host.roomId, "Late")).rejects.toThrow();
  });

  it("refuses a mismatched protocol version before seating anyone", async () => {
    const host = await harness.create("Kite");
    await expect(
      harness.joinById(host.roomId, "Ninja", { protocolVersion: PROTOCOL_VERSION + 1 }),
    ).rejects.toThrow();
    await host.waitForNextPatch();
    expect(host.state.players.size).toBe(1);
  });

  it("refuses a join to a room that is already racing", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    await expect(harness.joinById(host.roomId, "Late")).rejects.toThrow();
  });

  it("says a racing room is racing, not full", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    const refusal = await harness.joinById(host.roomId, "Late").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(String((refusal as Error | undefined)?.message)).toMatch(/already racing/);
    expect(String((refusal as Error | undefined)?.message)).not.toMatch(/locked/);
  });

  it("keeps racing when a racer leaves on purpose mid-race", async () => {
    // A consented leave used to delete the player from the race while their
    // body stayed in the physics world, so the very next tick failed the
    // world's body-count invariant and halted the race for everyone left in
    // it. One player's "leave" button must never end anyone else's race.
    const host = await harness.create("Kite");
    host.send("setMode", { requestId: nextRequestId(), modeId: "floors-20" });
    await harness.advanceTicks(1);
    const guest = await harness.joinById(host.roomId, "Ninja");
    await harness.startRace();
    await harness.driveTicks(30);

    await harness.leave(guest);
    await harness.driveTicks(60);
    await host.waitForNextPatch();

    expect(host.messages("serverError")).toEqual([]);
    expect(host.state.phase).toBe("racing");
    expect(harness.room.raceState.tick).toBeGreaterThan(COUNTDOWN_TICKS + 90);
    // The results must still be able to say they started and did not finish.
    expect(host.state.players.get(guest.sessionPlayerId)?.status).toBe("dns");
  });

  it("reopens a full room that loses a seat during the countdown, refusing a join as racing rather than full", async () => {
    const host = await harness.create("Kite");
    const clients = [host];
    for (let index = 1; index < MAX_PLAYERS; index += 1) {
      clients.push(await harness.joinById(host.roomId, `Ninja ${index}`));
    }
    for (const client of clients) await harness.setReady(client, true);
    await harness.passSelect();
    await harness.leave(clients[3]!);
    await host.waitForNextPatch();

    // No way back to the lobby from the countdown any more (select spec §5.1),
    // but the freed seat unlocks the room, so a joiner hears why it is closed.
    expect(host.state.phase).toBe("countdown");
    const refusal = await harness.joinById(host.roomId, "Late").catch((error: unknown) => error);
    expect(String((refusal as Error).message)).toMatch(/racing|closed/);
  });
});

describe("the room clock", () => {
  it("runs at sixty hertz and patches at twenty", async () => {
    const host = await harness.create("Kite");
    await harness.advanceTicks(60);
    await host.waitForNextPatch();
    expect(host.state.tick).toBeGreaterThanOrEqual(60);
    expect(harness.room.patchRateMs).toBe(50);
  });

  it("opens select when everyone is ready, and refuses un-readying there", async () => {
    const host = await harness.create("Kite");
    await harness.setReady(host, true);
    await host.waitForNextPatch();
    expect(host.state.phase).toBe("select");
    expect(host.state.countdownEndsAtTick).toBe(ABSENT_TICK);

    await harness.setReady(host, false);
    await host.waitForNextPatch();
    expect(host.state.phase).toBe("select");
    expect(host.state.players.get(host.sessionPlayerId)!.ready).toBe(true);
  });

  it("begins racing when the countdown expires", async () => {
    const host = await harness.create("Kite");
    await harness.setReady(host, true);
    await harness.passSelect();
    expect(host.state.phase).toBe("countdown");
    await harness.advanceTicks(COUNTDOWN_TICKS + 1);
    await host.waitForNextPatch();
    expect(host.state.phase).toBe("racing");
    expect(host.state.raceStartedAtTick).toBeGreaterThan(0);
  });

  it("keeps the content a room was created with when the store is replaced", async () => {
    const host = await harness.create("Kite");
    const frozen = host.state.contentRevision;

    // A rebuild of the authored tree reaches later rooms and never this one:
    // a room reads the store once, so the floors cannot move under a race.
    harness.contentStore.replace(contentWithGravity(-300, "b"));
    await harness.advanceTicks(1);
    await host.waitForNextPatch();

    expect(host.state.contentRevision).toBe(frozen);
    expect(host.state.tuning.GRAVITY).toBe(-275);
  });

  it("does not step the simulation outside a race", async () => {
    const host = await harness.create("Kite");
    const y = harness.room.raceState.players[host.sessionPlayerId]!.y;
    await harness.advanceTicks(120);
    expect(harness.room.raceState.players[host.sessionPlayerId]!.y).toBe(y);
  });
});

describe("disposal", () => {
  it("releases the room code when the last seat is gone", async () => {
    const host = await harness.create("Kite");
    const code = host.roomId;
    await harness.leave(host);
    await harness.waitForDisposal();
    expect(await harness.claimedCodes()).not.toContain(code);
  });

  it("disposes of the simulation with the room", async () => {
    await harness.create("Kite");
    const disposed = harness.spyOnSimulationDispose();
    await harness.forceDispose();
    expect(disposed()).toBe(true);
  });
});
