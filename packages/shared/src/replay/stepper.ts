/**
 * Re-simulates a replay through the one simulation there is (race-options
 * spec §7.2). It does what `RaceRoom.stepOnce` did, in its order: the room's
 * status changes for the tick, then the frames in force, then `step`.
 */

import type { PlayerId } from "../common/ids";
import type { HeldInput, RaceEvent } from "../common/protocol";
import { cloneRaceState, type RaceState } from "../common/state";
import { createCourse } from "../level/course";
import { createRaceSimulation } from "../simulation/simulation";
import type { Replay } from "./replay";
import { stateHash } from "./state-hash";

export type ReplayStep = {
  state: RaceState;
  events: readonly RaceEvent[];
  /** On a check tick: the recorded hash against this re-simulation's. */
  check?: { expected: number; actual: number };
};

export type ReplayStepper = {
  readonly state: RaceState;
  readonly done: boolean;
  step(): ReplayStep;
  dispose(): void;
};

/** The state at GO, its floors rebuilt from its seed and tuning. */
export function goStateOf(replay: Replay): RaceState {
  const go = replay.header.go;
  return { ...go, course: createCourse(go.seed, go.tuning) } as RaceState;
}

export function createReplayStepper(replay: Replay): ReplayStepper {
  const go = goStateOf(replay);
  const simulation = createRaceSimulation(go);
  // The room rebuilt its world around the GO state (`beginRacing`); so does this.
  simulation.restore(go);
  let state = go;
  let stepped = false;
  let done = false;
  const inForce = new Map<PlayerId, HeldInput>();
  const cursors = new Map<PlayerId, number>(replay.header.seats.map((seat) => [seat, 0]));
  let room = 0;
  let check = 0;

  return {
    get state() {
      return state;
    },
    get done() {
      return done;
    },
    step(): ReplayStep {
      if (done) return { state, events: [] };
      // GO's own tick is stepped first, as the room steps the state it began
      // racing with on that tick; every later step advances the tick.
      const tick = stepped ? state.tick + 1 : go.tick;
      if (stepped) state = { ...state, tick };
      stepped = true;

      if (replay.room[room]?.tick === tick) {
        state = cloneRaceState(state);
        while (replay.room[room]?.tick === tick) {
          const entry = replay.room[room++]!;
          const player = state.players[entry.playerId];
          if (player !== undefined) player.status = entry.status;
        }
      }
      for (const seat of replay.header.seats) {
        const track = replay.inputs[seat] ?? [];
        let at = cursors.get(seat)!;
        while (track[at]?.tick === tick) {
          const { frame } = track[at++]!;
          if (frame === null) inForce.delete(seat);
          else inForce.set(seat, frame);
        }
        cursors.set(seat, at);
      }

      const result = simulation.step(state, new Map(inForce));
      state = result.state;
      let checked: ReplayStep["check"];
      if (replay.checks[check]?.tick === tick) {
        checked = { expected: replay.checks[check++]!.hash, actual: stateHash(state) };
      }
      if (tick >= replay.finalTick) {
        done = true;
        if (checked === undefined) checked = { expected: replay.finalHash, actual: stateHash(state) };
      }
      return { state, events: result.events, ...(checked === undefined ? {} : { check: checked }) };
    },
    dispose() {
      simulation.dispose();
    },
  };
}
