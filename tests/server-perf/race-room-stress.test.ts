import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { createColyseusHarness, type ColyseusHarness } from "../server/support/colyseus-harness";

let harness: ColyseusHarness;

beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

describe("a full room at speed", () => {
  it("keeps the sixty hertz loop well inside its budget", async () => {
    const host = await harness.create("Kite");
    for (let index = 1; index < 4; index += 1) {
      await harness.joinById(host.roomId, `Ninja ${index}`);
    }
    await harness.startRace();

    const ticks = TICK_HZ * 30;
    const started = performance.now();
    await harness.driveTicks(ticks);
    const elapsed = performance.now() - started;

    // Four times faster than real time. A tighter bound fails on a loaded CI
    // box for reasons that are not the room's.
    expect(elapsed).toBeLessThan(((ticks / TICK_HZ) * 1000) / 4);
    // And tick by tick: a quarter of the sixty-hertz budget at the 99th
    // percentile, with four racers climbing, measured by the room itself.
    expect(harness.room.telemetry.summary().tickMs.p99).toBeLessThan(4);
  });

  it("agrees with every client on the result", async () => {
    const host = await harness.create("Kite");
    const guests = [];
    for (let index = 1; index < 4; index += 1) {
      guests.push(await harness.joinById(host.roomId, `Ninja ${index}`));
    }
    await harness.startRace();
    await harness.driveUntilFinished();

    for (const client of [host, ...guests]) {
      await client.waitForNextPatch();
      expect(client.state.winnerId).toBe(host.state.winnerId);
      expect([...client.state.standings]).toEqual([...host.state.standings]);
    }
  });
});
