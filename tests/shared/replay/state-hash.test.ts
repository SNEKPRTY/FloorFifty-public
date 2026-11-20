/**
 * A replay's check (race-options spec §6.1): one 32-bit hash of what decides a
 * race, which the recorder and the viewer compute with the same function.
 */
import { describe, expect, it } from "vitest";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { cloneRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { stateHash } from "@floor-fifty/shared/replay/state-hash";
import { endlessRaceState, freshRaceState } from "../support/race";

const P1 = asPlayerId("p1");

describe("the state hash (race-options spec §6.1)", () => {
  it("is a 32-bit unsigned integer, the same for the same state", () => {
    const hash = stateHash(freshRaceState());
    expect(Number.isInteger(hash) && hash >= 0 && hash < 2 ** 32).toBe(true);
    expect(stateHash(cloneRaceState(freshRaceState()))).toBe(hash);
  });

  it.each([
    ["x", (s: RaceState) => (s.players[P1]!.x += 1e-9)],
    ["vy", (s: RaceState) => (s.players[P1]!.vy += 1)],
    ["lap", (s: RaceState) => (s.players[P1]!.lap += 1)],
    ["bestFloor", (s: RaceState) => (s.players[P1]!.bestFloor += 1)],
    ["the visited count", (s: RaceState) => s.players[P1]!.visitedFloorIds.push("floor-1")],
    ["a moving floor's x", (s: RaceState) => (Object.values(s.movingFloors)[0]!.x += 1e-9)],
    ["a moving floor's direction", (s: RaceState) => (Object.values(s.movingFloors)[0]!.direction *= -1)],
  ])("changes with %s", (_name, change) => {
    const state = cloneRaceState(freshRaceState());
    const before = stateHash(state);
    change(state);
    expect(stateHash(state)).not.toBe(before);
  });

  it("does not tell -0 from 0", () => {
    const state = cloneRaceState(endlessRaceState(1));
    state.players[P1]!.vx = 0;
    const zero = stateHash(state);
    state.players[P1]!.vx = -0;
    expect(stateHash(state)).toBe(zero);
  });

  it("does not depend on insertion order", () => {
    const state = cloneRaceState(endlessRaceState(2));
    const reversed = { ...state, players: Object.fromEntries(Object.entries(state.players).reverse()) } as RaceState;
    expect(stateHash(reversed)).toBe(stateHash(state));
  });
});
