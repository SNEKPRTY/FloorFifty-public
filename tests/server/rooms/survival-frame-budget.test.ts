/**
 * The room the frame budget's Survival case races (`tests/e2e/frame-budget.spec.ts`).
 *
 * The case drives one reference bot for 1 000 ticks, expects it to still be
 * racing above floor 12, then keeps it climbing while 120 frames are measured.
 * Those numbers were tuned on Rooftops' authored climb. A stage's seed now
 * defaults to a fresh one each round (stage seeds spec §1), and the draw the
 * e2e server's fixed room seed gives the first round is a course the bot falls
 * off by tick 640 -- so the case picks Classic, and this holds what that pick
 * promises. The browser run needs a GPU and only comes nightly; this runs on
 * every push, so a change to the climb or the edge shows here first.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { driveRoom } from "../../../apps/server/src/rooms/room-driver";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

/** The room seed `pnpm e2e:server` sets (`FLOOR_FIFTY_TEST_SEED`). */
const E2E_ROOM_SEED = 13;

let harness: ColyseusHarness;
beforeEach(async () => {
  harness = await createColyseusHarness(E2E_ROOM_SEED);
});
afterEach(async () => {
  await harness.close();
});

/** What the spec does: Infinite, Ready, Classic on the stage step, then through the select screen to the countdown. */
async function enterSurvival(): Promise<void> {
  const host = await harness.create("Kite");
  host.send("setMode", { requestId: nextRequestId(), modeId: "infinite" });
  await harness.advanceTicks(1);
  await harness.setReady(host, true);
  await host.pickSeed("classic");
  await harness.passSelect();
}

/** Drives the room as the spec's `driveRoom` calls do, and reports the highest floor reached. */
function drive(ticks: number): { phase: string; floor: number } {
  const result = driveRoom(harness.room, { roomCode: harness.room.roomId, ticks }, () => harness.room.stepOnce());
  const best = Math.max(...result.progress.map((racer) => racer.progress));
  return { phase: result.phase, floor: Math.floor(best * 49) };
}

describe("the Survival race the frame budget measures", () => {
  it("has the reference bot past floor 12 at tick 1000 and still in 500 ticks later, on Rooftops' authored climb", async () => {
    await enterSurvival();
    expect(harness.room.raceState.stageId).toBe("rooftops");

    // The first 1 000 ticks include the countdown, as the spec's do.
    drive(500);
    const climbed = drive(500);
    expect(climbed.phase).toBe("racing");
    expect(climbed.floor).toBeGreaterThanOrEqual(12);

    // Measuring takes a second and a half of waiting and 120 frames, with the
    // room stepped by its own clock and by the spec's 3-tick drives: about 450
    // ticks. The bot is in for all of them with room to spare.
    expect(drive(500).phase).toBe("racing");
  });
});
