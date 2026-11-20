import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createCpuController } from "@floor-fifty/shared/cpu/controller";
import type { Personality } from "@floor-fifty/shared/cpu/personalities";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";

export const tuning = resolveTuning();

/** Seeds spread over the generator's range, as the completability test's are. */
export const SURVEY = Array.from({ length: 20 }, (_unused, index) => index * 7919 + 13);

export type RacerRun = { finished: boolean; seconds: number; frames: HeldInput[]; score: number };

/**
 * One race with a CPU per personality (or `undefined` for a racer who never
 * touches a control and stays on the start floor). Ends at the first finish,
 * as a race does.
 */
export function race(
  seed: number,
  racers: readonly (Personality | undefined)[],
  maxSeconds = 300,
): RacerRun[] {
  const ids: PlayerId[] = racers.map((_unused, index) => asPlayerId(`cpu${index + 1}`));
  const base = createRaceState({
    seed,
    lapCount: 1,
    tuning,
    players: ids.map((id, index) => ({ id, name: asPlayerName(racers[index]?.name ?? "Parked") })),
  });
  let state: RaceState = { ...base, phase: "racing", raceStartedAtTick: 0 };
  const controllers = racers.map((personality, index) =>
    personality === undefined ? undefined : createCpuController(ids[index]!, personality, seed * 31 + index),
  );
  const frames: HeldInput[][] = ids.map(() => []);
  const simulation = createRaceSimulation(state);
  simulation.restore(state);
  for (let tick = 0; tick < TICK_HZ * maxSeconds && state.phase !== "finished"; tick += 1) {
    const inputs = new Map<PlayerId, HeldInput>();
    controllers.forEach((controller, index) => {
      const frame = controller?.next(state, tick + 1);
      if (frame === undefined) return;
      inputs.set(ids[index]!, frame);
      frames[index]!.push(frame);
    });
    state = simulation.step({ ...state, tick: state.tick + 1 }, inputs).state;
  }
  simulation.dispose();
  return ids.map((id, index) => {
    const finishedAt = state.players[id]!.finishedAtTick;
    const player = state.players[id]!;
    // Floors climbed, laps included: the measure the banding reads (CPU banding spec §2).
    const score = (player.lap - 1) * state.course.floorCount + player.visitedFloorIds.length;
    return { finished: finishedAt !== undefined, seconds: (finishedAt ?? state.tick) / TICK_HZ, frames: frames[index]!, score };
  });
}

export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};

export const count = (frames: readonly HeldInput[], key: "fastFall" | "reset"): number =>
  frames.filter((frame) => frame[key]).length;

/** Frames with no direction held and no fast fall: hands off. */
export const idle = (frames: readonly HeldInput[]): number =>
  frames.filter((frame) => !frame.left && !frame.right && !frame.fastFall && !frame.reset).length;
