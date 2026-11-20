import { describe, expect, it } from "vitest";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { freshRaceState, inputFor, PLAYER_ID, playerOf } from "../support/race";

describe("the race simulation façade", () => {
  it("steps a race without mutating the state it was handed", () => {
    const state = freshRaceState();
    const simulation = createRaceSimulation(state);

    const result = simulation.step({ ...state, tick: 1 }, inputFor({ right: true }));

    expect(result.state).not.toBe(state);
    expect(playerOf(state).vx).toBe(0);
    expect(result.state.players[PLAYER_ID]!.vx).toBeGreaterThan(0);
    simulation.dispose();
  });

  it("counts what the last racing step asked of the solver", () => {
    let state = freshRaceState();
    const simulation = createRaceSimulation(state);
    expect(simulation.stats().steps).toBe(0);

    // Long enough to bounce off the starting floor at least once, so the
    // counts are about real contacts rather than an empty world.
    let sawFacts = false;
    for (let tick = 1; tick <= 120; tick += 1) {
      state = simulation.step({ ...state, tick }, new Map()).state;
      const { facts } = simulation.stats();
      if (facts.top + facts.side + facts.underside + facts.foot > 0) sawFacts = true;
    }

    const stats = simulation.stats();
    expect(stats.steps).toBe(120);
    expect(stats.bodies).toBe(state.course.floorCount + 1);
    expect(sawFacts).toBe(true);
    simulation.dispose();
  });

  it("does not count a step that did not race", () => {
    const state = { ...freshRaceState(), phase: "lobby" as const };
    const simulation = createRaceSimulation(state);
    simulation.step({ ...state, tick: 1 }, new Map());
    expect(simulation.stats().steps).toBe(0);
    simulation.dispose();
  });

  it("restores from an arbitrary state and continues from it", () => {
    const state = freshRaceState();
    const simulation = createRaceSimulation(state);
    const moved = { ...state, players: { [PLAYER_ID]: { ...playerOf(state), y: 500 } } };

    simulation.restore(moved);
    const result = simulation.step({ ...moved, tick: 1 }, new Map());

    expect(result.state.players[asPlayerId("p1")]!.y).toBeLessThan(500);
    simulation.dispose();
  });
});
