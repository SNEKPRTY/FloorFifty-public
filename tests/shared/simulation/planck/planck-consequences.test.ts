import { describe, expect, it } from "vitest";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import type { ContactFact } from "@floor-fifty/shared/simulation/planck/facts";
import {
  SimulationInvariantError,
  applyContactConsequences,
  assertSimulationInvariants,
} from "@floor-fifty/shared/simulation/planck/consequences";
import { PLAYER_ID, freshRaceState, playerOf, stateWithPlayer } from "../../support/race";

const tuning = resolveTuning();

const solid = (kind: "top" | "side" | "underside"): ContactFact => ({
  source: "solid",
  normalX: kind === "side" ? 1 : 0, normalY: kind === "top" ? 1 : kind === "underside" ? -1 : 0,
  playerId: PLAYER_ID,
  floorId: "floor-1",
  floorIndex: 1,
  kind,
});

const foot: ContactFact = {
  source: "foot",
  playerId: PLAYER_ID,
  floorId: "floor-1",
  floorIndex: 1,
};

describe("contact consequences", () => {
  it("lifts a player off any solid face", () => {
    for (const kind of ["top", "side", "underside"] as const) {
      const state = stateWithPlayer({ vy: -400 });
      applyContactConsequences(state, [solid(kind)], []);
      expect(playerOf(state).vy).toBeCloseTo(tuning.BOUNCE_VELOCITY, 6);
    }
  });

  it("grounds a player only on a top contact", () => {
    const top = stateWithPlayer({ grounded: false });
    applyContactConsequences(top, [solid("top")], []);
    expect(playerOf(top).grounded).toBe(true);

    const side = stateWithPlayer({ grounded: false });
    applyContactConsequences(side, [solid("side")], []);
    expect(playerOf(side).grounded).toBe(false);
  });

  it("credits a floor from a top contact or the feet, once per ascent", () => {
    const state = stateWithPlayer({});
    const events: RaceEvent[] = [];

    applyContactConsequences(state, [solid("top")], events);
    applyContactConsequences(state, [foot], events);

    expect(playerOf(state).visitedFloorIds).toEqual(["floor-0", "floor-1"]);
    expect(events.map((event) => event.type)).toEqual(["floorLanded"]);
  });

  it("never credits a side or an underside", () => {
    const state = stateWithPlayer({});
    applyContactConsequences(state, [solid("side"), solid("underside")], []);
    expect(playerOf(state).visitedFloorIds).toEqual(["floor-0"]);
  });

  it("moves nobody: positions are the solver's", () => {
    const state = stateWithPlayer({ x: 12.5, y: 300.25 });
    applyContactConsequences(state, [solid("underside"), solid("side"), foot], []);
    expect(playerOf(state).x).toBe(12.5);
    expect(playerOf(state).y).toBe(300.25);
  });

  it("ignores a fact about a player who is not simulated", () => {
    const state = stateWithPlayer({ status: "ghost", vy: -400 });
    applyContactConsequences(state, [solid("top"), foot], []);
    expect(playerOf(state).vy).toBe(-400);
    expect(playerOf(state).visitedFloorIds).toEqual(["floor-0"]);
  });
});

describe("simulation invariants", () => {
  it("accepts an ordinary race", () => {
    expect(() => assertSimulationInvariants(freshRaceState())).not.toThrow();
  });

  it("rejects a non-finite transform and names the invariant", () => {
    const state = stateWithPlayer({ y: Number.NaN });
    try {
      assertSimulationInvariants(state);
      expect.unreachable("expected an invariant failure");
    } catch (error) {
      expect(error).toBeInstanceOf(SimulationInvariantError);
      expect((error as SimulationInvariantError).invariant).toBe("transform-finite");
      expect(String(error)).not.toContain("Kite");
    }
  });

  it("rejects a speed no legal race can reach", () => {
    const state = stateWithPlayer({ vy: -1_000_000 });
    expect(() => assertSimulationInvariants(state)).toThrow(SimulationInvariantError);
  });

  it("rejects a body that has escaped the course", () => {
    const state = stateWithPlayer({ y: 10_000_000 });
    expect(() => assertSimulationInvariants(state)).toThrow(SimulationInvariantError);
  });

  it("rejects a player who is not a seated racer", () => {
    const state = freshRaceState();
    const stray = { ...state, players: { ...state.players, ghost: playerOf(state) } };
    expect(() => assertSimulationInvariants(stray as never)).toThrow(SimulationInvariantError);
  });
});
