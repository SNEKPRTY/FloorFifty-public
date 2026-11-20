/**
 * An endless course grows at the top, ahead of its leader (race-options spec
 * §5.3), from the same generator, so it stays prefix-stable.
 */
import { describe, expect, it } from "vitest";
import { ENDLESS_FLOOR_CAP, FLOOR_WINDOW_ABOVE } from "@floor-fifty/shared/common/constants";
import { asPlayerId, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import { cloneRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createCourse, extendCourse } from "@floor-fifty/shared/level/course";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { floorIndexAt, growCourse } from "@floor-fifty/shared/simulation/endless";
import { SimulationInvariantError } from "@floor-fifty/shared/simulation/planck/consequences";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { ENDLESS_TUNING, endlessRaceState, freshRaceState, placeAtFloor } from "../support/race";

const STAGE_SEEDS = [35229, 34528, 107255];
const P1 = asPlayerId("p1");

/** Steps a climb with one controller per racer; calls `each` after every step. */
function climb(start: RaceState, ticks: number, each: (state: RaceState) => void = () => {}): RaceState {
  const ids = Object.keys(start.players) as PlayerId[];
  const controllers = new Map(ids.map((id) => [id, createClimbController(id)]));
  const simulation = createRaceSimulation(start);
  simulation.restore(start);
  let state = start;
  for (let tick = 0; tick < ticks && state.phase === "racing"; tick += 1) {
    const inputs = new Map<PlayerId, HeldInput>();
    for (const [id, controller] of controllers) {
      const input = controller.next(state, tick + 1);
      if (input !== undefined) inputs.set(id, input);
    }
    state = simulation.step({ ...state, tick: state.tick + 1 }, inputs).state;
    each(state);
  }
  simulation.dispose();
  return state;
}

describe("an endless course (race-options spec §5.3)", () => {
  it.each(STAGE_SEEDS)("seed %i: grown to 200, its first 50 floors are the 50-floor course and its first 20 the 20-floor one", (seed) => {
    const tuning = ENDLESS_TUNING();
    const grown = extendCourse(createCourse(seed, tuning), tuning, 199);
    expect(grown.floorCount).toBe(200);
    expect(grown.floors.slice(0, 50)).toEqual(createCourse(seed, resolveTuning({ COURSE_FLOOR_COUNT: 50 })).floors);
    expect(grown.floors.slice(0, 20)).toEqual(createCourse(seed, resolveTuning()).floors);
  });

  it("chains each appended floor's y from the one below", () => {
    const tuning = ENDLESS_TUNING();
    const grown = extendCourse(createCourse(35229, tuning), tuning, 80);
    for (let i = 1; i < grown.floors.length; i += 1) {
      expect(grown.floors[i]!.y).toBe(grown.floors[i - 1]!.y + tuning.FLOOR_GAP_MIN);
    }
  });

  it("keeps its top at least FLOOR_WINDOW_ABOVE above the leader on every tick, and grows past 50", () => {
    const end = climb(endlessRaceState(1), 60 * 60, (state) => {
      const leader = floorIndexAt(state.players[P1]!.y, state.tuning, state.course.floorCount);
      expect(state.course.floorCount - 1).toBeGreaterThanOrEqual(leader + FLOOR_WINDOW_ABOVE);
    });
    expect(end.course.floorCount).toBeGreaterThan(50);
  });

  it("extends on the same ticks in two runs from the same state and inputs", () => {
    const growths = (): number[] => {
      const ticks: number[] = [];
      let height = 50;
      climb(endlessRaceState(2), 60 * 60, (state) => {
        if (state.course.floorCount !== height) ticks.push(state.tick);
        height = state.course.floorCount;
      });
      return ticks;
    };
    const first = growths();
    expect(first.length).toBeGreaterThan(0);
    expect(growths()).toEqual(first);
  });

  it("gives a new moving floor its movingFloors entry at its generated x", () => {
    const state = cloneRaceState(placeAtFloor(endlessRaceState(1), P1, 49));
    growCourse(state);
    // The leader is on floor 49, so the top becomes 49 + FLOOR_WINDOW_ABOVE + 1: floors 50 to 58.
    const added = state.course.floors.slice(50);
    expect(added.length).toBe(FLOOR_WINDOW_ABOVE + 1);
    expect(added.some((floor) => floor.kind === "moving")).toBe(true);
    for (const floor of added.filter((f) => f.kind === "moving")) {
      expect(state.movingFloors[floor.id]).toEqual({ id: floor.id, x: floor.x, direction: floor.direction, speed: floor.speed });
    }
  });

  it("refuses to grow to ENDLESS_FLOOR_CAP", () => {
    const tuning = ENDLESS_TUNING();
    const base = endlessRaceState(1);
    const tall = { ...base, course: extendCourse(base.course, tuning, ENDLESS_FLOOR_CAP - 5) };
    const state = cloneRaceState(placeAtFloor(tall, P1, ENDLESS_FLOOR_CAP - 5));
    expect(() => growCourse(state)).toThrow(SimulationInvariantError);
    expect(() => growCourse(state)).toThrow(/endless-floor-cap/);
  });

  it("never grows a finite course", () => {
    const start = freshRaceState();
    const end = climb(start, 600);
    expect(end.course).toBe(start.course);
  });
});
