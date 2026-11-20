import { describe, expect, it } from "vitest";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput, RaceEvent } from "@floor-fifty/shared/common/protocol";
import { spawnPosition, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import {
  completeAscent,
  completeLaps,
  freshRaceState,
  inputFor,
  noInput,
  playerOf,
} from "../support/race";

const HOLD = 48;

/** Steps a persistent world tick by tick, recording every state and event. */
function run(
  start: RaceState,
  ticks: number,
  inputsAt: (index: number) => ReadonlyMap<PlayerId, HeldInput> = () => noInput(),
): { states: RaceState[]; events: RaceEvent[] } {
  const simulation = createRaceSimulation(start);
  simulation.restore(start);
  const states: RaceState[] = [];
  const events: RaceEvent[] = [];
  let state = start;
  for (let index = 0; index < ticks; index += 1) {
    const result = simulation.step({ ...state, tick: state.tick + 1 }, inputsAt(index));
    state = result.state;
    states.push(state);
    events.push(...result.events);
  }
  simulation.dispose();
  return { states, events };
}

function atSpawnAndStill(state: RaceState): boolean {
  const spawn = spawnPosition(state.course, state.tuning);
  const player = playerOf(state);
  return player.x === spawn.x && player.y === spawn.y && player.vx === 0 && player.vy === 0;
}

describe("the lap hold", () => {
  it("is authored at 48 ticks", () => {
    expect(resolveTuning().LAP_HOLD_TICKS).toBe(HOLD);
  });

  it("holds a racer who completes a non-final lap at the spawn for exactly LAP_HOLD_TICKS ticks, then bounces", () => {
    const lapped = completeAscent(freshRaceState(3)).state;
    const player = playerOf(lapped);
    expect(player.lap).toBe(2);
    expect(player.holdUntilTick).toBe(lapped.tick + HOLD);
    expect(atSpawnAndStill(lapped)).toBe(true);

    const { states } = run(lapped, HOLD + 2);
    // The lap tick itself is the first held state, so 47 more follow it.
    const held = [lapped, ...states].findIndex((state) => !atSpawnAndStill(state));
    expect(held).toBe(HOLD);
    const released = states[HOLD - 1]!;
    expect(playerOf(released).holdUntilTick).toBeUndefined();
    expect(playerOf(released).awaitingInput).toBe(false);
    expect(playerOf(released).y).toBeGreaterThan(spawnPosition(released.course, released.tuning).y);
  });

  it("applies the direction held through the hold on the release tick", () => {
    const lapped = completeAscent(freshRaceState(3)).state;
    const right = inputFor({ right: true });
    const { states } = run(lapped, HOLD, () => right);
    for (const state of states.slice(0, HOLD - 1)) expect(playerOf(state).vx).toBe(0);
    expect(playerOf(states[HOLD - 1]!).vx).toBe(lapped.tuning.MAX_MOVE_SPEED);
    expect(playerOf(states[HOLD - 1]!).facingRight).toBe(true);
  });

  it("a reset during the hold does nothing", () => {
    const lapped = completeAscent(freshRaceState(3)).state;
    // A fresh sequence on each of three ticks, so every one is a first sight.
    const { states, events } = run(lapped, 3, (index) => inputFor({ reset: true, sequence: 10 + index }));
    expect(events.filter((event) => event.type === "playerReset")).toEqual([]);
    for (const state of states) expect(atSpawnAndStill(state)).toBe(true);
  });

  it("does not bank a reset pressed in the hold for the release tick", () => {
    const lapped = completeAscent(freshRaceState(3)).state;
    // One press, held in force as the room holds a frame until a newer one
    // takes over: first seen mid-hold, still the frame on the release tick.
    const { states, events } = run(lapped, HOLD + 3, () => inputFor({ reset: true, sequence: 10 }));
    expect(events.filter((event) => event.type === "playerReset")).toEqual([]);
    const released = states[HOLD - 1]!;
    expect(playerOf(released).y).toBeGreaterThan(spawnPosition(released.course, released.tuning).y);
  });

  it("ignores fast fall during the hold", () => {
    const lapped = completeAscent(freshRaceState(3)).state;
    const { states } = run(lapped, 10, () => inputFor({ fastFall: true }));
    for (const state of states) expect(playerOf(state).vy).toBe(0);
  });

  it("keeps sequencing input during the hold", () => {
    const lapped = completeAscent(freshRaceState(3)).state;
    const { states } = run(lapped, 2, () => inputFor({ right: true, sequence: 7 }));
    expect(playerOf(states[1]!).lastSequence).toBe(7);
  });

  it("emits a lap, and no reset, on a non-final lap: the flicker is a fall's cue only", () => {
    const { events } = completeAscent(freshRaceState(3));
    expect(events.filter((event) => event.type === "lapCompleted")).toHaveLength(1);
    expect(events.filter((event) => event.type === "playerReset")).toEqual([]);
  });

  it("finishes the final lap with no hold", () => {
    const finished = completeLaps(3, freshRaceState(3)).state;
    expect(finished.phase).toBe("finished");
    expect(playerOf(finished).holdUntilTick).toBeUndefined();
  });

  it("holds nothing at LAP_HOLD_TICKS = 0", () => {
    const lapped = completeAscent(freshRaceState(3, resolveTuning({ LAP_HOLD_TICKS: 0 }))).state;
    expect(playerOf(lapped).holdUntilTick).toBeUndefined();
    expect(playerOf(lapped).vy).toBe(lapped.tuning.BOUNCE_VELOCITY);
  });

  it("runs the race clock through the hold", () => {
    const lapped = completeAscent(freshRaceState(3)).state;
    const { states } = run(lapped, HOLD);
    expect(states.at(-1)!.raceStartedAtTick).toBe(lapped.raceStartedAtTick);
    expect(states.at(-1)!.tick).toBe(lapped.tick + HOLD);
  });
});

