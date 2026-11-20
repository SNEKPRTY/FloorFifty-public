/** Floors below every standing racer's edge are freed for good (survival spec §6). */
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import { cloneRaceState } from "@floor-fifty/shared/common/state";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { stateHash } from "@floor-fifty/shared/replay/state-hash";
import { floorWindow, freeFloorsBelow } from "@floor-fifty/shared/simulation/endless";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { endlessRaceState, freshRaceState, placeAtFloor } from "../support/race";

const P1 = asPlayerId("p1");

describe("freed floors (survival spec §6)", () => {
  it("frees floors more than a gap below the lowest edge, and their motion with them", () => {
    const state = cloneRaceState(placeAtFloor(endlessRaceState(1), P1, 20));
    const edge = state.course.floors[10]!.y;
    state.players[P1]!.floorEdgeY = edge;
    freeFloorsBelow(state);
    const gap = state.tuning.FLOOR_GAP_MAX;
    expect(state.freedBelow).toBeGreaterThan(0);
    expect(state.freedBelow).toBe(state.course.floors.findIndex((floor) => floor.y >= edge - gap));
    for (const floor of state.course.floors.slice(0, state.freedBelow)) expect(state.movingFloors[floor.id]).toBeUndefined();
    expect(Math.min(...floorWindow(state))).toBeGreaterThanOrEqual(state.freedBelow);
  });

  it("never lowers, even when an edge is lower than before", () => {
    const state = cloneRaceState(placeAtFloor(endlessRaceState(1), P1, 20));
    state.players[P1]!.floorEdgeY = state.course.floors[10]!.y;
    freeFloorsBelow(state);
    const freed = state.freedBelow;
    state.players[P1]!.floorEdgeY = state.course.floors[2]!.y;
    freeFloorsBelow(state);
    expect(state.freedBelow).toBe(freed);
  });

  it("does nothing on a finite course, whose hash ignores the edge", () => {
    const state = cloneRaceState(freshRaceState());
    const before = stateHash(state);
    freeFloorsBelow(state);
    expect(state.freedBelow).toBe(0);
    const [id] = Object.keys(state.players) as PlayerId[];
    state.players[id!]!.floorEdgeY = 12_345;
    expect(stateHash(state)).toBe(before);
  });

  it("hashes Survival's edge, so a replay that drifts on it is caught", () => {
    const state = cloneRaceState(endlessRaceState(1));
    const before = stateHash(state);
    state.players[P1]!.floorEdgeY += 1;
    expect(stateHash(state)).not.toBe(before);
  });

  it("keeps a stepped climb's bodies off every freed floor", { timeout: 60_000 }, () => {
    let state = endlessRaceState(1);
    const controller = createClimbController(P1);
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    for (let tick = 0; state.phase === "racing" && tick < TICK_HZ * 30; tick += 1) {
      const input = controller.next(state, tick + 1);
      const inputs = new Map<PlayerId, HeldInput>(input === undefined ? [] : [[P1, input]]);
      state = simulation.step({ ...state, tick: state.tick + 1 }, inputs).state;
    }
    simulation.dispose();
    expect(state.freedBelow).toBeGreaterThan(5);
  });
});
