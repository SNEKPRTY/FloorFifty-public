/**
 * Infinite's cost as the climb goes on (audit remediation D-R9).
 *
 * A step at about 200 floors must cost no more than 1.25x a step at the start,
 * as a median over 600 ticks, and a real four-seat Infinite room keeps the
 * race's own tick p99 above floor 50. Timing, so it runs alone in the perf
 * suite (`pnpm test:perf`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { GENERATED_CONTENT } from "../../apps/server/src/content/generated-content";
import { driveRoom } from "../../apps/server/src/rooms/room-driver";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../server/support/colyseus-harness";
import { ENDLESS_TUNING, endlessRaceState } from "../shared/support/race";

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

describe("Infinite's step cost (audit remediation D-R9)", () => {
  it("costs no more at about 200 floors than at the start", { timeout: 240_000 }, () => {
    // The widest view, so the reference bots climb past 150 floors before a fall puts them out (survival spec §3).
    const start = endlessRaceState(4, 35229, ENDLESS_TUNING({ SURVIVAL_VIEW_HEIGHT: 1200, SURVIVAL_PUSH_AT: 0.9 }));
    const ids = Object.keys(start.players) as PlayerId[];
    const controllers = new Map(ids.map((id) => [id, createClimbController(id)]));
    const simulation = createRaceSimulation(start);
    simulation.restore(start);
    let state: RaceState = start;
    const times: number[] = [];
    for (let tick = 0; tick < TICK_HZ * 180 && state.phase === "racing"; tick += 1) {
      const inputs = new Map<PlayerId, HeldInput>();
      for (const [id, controller] of controllers) {
        const input = controller.next(state, tick + 1);
        if (input !== undefined) inputs.set(id, input);
      }
      const began = performance.now();
      state = simulation.step({ ...state, tick: state.tick + 1 }, inputs).state;
      times.push(performance.now() - began);
    }
    simulation.dispose();
    const early = median(times.slice(TICK_HZ * 5, TICK_HZ * 15));
    const late = median(times.slice(-TICK_HZ * 10));
    console.log(`endless step: early ${early.toFixed(4)} ms, late ${late.toFixed(4)} ms at ${state.course.floorCount} floors`);
    expect(state.course.floorCount).toBeGreaterThan(150);
    expect(late).toBeLessThanOrEqual(early * 1.25);
  });
});

describe("a real four-seat Infinite room (audit remediation D-R9)", () => {
  let harness: ColyseusHarness;
  beforeEach(async () => {
    // Survival's widest view, so the reference bots climb past floor 60 before
    // a fall puts them out: the cost being held is a tall course's, not the edge's.
    const shipped = GENERATED_CONTENT;
    const content = {
      ...shipped,
      content: {
        ...shipped.content,
        modes: shipped.content.modes.map((mode) =>
          mode.id === "infinite" ? { ...mode, tuning: { ...mode.tuning, SURVIVAL_VIEW_HEIGHT: 1200, SURVIVAL_PUSH_AT: 0.9 } } : mode,
        ),
      },
    };
    harness = await createColyseusHarness(4182, { content });
  });
  afterEach(async () => {
    await harness.close();
  });

  it("keeps its tick p99 under 4 ms above floor 50", { timeout: 240_000 }, async () => {
    const host = await harness.create("Kite");
    for (let index = 1; index < 4; index += 1) await harness.joinById(host.roomId, `Ninja ${index}`);
    host.send("setMode", { requestId: nextRequestId(), modeId: "infinite" });
    await harness.advanceTicks(1);
    await harness.startRace();
    // Sliced with a yield between, so queued patches do not alias Colyseus's
    // shared encode buffer; the timing read below is telemetry's per-tick ms.
    for (let left = TICK_HZ * 170; left > 0; left -= 2000) {
      driveRoom(harness.room, { roomCode: harness.room.roomId, ticks: Math.min(left, 2000) }, () => harness.room.stepOnce());
      await harness.advanceTicks(0);
    }
    const tickMs = harness.room.telemetry.summary().tickMs;
    console.log(`endless room tick: p99 ${tickMs.p99.toFixed(3)} ms at ${harness.room.raceState.course.floorCount} floors`);
    expect(harness.room.raceState.course.floorCount).toBeGreaterThan(60);
    expect(tickMs.p99).toBeLessThan(4);
  });
});
