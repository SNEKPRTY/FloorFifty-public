/**
 * The endless course (race-options spec §5.3–5.4).
 *
 * The simulation knows a course is endless by its clock: the content
 * validator ties `course = "endless"` to a positive `RACE_TIME_LIMIT_TICKS`,
 * and a step reads tuning, never a mode.
 *
 * It grows at the top, ahead of the leader, and only the floors near a racer
 * have a body. Both are pure functions of state, so the room, prediction and
 * a replay grow and window on the same ticks.
 */

import { ENDLESS_FLOOR_CAP, FLOOR_WINDOW_ABOVE, FLOOR_WINDOW_BELOW } from "../common/constants";
import type { PlayerState, RaceState } from "../common/state";
import type { ResolvedTuning } from "../common/tuning";
import { extendCourse, type Floor } from "../level/course";
import { SimulationInvariantError } from "./planck/consequences";

export function isEndless(tuning: ResolvedTuning): boolean {
  return tuning.RACE_TIME_LIMIT_TICKS > 0;
}

/**
 * The floor a height is above: `floor(y / FLOOR_GAP_MIN)`, clamped to the
 * course. Floor 0 is at y 0 (`startingFloor`). Each floor's own y is a sum of
 * gaps, so exactly at it this may read the floor below; a racer is always
 * at least half a floor clear of the surface it stands on.
 */
export function floorIndexAt(y: number, tuning: ResolvedTuning, floorCount: number): number {
  return Math.min(floorCount - 1, Math.max(0, Math.floor(y / tuning.FLOOR_GAP_MIN)));
}

/** Who holds the window open and leads the growth: everyone still climbing, ghosts included. */
function climbing(state: RaceState): PlayerState[] {
  return Object.values(state.players).filter((player) => player.status !== "dns" && player.finishedAtTick === undefined);
}

/**
 * Extends an endless course until its top is `FLOOR_WINDOW_ABOVE` above the
 * leader, giving each new moving floor its live state at its generated x.
 * Mutates the (cloned) state a step owns; a finite course is left alone.
 */
export function growCourse(state: RaceState): void {
  if (!isEndless(state.tuning)) return;
  const racers = climbing(state);
  if (racers.length === 0) return;

  const leader = Math.max(...racers.map((player) => floorIndexAt(player.y, state.tuning, state.course.floorCount)));
  // One floor more than the window: growth reads the positions the tick began
  // at, and the leader may cross into the next floor during it (never two:
  // `endless-window.test.ts`), so the top is still FLOOR_WINDOW_ABOVE clear after.
  const wanted = leader + FLOOR_WINDOW_ABOVE + 1;
  if (wanted < state.course.floorCount) return;
  if (wanted >= ENDLESS_FLOOR_CAP) throw new SimulationInvariantError("endless-floor-cap", state.seed, state.tick);

  const before = state.course.floorCount;
  state.course = extendCourse(state.course, state.tuning, wanted);
  // `state` is the step's own clone, and `cloneRaceState` made its
  // `movingFloors` afresh, so new entries go straight in. The course itself is
  // shared with the state it came from, which prediction still holds, so it is
  // replaced, never appended to.
  for (const floor of state.course.floors.slice(before)) {
    if (floor.kind !== "moving") continue;
    state.movingFloors[floor.id] = { id: floor.id, x: floor.x, direction: floor.direction, speed: floor.speed };
  }
}

/**
 * The floor indices that have a body: within the window of some racer still
 * climbing, ascending. At most four ranges, merged in place, so a step
 * allocates one small array rather than a set and a sort (audit remediation D-R9).
 */
export function floorWindow(state: RaceState): number[] {
  const top = state.course.floorCount - 1;
  const ranges: [number, number][] = [];
  for (const player of climbing(state)) {
    const at = floorIndexAt(player.y, state.tuning, state.course.floorCount);
    // A freed floor never comes back (survival spec §6).
    const from = Math.max(state.freedBelow, at - FLOOR_WINDOW_BELOW);
    const to = Math.min(top, at + FLOOR_WINDOW_ABOVE);
    if (from <= to) ranges.push([from, to]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const indices: number[] = [];
  let next = 0;
  for (const [from, to] of ranges) {
    for (let index = Math.max(from, next); index <= to; index += 1) indices.push(index);
    next = Math.max(next, to + 1);
  }
  return indices;
}

/**
 * A racer's progress through the climb, 0 to 1, which the horizon and the
 * city read. A finite course counts this ascent's floors; an endless one
 * counts the best floor against its starting height, so the city's arc ends
 * at floor 49 and holds there.
 */
export function progressOf(state: RaceState, player: PlayerState): number {
  if (!isEndless(state.tuning)) return player.visitedFloorIds.length / state.course.floorCount;
  return Math.min(1, player.bestFloor / (state.tuning.COURSE_FLOOR_COUNT - 1));
}

/**
 * Frees every floor more than one gap below the lowest standing racer's edge
 * (survival spec §6): no racer can reach it again, so it loses its motion
 * here and its body and its view with the window. `freedBelow` never lowers.
 */
export function freeFloorsBelow(state: RaceState): void {
  if (!isEndless(state.tuning)) return;
  const standing = climbing(state);
  if (standing.length === 0) return;
  const low = Math.min(...standing.map((player) => player.floorEdgeY)) - state.tuning.FLOOR_GAP_MAX;
  const floors = state.course.floors;
  let index = state.freedBelow;
  while (index < floors.length - 1 && floors[index]!.y < low) {
    delete state.movingFloors[floors[index]!.id];
    index += 1;
  }
  state.freedBelow = index;
}

/** The floors that have a body and reach a snapshot: all of a finite course, the window of an endless one. */
export function liveFloors(state: RaceState): readonly Floor[] {
  if (!isEndless(state.tuning)) return state.course.floors;
  return floorWindow(state).map((index) => state.course.floors[index]!);
}
