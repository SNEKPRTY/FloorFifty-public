import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

/**
 * Audit S12 (found on 5 October as A04): `removePlayer` kept a leaver as a DNS
 * only while the room was racing; on the results screen it deleted them, while
 * `winnerId` and the standings kept their id. The winner leaving first left the
 * others with no winner, and second place was shown as first. A leaver on the
 * results keeps their row, as a DNS, until Race again prunes it.
 */

let harness: ColyseusHarness;
beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

const finishedRoom = async () => {
  const host = await harness.create("Kite");
  const guest = await harness.joinById(host.roomId, "Ninja");
  host.send("setMode", { requestId: nextRequestId(), modeId: "floors-20" });
  await harness.advanceTicks(1);
  await harness.startRace();
  await harness.driveUntilFinished();
  await harness.advanceTicks(2);
  return { host, guest };
};

describe("leaving the results screen (audit S12)", () => {
  it("keeps the leaver's row, as a DNS, so the standings and the winner still name a racer in the room", async () => {
    const { host, guest } = await finishedRoom();
    const race = harness.room.raceState;
    const winner = race.winnerId!;
    const leaver = winner === host.sessionPlayerId ? host : guest;
    expect(race.standings).toContain(winner);

    await leaver.leave(true);
    await harness.advanceTicks(2);

    const after = harness.room.raceState;
    expect(after.players[winner]).toBeDefined();
    expect(after.players[winner]!.status).toBe("dns");
    expect(after.players[winner]!.finishedAtTick).toBeDefined();
    expect(after.winnerId).toBe(winner);
    expect(after.standings).toEqual(race.standings);
    // Every standing is still a racer the room holds, so no row can go missing.
    for (const id of after.standings) expect(after.players[id as PlayerId]).toBeDefined();
  });

  it("drops the leaver from the next lobby, as every DNS is", async () => {
    const { host, guest } = await finishedRoom();
    const winner = harness.room.raceState.winnerId!;
    const [leaver, stayer] = winner === host.sessionPlayerId ? [host, guest] : [guest, host];
    await leaver.leave(true);
    await harness.advanceTicks(2);

    stayer.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(2);

    const next = harness.room.raceState;
    expect(next.phase).toBe("lobby");
    expect(Object.keys(next.players)).toEqual([stayer.sessionPlayerId]);
  });

  it("still closes the room when the last racer leaves the results", async () => {
    const { host, guest } = await finishedRoom();
    await host.leave(true);
    await guest.leave(true);
    await harness.waitForDisposal();
  });
});
