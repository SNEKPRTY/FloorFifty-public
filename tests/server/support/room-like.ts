/**
 * A race run exactly as `RaceRoom.stepOnce` runs one, without a room: frames
 * through a real `InputQueue`, the room's status changes between ticks, and a
 * `ReplayRecorder` fed at the two points the room feeds it. The replay tests
 * build their races here, so a replay is checked against the race that made it.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, type LapCount, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput, PlayerStatus } from "@floor-fifty/shared/common/protocol";
import { cloneRaceState, createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import type { Replay } from "@floor-fifty/shared/replay/replay";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { InputQueue } from "../../../apps/server/src/rooms/input-queue";
import { ReplayRecorder } from "../../../apps/server/src/rooms/replay-recorder";

export const REVISIONS = {
  rulesetRevision: "r".repeat(64),
  courseRevision: "c".repeat(64),
  contentRevision: "t".repeat(64),
} as const;

/** The tick GO falls on in every room-like race: not zero, so tick deltas are tested. */
export const GO_TICK = 400;

export const ids = (count: number): PlayerId[] => Array.from({ length: count }, (_, i) => asPlayerId(`room-p${i + 1}`));

/** Changes the room makes between ticks; returns the race as the step will see it. */
export type Script = (tick: number, race: RaceState, queue: InputQueue) => RaceState;
/** The frames each seat submits; "bots" is the reference controller per seat. */
export type Driver = "bots" | ((tick: number, seat: number) => HeldInput | undefined);

export function runRoomLike(options: {
  tuning: ResolvedTuning;
  seats: number;
  lapCount?: LapCount;
  seed?: number;
  driver?: Driver;
  script?: Script;
  ceiling?: number;
}): { replay: Replay; final: RaceState } {
  const players = ids(options.seats);
  const lobby = createRaceState({
    seed: options.seed ?? 35229,
    lapCount: options.lapCount ?? 1,
    tuning: options.tuning,
    players: players.map((id, i) => ({ id, name: asPlayerName(`Racer ${i + 1}`) })),
  });
  let race: RaceState = {
    ...lobby,
    tick: GO_TICK,
    phase: "racing",
    raceStartedAtTick: GO_TICK,
    stageId: "rooftops",
    songId: "unseen",
  };
  const queue = new InputQueue();
  const recorder = new ReplayRecorder();
  // As `beginRacing` does: the world is rebuilt around the GO state.
  const simulation = createRaceSimulation(race);
  simulation.restore(race);
  recorder.start(race, REVISIONS);
  const controllers = players.map((id) => createClimbController(id));
  const driver = options.driver ?? "bots";
  const ceiling = options.ceiling ?? TICK_HZ * 600;
  let replay: Replay | undefined;

  for (let first = true; replay === undefined; first = false) {
    // GO's own tick is stepped first, as `stepOnce` steps the state
    // `beginRacing` produced on the same tick; every later step advances it.
    const tick = first ? race.tick : race.tick + 1;
    if (tick - GO_TICK > ceiling) throw new Error("the race never finished");
    players.forEach((id, seat) => {
      const frame = driver === "bots" ? controllers[seat]!.next(race, tick) : driver(tick, seat);
      if (frame !== undefined) queue.submit(id, { ...frame, tick }, tick - 1);
    });
    if (!first) race = { ...race, tick };
    race = options.script?.(tick, race, queue) ?? race;
    const inputs = queue.take(tick);
    recorder.beforeStep(race, inputs);
    race = simulation.step(race, inputs).state;
    replay = recorder.afterStep(race);
  }
  simulation.dispose();
  return { replay, final: race };
}

export function setStatus(race: RaceState, id: PlayerId, status: PlayerStatus): RaceState {
  const next = cloneRaceState(race);
  next.players[id]!.status = status;
  return next;
}
