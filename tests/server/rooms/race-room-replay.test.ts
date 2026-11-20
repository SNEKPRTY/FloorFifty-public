/**
 * The finished race's replay, delivered (race-options spec §6.4): to every
 * seat at the finish, again on `getReplay`, and never for a race that halted
 * or was left behind by race again.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandResult } from "@floor-fifty/shared/common/protocol";
import { COUNTDOWN_TICKS, TICK_HZ, RECONNECT_GRACE_TICKS } from "@floor-fifty/shared/common/constants";
import { unpackReplay } from "@floor-fifty/shared/replay/compression";
import { stateHash } from "@floor-fifty/shared/replay/state-hash";
import { createReplayStepper } from "@floor-fifty/shared/replay/stepper";
import { driveRoom } from "../../../apps/server/src/rooms/room-driver";
import { zlibCompression } from "../../../apps/server/src/rooms/replay-compression";
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
const refusal = (client: { messages(type: string): unknown[] }): string | undefined => {
  const result = lastResult(client);
  return result.ok ? undefined : result.error.code;
};

describe("the replay, delivered (race-options spec §6.4)", () => {
  it("is sent to every seat at the finish, and re-simulates to the room's result", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Wren");
    await harness.startRace();
    await harness.driveUntilFinished();
    await harness.advanceTicks(3);
    const [bytes] = host.messages("replay") as Uint8Array[];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(guest.messages("replay")).toHaveLength(1);

    const stepper = createReplayStepper(await unpackReplay(bytes!, zlibCompression));
    while (!stepper.done) {
      const { check } = stepper.step();
      if (check !== undefined) expect(check.actual).toBe(check.expected);
    }
    expect(stateHash(stepper.state)).toBe(stateHash(harness.room.raceState));
    expect(stepper.state.winnerId).toBe(harness.room.raceState.winnerId);
    stepper.dispose();
  });

  it("re-simulates a race on an entered seed exactly (stage seeds spec §3.5)", async () => {
    const host = await harness.create("Kite");
    await harness.setReady(host, true);
    await host.pickSeed(424242);
    await harness.passSelect();
    await harness.advanceTicks(COUNTDOWN_TICKS + 1);
    expect(harness.room.raceState.seed).toBe(424242);
    await harness.driveUntilFinished();
    await harness.advanceTicks(3);
    const [bytes] = host.messages("replay") as Uint8Array[];
    const replay = await unpackReplay(bytes!, zlibCompression);
    expect(replay.header.go.seed).toBe(424242);
    const stepper = createReplayStepper(replay);
    while (!stepper.done) {
      const { check } = stepper.step();
      if (check !== undefined) expect(check.actual).toBe(check.expected);
    }
    expect(stateHash(stepper.state)).toBe(stateHash(harness.room.raceState));
    stepper.dispose();
  });

  it("answers getReplay after a reload with the same bytes", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    await harness.driveUntilFinished();
    await harness.advanceTicks(3);
    host.send("getReplay", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(lastResult(host).ok).toBe(true);
    const delivered = host.messages("replay") as Uint8Array[];
    expect(delivered).toHaveLength(2);
    expect(delivered[1]).toEqual(delivered[0]);
  });

  // Audit B2: each request used to queue the whole replay again, tens to
  // hundreds of kilobytes for a 40-byte message.
  it("sends a connection one replay on request, and refuses the second", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    await harness.driveUntilFinished();
    await harness.advanceTicks(3);
    host.send("getReplay", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(lastResult(host).ok).toBe(true);
    // One at the finish, one on request.
    expect(host.messages("replay")).toHaveLength(2);
    for (let again = 0; again < 3; again += 1) {
      host.send("getReplay", { requestId: nextRequestId() });
      await harness.advanceTicks(1);
      expect(refusal(host)).toBe("RATE_LIMITED");
    }
    expect(host.messages("replay")).toHaveLength(2);
  });

  it("sends a reloaded connection its one replay", async () => {
    const host = await harness.create("Kite");
    const token = host.reconnectionToken;
    await harness.startRace();
    await harness.driveUntilFinished();
    await harness.advanceTicks(3);
    host.send("getReplay", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    await harness.drop(host);
    const reloaded = await harness.reconnect(token);
    reloaded.send("getReplay", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(lastResult(reloaded).ok).toBe(true);
    expect(reloaded.messages("replay")).toHaveLength(1);
  });

  it("sends the next race's replay to a connection that already had one", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    await harness.driveUntilFinished();
    await harness.advanceTicks(3);
    host.send("getReplay", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    await harness.startRace();
    await harness.driveUntilFinished();
    await harness.advanceTicks(3);
    host.send("getReplay", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(lastResult(host).ok).toBe(true);
  });

  it("refuses getReplay before any race has finished", async () => {
    const host = await harness.create("Kite");
    host.send("getReplay", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(refusal(host)).toBe("MALFORMED_MESSAGE");
  });

  it("keeps nothing after a halted race", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    harness.breakTheSimulation();
    await harness.advanceTicks(2);
    expect(host.messages("replay")).toEqual([]);
    host.send("getReplay", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(host.messages("replay")).toEqual([]);
    expect(refusal(host)).toBe("MALFORMED_MESSAGE");
  });

  it("forgets the replay on race again", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    await harness.driveUntilFinished();
    await harness.advanceTicks(1);
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    host.send("getReplay", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(refusal(host)).toBe("MALFORMED_MESSAGE");
  });
});

/**
 * The bit-identical cases of race-options spec §10.1, through the real
 * `RaceRoom`: its own `stepOnce`, its own status changes and expiry, every
 * seat steered (audit remediation T1). `replay-recorder.test.ts` keeps the
 * burst-with-reset case, which only its room-like copy can send.
 */
describe("the replay re-simulates the real room exactly (race-options spec §10.1)", () => {
  // Slices with a yield between: driven without one, the loopback socket backs
  // up and queued patch writes alias Colyseus's shared encode buffer, so the
  // harness clients would decode patches that were overwritten.
  const driveAll = async (ticks: number): Promise<void> => {
    for (let left = ticks; left > 0; left -= 2000) {
      driveRoom(harness.room, { roomCode: harness.room.roomId, ticks: Math.min(left, 2000) }, () => harness.room.stepOnce());
      await harness.advanceTicks(0);
    }
  };
  const finish = async (ceiling: number): Promise<void> => {
    await driveAll(ceiling);
    expect(harness.room.raceState.phase).toBe("finished");
    await harness.advanceTicks(3);
  };
  const resimulates = async (client: { messages(type: string): unknown[] }) => {
    const [bytes] = client.messages("replay") as Uint8Array[];
    expect(bytes, "the replay arrived").toBeInstanceOf(Uint8Array);
    const replay = await unpackReplay(bytes!, zlibCompression);
    const stepper = createReplayStepper(replay);
    let checks = 0;
    while (!stepper.done) {
      const { check } = stepper.step();
      if (check === undefined) continue;
      checks += 1;
      expect(check.actual, `check at tick ${stepper.state.tick}`).toBe(check.expected);
    }
    expect(checks).toBeGreaterThan(0);
    expect(stateHash(stepper.state)).toBe(stateHash(harness.room.raceState));
    expect(stepper.state.standings).toEqual(harness.room.raceState.standings);
    stepper.dispose();
    return replay;
  };
  const seat = async (count: number) => {
    const host = await harness.create("Kite");
    const guests = [];
    for (let index = 1; index < count; index += 1) guests.push(await harness.joinById(host.roomId, `Racer ${index + 1}`));
    return { host, guests };
  };

  it("a four-seat, three-lap, twenty-floor race", { timeout: 180_000 }, async () => {
    const { host } = await seat(4);
    host.send("setMode", { requestId: nextRequestId(), modeId: "floors-20" });
    await harness.advanceTicks(1);
    host.send("setLapCount", { requestId: nextRequestId(), lapCount: 3 });
    await harness.advanceTicks(1);
    await harness.startRace();
    expect(harness.room.raceState.lapCount).toBe(3);
    await finish(TICK_HZ * 600);
    await resimulates(host);
  });

  it("a fifty-floor race", { timeout: 180_000 }, async () => {
    const { host } = await seat(2);
    host.send("setMode", { requestId: nextRequestId(), modeId: "floors-50" });
    await harness.advanceTicks(1);
    await harness.startRace();
    expect(harness.room.raceState.course.floorCount).toBe(50);
    await finish(TICK_HZ * 600);
    await resimulates(host);
  });

  it("a Survival race to its end", { timeout: 300_000 }, async () => {
    const { host } = await seat(4);
    host.send("setMode", { requestId: nextRequestId(), modeId: "infinite" });
    await harness.advanceTicks(1);
    await harness.startRace();
    await finish(TICK_HZ * 181);
    // The edge puts the reference bots out by a fall before the course grows
    // (growth is pinned by the shared endless tests, on the widest view); what
    // matters here is that the room's edges and outs replay exactly.
    expect(harness.room.raceState.phase).toBe("finished");
    expect(Object.values(harness.room.raceState.players).some((player) => player.outAtTick !== undefined)).toBe(true);
    await resimulates(host);
  });

  it("a ghost, a reconnect, a leave and an expiry", { timeout: 180_000 }, async () => {
    const { host, guests } = await seat(4);
    const [dropper, leaver, expirer] = guests as [typeof host, typeof host, typeof host];
    host.send("setMode", { requestId: nextRequestId(), modeId: "floors-50" });
    await harness.advanceTicks(1);
    await harness.startRace();
    await driveAll(TICK_HZ);
    await harness.drop(expirer);
    await driveAll(TICK_HZ * 2);
    const token = dropper.reconnectionToken;
    await harness.drop(dropper);
    await driveAll(TICK_HZ * 2);
    await harness.reconnect(token);
    await driveAll(TICK_HZ * 2);
    await harness.leave(leaver);
    await driveAll(RECONNECT_GRACE_TICKS);
    expect(harness.room.raceState.phase).toBe("racing");
    await finish(TICK_HZ * 600);
    const replay = await resimulates(host);
    const statuses = replay.room.map((entry) => entry.status);
    expect(statuses).toEqual(expect.arrayContaining(["ghost", "connected", "dns"]));
    expect(statuses.filter((status) => status === "dns").length).toBeGreaterThanOrEqual(2);
  });
});
