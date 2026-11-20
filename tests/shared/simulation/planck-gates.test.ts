import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { createRaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { TRACE_SEEDS } from "../support/trace";

const tuning = resolveTuning();

/** Climbs a seeded course with the reference controller, through Planck. */
function climb(options: {
  seed: number;
  playerCount: number;
  lapCount: 1 | 3;
  maxSeconds?: number;
  floorCount?: number;
}) {
  const ids = Array.from({ length: options.playerCount }, (_, index) =>
    asPlayerId(`p${index + 1}`),
  );
  const resolved =
    options.floorCount === undefined
      ? tuning
      : resolveTuning({ COURSE_FLOOR_COUNT: options.floorCount });
  const base = createRaceState({
    seed: options.seed,
    lapCount: options.lapCount,
    tuning: resolved,
    players: ids.map((id, index) => ({ id, name: asPlayerName(`Racer ${index + 1}`) })),
  });
  let state: RaceState = { ...base, phase: "racing", raceStartedAtTick: 0 };

  const simulation = createRaceSimulation(state);
  simulation.restore(state);
  const controllers = new Map(ids.map((id) => [id, createClimbController(id)]));
  const budget = TICK_HZ * (options.maxSeconds ?? 300);
  const started = performance.now();

  let ticks = 0;
  for (; ticks < budget; ticks += 1) {
    if (state.phase === "finished") break;
    const inputs = new Map<
      PlayerId,
      ReturnType<ReturnType<typeof createClimbController>["next"]>
    >();
    for (const [id, controller] of controllers) {
      const frame = controller.next(state, ticks + 1);
      if (frame !== undefined) inputs.set(id, frame);
    }
    state = simulation.step({ ...state, tick: state.tick + 1 }, inputs as never).state;
  }
  simulation.dispose();

  return { state, ticks, elapsedMs: performance.now() - started };
}

describe("completability", () => {
  it.each(TRACE_SEEDS)("a bot finishes a one-lap race on seed %i", (seed) => {
    const { state } = climb({ seed, playerCount: 1, lapCount: 1 });
    expect(state.phase).toBe("finished");
  });

  it("a bot finishes a three-lap race", () => {
    const { state } = climb({ seed: 4182, playerCount: 1, lapCount: 3, maxSeconds: 600 });
    expect(state.phase).toBe("finished");
    expect(state.players[asPlayerId("p1")]!.lap).toBe(3);
  });
});

describe("four racers", () => {
  it("resolves a full room with a single winner and a complete standing", () => {
    const { state } = climb({ seed: 13, playerCount: 4, lapCount: 1, maxSeconds: 600 });
    expect(state.winnerId).toBeDefined();
    expect(state.standings[0]).toBe(state.winnerId);
    expect(new Set(state.standings).size).toBe(state.standings.length);
  });
});

describe("headroom", () => {
  it("steps four racers on a hundred-floor course faster than real time", () => {
    const { ticks, elapsedMs } = climb({
      seed: 4182,
      playerCount: 4,
      lapCount: 1,
      floorCount: 100,
      maxSeconds: 60,
    });
    const realTimeMs = (ticks / TICK_HZ) * 1000;
    // Four times faster than the clock it has to keep. A tighter bound would
    // fail on a loaded CI box for reasons that are not the simulation's.
    expect(elapsedMs).toBeLessThan(realTimeMs / 4);
  });
});

describe("replay stability", () => {
  it("produces identical state from identical input in one runtime", () => {
    const a = climb({ seed: 991, playerCount: 2, lapCount: 1 });
    const b = climb({ seed: 991, playerCount: 2, lapCount: 1 });
    expect(b.ticks).toBe(a.ticks);
    expect(b.state.players).toEqual(a.state.players);
    expect(b.state.standings).toEqual(a.state.standings);
  });
});
