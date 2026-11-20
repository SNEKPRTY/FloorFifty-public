import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTDOWN_TICKS, RECONNECT_GRACE_TICKS, REVEAL_TICKS, SELECT_STEP_TICKS, TICK_HZ } from "@floor-fifty/shared/common/constants";
import { HELD_GRACE_SECONDS } from "../../../apps/server/src/rooms/clock-hold";
import { createColyseusHarness, type ColyseusHarness } from "../support/colyseus-harness";

let harness: ColyseusHarness;
const race = () => harness.room.raceState;

beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

/** Two seats, both ready: the room is in the stage step. */
async function inStageStep() {
  const host = await harness.create("Kite");
  const guest = await harness.joinById(host.roomId, "Sable");
  await harness.setReady(host, true);
  await harness.setReady(guest, true);
  expect(race().select?.step).toBe("stage");
  return { host, guest };
}

describe("a room whose clocks are held", () => {
  it("keeps a pick step open past its 15 s, and ends it on time once released", async () => {
    await inStageStep();
    harness.room.holdClocks(["stage"]);
    const left = race().select!.endsAtTick - race().tick;
    await harness.advanceTicks(SELECT_STEP_TICKS * 2);
    expect(race().select?.step).toBe("stage");
    expect(race().select!.endsAtTick - race().tick).toBe(left);

    harness.room.holdClocks([]);
    await harness.advanceTicks(SELECT_STEP_TICKS + 1);
    expect(race().select?.step).toBe("stageReveal");
  });

  it("holds only what it was asked to: a held song step does not hold the stage step", async () => {
    await inStageStep();
    harness.room.holdClocks(["song"]);
    await harness.advanceTicks(SELECT_STEP_TICKS + 1);
    expect(race().select?.step).toBe("stageReveal");
  });

  it("still ends a held pick step the moment every seat has locked in", async () => {
    const { host, guest } = await inStageStep();
    harness.room.holdClocks(["stage"]);
    await host.lockIn();
    await guest.lockIn();
    expect(race().select?.step).toBe("stageReveal");
  });

  it("holds the song step the room arrives at, having been told before it got there", async () => {
    const { host, guest } = await inStageStep();
    harness.room.holdClocks(["song"]);
    await host.lockIn();
    await guest.lockIn();
    await harness.advanceTicks(REVEAL_TICKS + 1);
    expect(race().select?.step).toBe("song");
    await harness.advanceTicks(SELECT_STEP_TICKS * 2);
    expect(race().select?.step).toBe("song");
  });

  it("holds the countdown from its first tick, and the race starts when it is let go", async () => {
    const { host, guest } = await inStageStep();
    harness.room.holdClocks(["countdown"]);
    await harness.passSelect();
    expect(race().phase).toBe("countdown");
    await harness.advanceTicks(COUNTDOWN_TICKS * 3);
    expect(race().phase).toBe("countdown");
    expect(race().countdownEndsAtTick! - race().tick).toBe(COUNTDOWN_TICKS);
    // The clients are told the same: ticks left, not a deadline that ran out.
    await vi.waitFor(() => expect(host.state.countdownEndsAtTick - host.state.tick).toBe(COUNTDOWN_TICKS), { timeout: 2_000 });
    expect(guest.state.phase).toBe("countdown");

    harness.room.holdClocks([]);
    await harness.advanceTicks(COUNTDOWN_TICKS + 1);
    expect(race().phase).toBe("racing");
  });

  it("still seats a client that comes back while a step is held, which is why the room is not stopped", async () => {
    const { host, guest } = await inStageStep();
    harness.room.holdClocks(["stage"]);
    const token = guest.reconnectionToken;
    await harness.drop(guest);
    await harness.advanceTicks(SELECT_STEP_TICKS);
    const returned = await harness.reconnect(token);
    expect(returned.sessionPlayerId).toBe(guest.sessionPlayerId);
    expect(race().players[guest.sessionPlayerId]?.status).toBe("connected");
    expect(race().select?.step).toBe("stage");
    expect(host.state.select.step).toBe("stage");
  });

  it("keeps a dropped seat past the usual grace while held, and asks Colyseus to wait as long", async () => {
    const { guest } = await inStageStep();
    harness.room.holdClocks(["stage"]);
    const allow = vi.spyOn(harness.room, "allowReconnection");
    const token = guest.reconnectionToken;
    await harness.drop(guest);
    expect(allow).toHaveBeenCalledWith(expect.anything(), HELD_GRACE_SECONDS);
    // Twice the ghost's usual deadline in room ticks: held, it is still there.
    await harness.advanceTicks(RECONNECT_GRACE_TICKS * 2);
    expect(race().players[guest.sessionPlayerId]?.status).toBe("ghost");
    const returned = await harness.reconnect(token);
    expect(returned.sessionPlayerId).toBe(guest.sessionPlayerId);
    expect(race().players[guest.sessionPlayerId]?.status).toBe("connected");
  });

  it("gives a dropped seat only the usual grace when nothing is held", async () => {
    const { guest } = await inStageStep();
    const allow = vi.spyOn(harness.room, "allowReconnection");
    await harness.drop(guest);
    expect(allow).toHaveBeenCalledWith(expect.anything(), RECONNECT_GRACE_TICKS / TICK_HZ);
  });

  it("lets go of what it holds once nobody connected is left, so an abandoned room closes as it always did", async () => {
    const { host, guest } = await inStageStep();
    harness.room.holdClocks(["stage", "song"]);
    await harness.drop(host);
    await harness.drop(guest);
    await harness.advanceTicks(1);
    expect(harness.room.heldClocks()).toEqual([]);
    // The ghosts' deadlines run again, and the room closes with the last of them.
    await harness.advanceTicks(RECONNECT_GRACE_TICKS + 2);
    await harness.waitForDisposal();
  });

  it("keeps what it holds while one seat is connected, which is a reload with the other player still there", async () => {
    const { host, guest } = await inStageStep();
    harness.room.holdClocks(["stage"]);
    await harness.drop(guest);
    await harness.advanceTicks(RECONNECT_GRACE_TICKS * 2);
    expect(harness.room.heldClocks()).toEqual(["stage"]);
    expect(host.state.select.step).toBe("stage");
  });

  it("reports which clocks it holds", async () => {
    await inStageStep();
    expect(harness.room.heldClocks()).toEqual([]);
    harness.room.holdClocks(["stage", "countdown"]);
    expect(harness.room.heldClocks()).toEqual(["stage", "countdown"]);
    harness.room.holdClocks([]);
    expect(harness.room.heldClocks()).toEqual([]);
  });
});
