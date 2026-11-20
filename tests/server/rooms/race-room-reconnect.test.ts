import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECONNECT_GRACE_TICKS } from "@floor-fifty/shared/common/constants";
import { createColyseusHarness, type ColyseusHarness } from "../support/colyseus-harness";

let harness: ColyseusHarness;

beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

describe("an unexpected drop", () => {
  // The 0.18 SDK retries a dropped socket by itself once the room has been up
  // for five seconds. The harness's clients stand for our client, which turns
  // that off, so a drop after five seconds must still stay a drop.
  it("stays a drop once the room has been up past the SDK's own retry threshold", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await new Promise((resolve) => setTimeout(resolve, 5_200));

    await harness.drop(guest);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await harness.advanceTicks(1);

    expect(host.state.players.get(guest.sessionPlayerId)!.status).toBe("ghost");
  }, 20_000);

  it("turns the player into a reconnectable ghost", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");

    await harness.drop(guest);
    await harness.advanceTicks(1);

    expect(host.state.players.get(guest.sessionPlayerId)!.status).toBe("ghost");
    expect(host.state.players.size).toBe(2);
  });

  it("restores the same seat and race state on reconnect", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await harness.startRace();
    await harness.driveTicks(200);

    const progressBefore = host.state.players.get(guest.sessionPlayerId)!.progress;
    const token = guest.reconnectionToken;
    await harness.drop(guest);
    await harness.advanceTicks(30);

    const resumed = await harness.reconnect(token);
    await resumed.waitForNextPatch();

    expect(resumed.sessionPlayerId).toBe(guest.sessionPlayerId);
    expect(resumed.state.players.get(guest.sessionPlayerId)!.status).toBe("connected");
    expect(resumed.state.players.get(guest.sessionPlayerId)!.progress).toBe(progressBefore);
  });

  it("issues a fresh reconnection token after a successful reconnect", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    const token = guest.reconnectionToken;
    await harness.drop(guest);
    const resumed = await harness.reconnect(token);
    expect(resumed.reconnectionToken).not.toBe(token);
    void host;
  });

  it("gives the whole state to a reconnecting client, not a delta", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    const token = guest.reconnectionToken;
    await harness.drop(guest);
    const resumed = await harness.reconnect(token);
    await resumed.waitForNextPatch();
    expect(resumed.state.players.size).toBe(2);
    expect(resumed.state.seed).toBe(host.state.seed);
    expect(resumed.state.floorCount).toBe(host.state.floorCount);
  });
});

describe("grace expiry", () => {
  it("frees the seat of a lobby player who never returns", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");

    await harness.drop(guest);
    await harness.advanceTicks(RECONNECT_GRACE_TICKS + 1);

    // The room frees the seat on the tick; the host's copy follows on a patch,
    // which a loaded CI machine can deliver a moment after the forced one.
    expect(harness.room.raceState.players[guest.sessionPlayerId]).toBeUndefined();
    await vi.waitFor(() => {
      expect(host.state.players.size).toBe(1);
      expect(host.state.players.get(guest.sessionPlayerId)).toBeUndefined();
    });
  });

  it("makes a racing player a DNS so the results still record them", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await harness.startRace();

    await harness.drop(guest);
    await harness.advanceTicks(RECONNECT_GRACE_TICKS + 1);

    expect(host.state.players.get(guest.sessionPlayerId)!.status).toBe("dns");
  });

  // The rule itself, read at the room so it does not depend on when a client's
  // copy arrives or on the wall clock: the grace is counted in room ticks.
  it("keeps a racing seat a ghost until the grace's last tick, then makes it a DNS", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await harness.startRace();

    await harness.drop(guest);
    const droppedAtTick = harness.room.raceState.tick;
    const guestSeat = () => harness.room.raceState.players[guest.sessionPlayerId]!;

    await harness.advanceTicks(RECONNECT_GRACE_TICKS - 1);
    expect(guestSeat().status).toBe("ghost");

    await harness.advanceTicks(1);
    expect(harness.room.raceState.tick).toBe(droppedAtTick + RECONNECT_GRACE_TICKS);
    expect(guestSeat().status).toBe("dns");
    void host;
  });

  it("refuses a token whose grace has expired", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    const token = guest.reconnectionToken;

    await harness.drop(guest);
    await harness.advanceTicks(RECONNECT_GRACE_TICKS + 1);

    await expect(harness.reconnect(token)).rejects.toThrow();
    void host;
  });

  it("keeps a racing room open while a ghost can still come back", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await harness.startRace();

    await harness.drop(guest);
    await harness.drop(host);
    await harness.advanceTicks(30);

    // Nobody is connected and every seat is a ghost: the room is still the
    // only place those seats exist, so it waits out the window.
    expect(harness.server.getRoomById(harness.room.roomId)).toBeDefined();
  });

  it("closes a racing room once every seat has expired to a DNS", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();

    await harness.drop(host);
    await harness.advanceTicks(RECONNECT_GRACE_TICKS + 1);

    // A racing room whose seats all became DNS has nobody to hold them for.
    await harness.waitForDisposal();
  });

  it("refuses a reconnection token that was never issued", async () => {
    await harness.create("Kite");
    await expect(harness.reconnect("not-a-token")).rejects.toThrow();
  });
});

describe("an explicit leave", () => {
  it("frees the seat immediately and starts no reconnection", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");

    await harness.leave(guest);
    await harness.advanceTicks(1);

    expect(host.state.players.size).toBe(1);
  });

  it("reassigns the host when the host leaves", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");

    await harness.leave(host);
    await harness.advanceTicks(1);
    await guest.waitForNextPatch();

    expect(guest.state.hostId).toBe(guest.sessionPlayerId);
  });

  it("hands the host to a connected player rather than one who dropped", async () => {
    const host = await harness.create("Kite");
    const dropped = await harness.joinById(host.roomId, "Ninja");
    const present = await harness.joinById(host.roomId, "Pip");

    await harness.drop(dropped);
    await harness.leave(host);
    await harness.advanceTicks(1);

    expect(harness.room.raceState.hostId).toBe(present.sessionPlayerId);
  });
});

describe("commands after a reconnect", () => {
  it("answers a reused request id from history and a fresh one by mutating", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");

    guest.send("setReady", { requestId: "c1", ready: true });
    await harness.advanceTicks(1);
    guest.send("setReady", { requestId: "c2", ready: false });
    await harness.advanceTicks(1);

    const token = guest.reconnectionToken;
    await harness.drop(guest);
    const resumed = await harness.reconnect(token);
    await resumed.waitForNextPatch();

    // A reloaded client that restarted at c1 would be answered from history.
    resumed.send("setReady", { requestId: "c1", ready: true });
    await harness.advanceTicks(1);
    expect(host.state.players.get(guest.sessionPlayerId)!.ready).toBe(false);

    // A per-load prefixed id is new to the room, so it mutates.
    resumed.send("setReady", { requestId: "a1b2c3d4-c1", ready: true });
    await harness.advanceTicks(1);
    expect(host.state.players.get(guest.sessionPlayerId)!.ready).toBe(true);
  });
});
