/**
 * An endless course's floor bodies follow the racers (race-options spec §5.4):
 * only floors near someone have a body, and the window is the same whether a
 * world was stepped there or rebuilt there.
 */
import { describe, expect, it } from "vitest";
import { FLOOR_WINDOW_ABOVE, FLOOR_WINDOW_BELOW, TICK_SECONDS } from "@floor-fifty/shared/common/constants";
import { asPlayerId, type PlayerId } from "@floor-fifty/shared/common/ids";
import { cloneRaceState } from "@floor-fifty/shared/common/state";
import { TUNABLES } from "@floor-fifty/shared/common/tuning";
import { extendCourse } from "@floor-fifty/shared/level/course";
import { floorWindow } from "@floor-fifty/shared/simulation/endless";
import { advancePlatforms } from "@floor-fifty/shared/simulation/platforms";
import { toMeters } from "@floor-fifty/shared/simulation/planck/units";
import { createPlanckWorld, destroyPlanckWorld, syncFloorWindow } from "@floor-fifty/shared/simulation/planck/world";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { endlessRaceState, freshRaceState, placeAtFloor } from "../support/race";

const P1 = asPlayerId("p1");
const P2 = asPlayerId("p2");
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const ids = (indices: number[]) => indices.map((i) => `floor-${i}`).sort();

describe("the body window (race-options spec §5.4)", () => {
  it("is FLOOR_WINDOW_BELOW below to FLOOR_WINDOW_ABOVE above each racer, merged", () => {
    let state = placeAtFloor(endlessRaceState(2), P1, 30);
    state = placeAtFloor(state, P2, 10);
    expect(floorWindow(state)).toEqual([...range(4, 18), ...range(24, 38)]);
  });

  it("is the sorted union of every climbing racer's range, with no index twice", () => {
    let state = endlessRaceState(3);
    const [a, b, c] = Object.keys(state.players) as PlayerId[];
    state = placeAtFloor(state, a!, 2);
    state = placeAtFloor(state, b!, 9);
    state = placeAtFloor(state, c!, 40);
    const window = floorWindow({ ...state, course: extendCourse(state.course, state.tuning, 60) });
    const expected = [...new Set([
      ...range(0, 2 + FLOOR_WINDOW_ABOVE),
      ...range(9 - FLOOR_WINDOW_BELOW, 9 + FLOOR_WINDOW_ABOVE),
      ...range(40 - FLOOR_WINDOW_BELOW, 40 + FLOOR_WINDOW_ABOVE),
    ])].sort((x, y) => x - y);
    expect(window).toEqual(expected);
  });

  it("leaves out a DNS and a finisher", () => {
    let state = placeAtFloor(endlessRaceState(2), P1, 30);
    state = { ...state, players: { ...state.players, [P2]: { ...state.players[P2]!, status: "dns" } } };
    expect(floorWindow(state)).toEqual(range(24, 38));
    state = { ...state, players: { ...state.players, [P2]: { ...state.players[P2]!, status: "connected", finishedAtTick: 600 } } };
    expect(floorWindow(state)).toEqual(range(24, 38));
  });

  it("builds exactly the window, and moves it as the racer moves", () => {
    const high = placeAtFloor(endlessRaceState(1), P1, 30);
    const planck = createPlanckWorld(high);
    expect([...planck.floors.keys()].sort()).toEqual(ids(range(24, 38)));
    syncFloorWindow(planck, placeAtFloor(high, P1, 10));
    expect([...planck.floors.keys()].sort()).toEqual(ids(range(4, 18)));
    destroyPlanckWorld(planck);
  });

  it("gives a floor re-entering the window the position advancePlatforms gave it", () => {
    const high = cloneRaceState(placeAtFloor(endlessRaceState(1), P1, 30));
    for (let i = 0; i < 300; i += 1) advancePlatforms(high);
    const planck = createPlanckWorld(high);
    const low = placeAtFloor(high, P1, 3);
    syncFloorWindow(planck, low);
    let checked = 0;
    for (const floor of low.course.floors.slice(0, 12)) {
      const moving = low.movingFloors[floor.id];
      if (moving === undefined) continue;
      expect(planck.floors.get(floor.id)!.getPosition().x).toBeCloseTo(toMeters(moving.x), 9);
      expect(moving.x).not.toBe(floor.x);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    destroyPlanckWorld(planck);
  });

  it("cannot be left in one tick, by the fastest fall or rise any tuning allows", () => {
    const fall = Math.abs(TUNABLES.FAST_FALL_VELOCITY.min) * TICK_SECONDS;
    const rise = TUNABLES.BOUNCE_VELOCITY.max * TICK_SECONDS;
    expect(fall).toBeLessThan(FLOOR_WINDOW_BELOW * TUNABLES.FLOOR_GAP_MIN.min);
    expect(rise).toBeLessThan(FLOOR_WINDOW_ABOVE * TUNABLES.FLOOR_GAP_MIN.min);
  });

  it("restores the same bodies a stepped world holds", () => {
    let state = placeAtFloor(endlessRaceState(1), P1, 30);
    const stepped = createRaceSimulation(state);
    stepped.restore(state);
    for (let i = 0; i < 120; i += 1) state = stepped.step({ ...state, tick: state.tick + 1 }, new Map()).state;
    const restored = createRaceSimulation(state);
    restored.restore(state);
    const next = { ...state, tick: state.tick + 1 };
    stepped.step(next, new Map());
    restored.step(next, new Map());
    expect(restored.stats().bodies).toBe(stepped.stats().bodies);
    stepped.dispose();
    restored.dispose();
  });

  it("leaves a finite course with a body per floor", () => {
    const planck = createPlanckWorld(freshRaceState());
    expect(planck.floors.size).toBe(20);
    destroyPlanckWorld(planck);
  });
});
