/**
 * In a room, a person who has not pressed anything is not out before they
 * have played (first-race spec §2, audit finding B2): their edge waits for
 * their first input, at most ten seconds, while the computer racers race.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { PlayerState } from "@floor-fifty/shared/common/state";
import { createColyseusHarness, type ColyseusHarness } from "../support/colyseus-harness";

let harness: ColyseusHarness;
const race = () => harness.room.raceState;
const humans = (): PlayerState[] => Object.values(race().players).filter((player) => !player.cpu);
const cpus = (): PlayerState[] => Object.values(race().players).filter((player) => player.cpu);
/** Ticks since GO. */
const elapsed = (): number => race().tick - (race().raceStartedAtTick ?? race().tick);
/** Steps the room, with no input from the human, until `ticks` have passed since GO. */
const stepTo = async (ticks: number): Promise<void> => harness.advanceTicks(Math.max(0, ticks - elapsed()));

beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

describe("a quick-match race, as a first-timer plays it", () => {
  it("a human who has not pressed stands at 0:12 while the CPUs race, and is out by 0:30", async () => {
    // One human seat that sends nothing, three CPUs, the room's default mode (Survival).
    await harness.quickMatch("Kite");
    await harness.startRace();
    expect(race().phase).toBe("racing");
    expect(humans()).toHaveLength(1);
    expect(cpus()).toHaveLength(3);

    await stepTo(12 * TICK_HZ); // the old rule had her out at 0:11
    expect(humans()[0]!.outAtTick).toBeUndefined();
    expect(humans()[0]!.awaitingInput).toBe(true);
    expect(cpus().every((cpu) => (cpu.edgeWaitTicks ?? 0) === 0)).toBe(true);

    // The wait ends at 10 s, the rest runs 3 s, then the edge climbs to her. Trailing three CPUs
    // slows that edge (the rubber band), so out can come as late as about 25 s: step to 30.
    await stepTo(30 * TICK_HZ);
    expect(humans()[0]!.edgeWaitTicks).toBe(600);
    expect(humans()[0]!.outAtTick).toBeGreaterThan(780); // 600 waited + 180 rest
  });

  it("her first press at 0:05 starts the 3-second rest from there", async () => {
    const client = await harness.quickMatch("Kite");
    await harness.startRace();
    await stepTo(300 - 1);
    // The frame takes effect on the next tick, as any input does.
    harness.room.submitInput(
      client.sessionPlayerId,
      { sequence: 1, left: false, right: true, fastFall: false, reset: false, tick: race().tick + 1 },
      false,
    );
    await harness.advanceTicks(2);
    expect(humans()[0]!.awaitingInput).toBe(false);
    expect(humans()[0]!.edgeWaitTicks).toBe(300);
  });
});
