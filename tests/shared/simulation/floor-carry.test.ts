import { describe, expect, it } from "vitest";
import { VIEWPORT } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput, RaceEvent } from "@floor-fifty/shared/common/protocol";
import { floorX, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning, type ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { resolveWrapAndDeaths } from "@floor-fifty/shared/simulation/collision";
import type { ContactFact } from "@floor-fifty/shared/simulation/planck/facts";
import { applyFloorCarry } from "@floor-fifty/shared/simulation/planck/consequences";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { PLAYER_ID, freshRaceState, inputFor, noInput, playerOf } from "../support/race";

/** A race with a moving floor, the player standing on it and the floor pinned. */
function riding(carry = 1, at: { x: number; direction: 1 | -1 } = { x: -300, direction: 1 }) {
  const tuning: ResolvedTuning = resolveTuning({ COURSE_FLOOR_COUNT: 100, MOVING_FLOOR_CARRY: carry });
  const base = freshRaceState(1, tuning);
  const floor = base.course.floors.find((candidate) => candidate.kind === "moving")!;
  const state: RaceState = {
    ...base,
    movingFloors: { ...base.movingFloors, [floor.id]: { id: floor.id, x: at.x, direction: at.direction, speed: 100 } },
  };
  const top = floor.y + tuning.FLOOR_HEIGHT / 2;
  const player = { ...playerOf(state), x: at.x + 10, y: top + tuning.PLAYER_HEIGHT / 2 + 1, vx: 0, vy: 0 };
  return { state: { ...state, players: { [PLAYER_ID]: player } }, floor };
}

function run(start: RaceState, ticks: number, inputs: ReadonlyMap<PlayerId, HeldInput>): RaceState[] {
  return runUntilReset(start, ticks, inputs, false);
}

/**
 * Steps a persistent world. With `stopAtReset`, stops before the first tick
 * that resets the racer: off the floor and below the death line, a respawn
 * moves it to the spawn, which is not a carry.
 */
function runUntilReset(
  start: RaceState,
  ticks: number,
  inputs: ReadonlyMap<PlayerId, HeldInput>,
  stopAtReset = true,
): RaceState[] {
  const simulation = createRaceSimulation(start);
  simulation.restore(start);
  const states: RaceState[] = [];
  let state = start;
  for (let index = 0; index < ticks; index += 1) {
    const result = simulation.step({ ...state, tick: state.tick + 1 }, inputs);
    if (stopAtReset && result.events.some((event: RaceEvent) => event.type === "playerReset")) break;
    state = result.state;
    states.push(state);
  }
  simulation.dispose();
  return states;
}

function resets(start: RaceState, ticks: number, inputs: ReadonlyMap<PlayerId, HeldInput>): boolean {
  return runUntilReset(start, ticks, inputs).length < ticks;
}

describe("riding a moving floor", () => {
  it("is authored at full carry", () => {
    expect(resolveTuning().MOVING_FLOOR_CARRY).toBe(1);
  });

  it("keeps a pinned rider on the floor through a full traversal and a reversal", () => {
    const { state, floor } = riding();
    // 660 px at 100 px/s is 6.6 s; 9 s takes in the reversal at the right bound.
    const states = run(state, 9 * 60, inputFor({ fastFall: true }));
    const settled = states.slice(10);
    const offsets = settled.map((s) => playerOf(s).x - floorX(s, s.course.floors.find((f) => f.id === floor.id)!));
    const directions = settled.map((s) => s.movingFloors[floor.id]!.direction);
    expect(new Set(directions)).toEqual(new Set([1, -1]));
    for (const offset of offsets) expect(offset).toBeCloseTo(offsets[0]!, 3);
  });

  it("carries a bouncing racer only on its contact ticks", () => {
    const { state, floor } = riding();
    // Until the floor slides out from under a bounce and the racer falls.
    const states = runUntilReset(state, 4 * 60, noInput());
    let carried = 0;
    for (let index = 1; index < states.length; index += 1) {
      const dx = playerOf(states[index]!).x - playerOf(states[index - 1]!).x;
      const shift = states[index]!.movingFloors[floor.id]!.x - states[index - 1]!.movingFloors[floor.id]!.x;
      if (dx === 0) continue;
      expect(dx).toBeCloseTo(shift, 6);
      carried += 1;
    }
    expect(carried).toBeGreaterThan(0);
    expect(carried).toBeLessThan(states.length / 4);
  });

  it("wraps a rider carried across the edge", () => {
    const { state, floor } = riding();
    const half = VIEWPORT.width / 2;
    const near = { ...state, players: { [PLAYER_ID]: { ...playerOf(state), x: half - 1 } } };
    const fact: ContactFact = { source: "solid", playerId: PLAYER_ID, floorId: floor.id, floorIndex: floor.index, kind: "top", normalX: 0, normalY: 1 };
    applyFloorCarry(near, [fact], new Map([[floor.id, 3]]));
    expect(playerOf(near).x).toBe(half + 2);
    resolveWrapAndDeaths(near, new Set(), [], near.tuning);
    expect(playerOf(near).x).toBeCloseTo(-half + 2, 6);
  });

  it("wraps a carried rider on the tick it crosses, through a real step (carry runs before wrap)", () => {
    // The course bounds keep floors clear of the seam, so this widens them: the
    // rule is that carry lands before wrap and deaths, and only a whole step
    // shows the order. Carried after the wrap, the rider would be seen past the
    // edge for a tick before it wrapped.
    const half = VIEWPORT.width / 2;
    const { state, floor } = riding(1, { x: half - 15, direction: 1 });
    const wide = { ...state, course: { ...state.course, bounds: { left: -2 * half, right: 2 * half } } };
    const states = run(wide, 12, inputFor({ fastFall: true }));
    const xs = states.map((s) => playerOf(s).x);
    expect(Math.max(...xs.map(Math.abs)), "never drawn past the edge").toBeLessThanOrEqual(half);
    expect(xs.some((x) => x < 0), "wrapped to the other side").toBe(true);
    expect(states.at(-1)!.movingFloors[floor.id]!.x).toBeGreaterThan(half - 15);
  });

  it("carries once when a racer touches two moving floors on one tick", () => {
    const { state, floor } = riding();
    const other = state.course.floors.find((f) => f.kind === "moving" && f.id !== floor.id)!;
    const before = playerOf(state).x;
    const facts: ContactFact[] = [
      { source: "solid", playerId: PLAYER_ID, floorId: floor.id, floorIndex: floor.index, kind: "top", normalX: 0, normalY: 1 },
      { source: "solid", playerId: PLAYER_ID, floorId: other.id, floorIndex: other.index, kind: "top", normalX: 0, normalY: 1 },
    ];
    applyFloorCarry(state, facts, new Map([[floor.id, 2], [other.id, 5]]));
    expect(playerOf(state).x).toBe(before + 2);
  });

  it("carries nothing on a side or underside contact, or from a foot sensor", () => {
    const { state, floor } = riding();
    const before = playerOf(state).x;
    const facts: ContactFact[] = [
      { source: "solid", playerId: PLAYER_ID, floorId: floor.id, floorIndex: floor.index, kind: "side", normalX: 1, normalY: 0 },
      { source: "solid", playerId: PLAYER_ID, floorId: floor.id, floorIndex: floor.index, kind: "underside", normalX: 0, normalY: -1 },
      { source: "foot", playerId: PLAYER_ID, floorId: floor.id, floorIndex: floor.index },
    ];
    applyFloorCarry(state, facts, new Map([[floor.id, 4]]));
    expect(playerOf(state).x).toBe(before);
  });

  it("keeps no floor speed on leaving (D7)", () => {
    const { state } = riding();
    const states = run(state, 60, inputFor({ fastFall: true }));
    const released = run(states.at(-1)!, 1, noInput())[0]!;
    expect(playerOf(released).vx).toBe(0);
  });

  it("carries nothing at MOVING_FLOOR_CARRY = 0: the floor slides out from under the rider, as in the reference", () => {
    const { state } = riding(0);
    const pinned = inputFor({ fastFall: true });
    const states = runUntilReset(state, 4 * 60, pinned);
    const xs = states.map((s) => playerOf(s).x);
    for (const x of xs) expect(x).toBeCloseTo(xs[0]!, 6);
    expect(resets(state, 4 * 60, pinned)).toBe(true);
    expect(resets(riding(1).state, 4 * 60, pinned)).toBe(false);
  });
});
