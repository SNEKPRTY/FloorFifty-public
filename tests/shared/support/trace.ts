/**
 * Recorded races.
 *
 * A trace is an initial state, an input stream, and the semantic outcome the
 * simulation produced for them. It was recorded while there were two solvers
 * and is now a characterization of the contract rather than a comparison:
 * the same seed and the same input stream still produce the same semantic
 * outcome. Nothing here asserts; it records and replays.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { LapCount, PlayerId } from "@floor-fifty/shared/common/ids";
import { asPlayerId, asPlayerName } from "@floor-fifty/shared/common/ids";
import type { HeldInput, RaceEvent } from "@floor-fifty/shared/common/protocol";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { createRaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import type { RaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";

export const TRACE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/traces");

/** Seeds the survey covers: the e2e seed, the fixture seed, and a spread. */
export const TRACE_SEEDS = [13, 4182, 7, 991, 20250920] as const;

export type TraceStep = { tick: number; inputs: Record<string, HeldInput> };

export type TraceOutcome = {
  /** Every event id, in emission order. Exact agreement is required. */
  eventIds: string[];
  /** Per player, the floors credited in credit order. */
  credited: Record<string, string[]>;
  resetReasons: string[];
  laps: Record<string, number>;
  standings: string[];
  winnerId: string | undefined;
  finishedAtTicks: Record<string, number>;
  phase: string;
  /** Final transforms. Compared under a named tolerance, never exactly. */
  transforms: Record<string, { x: number; y: number; vx: number; vy: number }>;
};

export type RaceTrace = {
  seed: number;
  lapCount: LapCount;
  playerIds: string[];
  tickCount: number;
  steps: TraceStep[];
  outcome: TraceOutcome;
};

type TuningOverrides = Parameters<typeof resolveTuning>[0];

function initialState(trace: Pick<RaceTrace, "seed" | "lapCount" | "playerIds">, overrides?: TuningOverrides): RaceState {
  const base = createRaceState({
    seed: trace.seed,
    lapCount: trace.lapCount,
    tuning: resolveTuning(overrides),
    players: trace.playerIds.map((id, index) => ({
      id: asPlayerId(id),
      name: asPlayerName(`Racer ${index + 1}`),
    })),
  });
  return { ...base, phase: "racing", raceStartedAtTick: 0 };
}

export function outcomeOf(state: RaceState, events: readonly RaceEvent[]): TraceOutcome {
  const credited: Record<string, string[]> = {};
  const laps: Record<string, number> = {};
  const finishedAtTicks: Record<string, number> = {};
  const transforms: TraceOutcome["transforms"] = {};

  for (const event of events) {
    if (event.type !== "floorLanded") continue;
    (credited[event.playerId] ??= []).push(event.floorId);
  }
  for (const player of Object.values(state.players)) {
    credited[player.id] ??= [];
    laps[player.id] = player.lap;
    if (player.finishedAtTick !== undefined) finishedAtTicks[player.id] = player.finishedAtTick;
    transforms[player.id] = { x: player.x, y: player.y, vx: player.vx, vy: player.vy };
  }

  return {
    eventIds: events.map((event) => event.id),
    credited,
    resetReasons: events.filter((e) => e.type === "playerReset").map((e) => e.reason),
    laps,
    standings: [...state.standings],
    winnerId: state.winnerId,
    finishedAtTicks,
    phase: state.phase,
    transforms,
  };
}

/**
 * A simulation over a trace's own initial state.
 *
 * `restore` is what makes a fresh simulation usable: the world is built around
 * the state the trace starts from rather than around whatever the constructor
 * was handed.
 */
function simulationFor(trace: Pick<RaceTrace, "seed" | "lapCount" | "playerIds">, overrides?: TuningOverrides): RaceSimulation {
  const initial = initialState(trace, overrides);
  const simulation = createRaceSimulation(initial);
  simulation.restore(initial);
  return simulation;
}

/** Replays a recorded input stream and reports what happened. */
export function replayTrace(trace: RaceTrace, overrides?: TuningOverrides): TraceOutcome {
  const simulation = simulationFor(trace, overrides);
  let state = initialState(trace, overrides);
  const events: RaceEvent[] = [];

  for (const entry of trace.steps) {
    const inputs = new Map<PlayerId, HeldInput>(
      Object.entries(entry.inputs).map(([id, frame]) => [asPlayerId(id), frame]),
    );
    const result = simulation.step({ ...state, tick: entry.tick }, inputs);
    state = result.state;
    events.push(...result.events);
  }
  simulation.dispose();

  return outcomeOf(state, events);
}

/**
 * Records a race the reference controller climbs.
 *
 * The controller is closed-loop -- it reads the state it is steering -- so the
 * input stream it produces belongs to the simulation that answered it. That is
 * why a trace is re-recorded, never edited, when the simulation changes, and
 * why re-recording is a decision a commit message has to state.
 */
export function recordTrace(options: {
  seed: number;
  lapCount: LapCount;
  playerIds: string[];
  maxSeconds?: number;
}): RaceTrace {
  const { seed, lapCount, playerIds } = options;
  const simulation = simulationFor({ seed, lapCount, playerIds });
  let state = initialState({ seed, lapCount, playerIds });
  const controllers = new Map(
    playerIds.map((id) => [asPlayerId(id), createClimbController(asPlayerId(id))] as const),
  );
  const steps: TraceStep[] = [];
  const events: RaceEvent[] = [];
  const budget = TICK_HZ * (options.maxSeconds ?? 300);

  for (let tick = 1; tick <= budget && state.phase !== "finished"; tick += 1) {
    const frames: Record<string, HeldInput> = {};
    const inputs = new Map<PlayerId, HeldInput>();
    for (const [id, controller] of controllers) {
      const frame = controller.next(state, tick);
      if (frame === undefined) continue;
      frames[id] = frame;
      inputs.set(id, frame);
    }
    steps.push({ tick, inputs: frames });
    const result = simulation.step({ ...state, tick }, inputs);
    state = result.state;
    events.push(...result.events);
  }
  simulation.dispose();

  return { seed, lapCount, playerIds, tickCount: steps.length, steps, outcome: outcomeOf(state, events) };
}

export const traceFile = (seed: number, playerCount: number): string =>
  join(TRACE_DIR, `seed-${seed}-p${playerCount}.json`);
