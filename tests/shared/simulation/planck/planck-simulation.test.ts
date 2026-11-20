import { describe, expect, it } from "vitest";
import { TICK_HZ, VIEWPORT } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import type { HeldInput, RaceEvent } from "@floor-fifty/shared/common/protocol";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { PLAYER_ID, freshRaceState, inputFor, playerOf, stateWithPlayer } from "../../support/race";

const tuning = resolveTuning();

/** Steps `count` ticks through one simulation, as a room does. */
function run(
  initial: RaceState,
  count: number,
  inputs: ReadonlyMap<PlayerId, HeldInput> = new Map(),
) {
  const simulation = createRaceSimulation(initial);
  simulation.restore(initial);
  let state = initial;
  const events: RaceEvent[] = [];
  for (let tick = 0; tick < count; tick += 1) {
    const result = simulation.step({ ...state, tick: state.tick + 1 }, inputs);
    state = result.state;
    events.push(...result.events);
  }
  simulation.dispose();
  return { state, events };
}

describe("the planck simulation", () => {
  it("leaves a non-racing state untouched", () => {
    const lobby = { ...freshRaceState(), phase: "lobby" as const };
    const simulation = createRaceSimulation(lobby);
    const result = simulation.step(lobby, new Map());
    expect(result.state).toBe(lobby);
    expect(result.events).toEqual([]);
    expect(result.sideContacts).toEqual([]);
    simulation.dispose();
  });

  it("does not mutate the state it was handed", () => {
    const state = freshRaceState();
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    const before = playerOf(state).y;
    simulation.step({ ...state, tick: 1 }, new Map());
    expect(playerOf(state).y).toBe(before);
    simulation.dispose();
  });

  it("falls under gravity and bounces off the starting floor", () => {
    const { state } = run(freshRaceState(), TICK_HZ * 2);
    expect(playerOf(state).y).toBeGreaterThan(0);
    expect(Number.isFinite(playerOf(state).vy)).toBe(true);
  });

  it("assigns horizontal velocity outright from input", () => {
    const { state } = run(freshRaceState(), 1, inputFor({ right: true }));
    expect(playerOf(state).vx).toBeCloseTo(tuning.MAX_MOVE_SPEED, 3);
    expect(playerOf(state).facingRight).toBe(true);
  });

  it("wraps across the seam and carries the body with it", () => {
    // A rightward frame, because `applyInputs` assigns `vx` outright from input
    // every tick: a fixture that only sets `vx` is overwritten with zero before
    // the step, and the player never crosses the seam to wrap in the first place.
    const { state } = run(stateWithPlayer({ x: VIEWPORT.width / 2 - 1 }), 2, inputFor({ right: true }));
    expect(playerOf(state).x).toBeLessThan(0);
    expect(Math.abs(playerOf(state).x)).toBeLessThanOrEqual(VIEWPORT.width / 2);
  });

  it("respawns a player who falls past the death line and keeps their lap", () => {
    const start = stateWithPlayer({ y: -10_000, vy: -400, lap: 2 }, 3);
    const { state, events } = run(start, 1);
    expect(playerOf(state).lap).toBe(2);
    expect(playerOf(state).visitedFloorIds).toEqual(["floor-0"]);
    expect(events.map((event) => event.type)).toContain("playerReset");
  });

  it("restores from an arbitrary state without leaking the previous world", () => {
    const simulation = createRaceSimulation(freshRaceState());
    for (let round = 0; round < 50; round += 1) simulation.restore(freshRaceState());
    const result = simulation.step({ ...freshRaceState(), tick: 1 }, new Map());
    expect(Object.keys(result.state.players)).toEqual([PLAYER_ID]);
    simulation.dispose();
  });

  it("refuses to project a world that no longer matches the race", () => {
    const state = freshRaceState();
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    // A player who vanished from the domain but not from the world is how a
    // `restore` bug presents: the race reads fine and the solver disagrees.
    const orphaned = { ...state, players: {} };
    expect(() => simulation.step({ ...orphaned, tick: 1 }, new Map())).toThrow(
      /racer-body-count/,
    );
    simulation.dispose();
  });

  it("is repeatable in one runtime for one input stream", () => {
    const first = run(freshRaceState(), TICK_HZ * 5, inputFor({ right: true }));
    const second = run(freshRaceState(), TICK_HZ * 5, inputFor({ right: true }));
    expect(second.state.players).toEqual(first.state.players);
    expect(second.events.map((event) => event.id)).toEqual(first.events.map((event) => event.id));
  });
});

describe("non-authoritative side-contact observations", () => {
  it.each(["left", "right", "top", "underside", "none"])("observes only a real %s face hit", (face) => {
    const base = freshRaceState();
    const floor = base.course.floors.find((f) => f.index > 0 && f.kind === "stationary")!;
    const reachX = (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2;
    const reachY = (tuning.FLOOR_HEIGHT + tuning.PLAYER_HEIGHT) / 2;
    const start = stateWithPlayer({
      x: floor.x + (face === "left" ? -reachX + 1 : face === "right" ? reachX - 1 : 0),
      y: floor.y + (face === "top" ? reachY + 1 : face === "underside" ? -reachY + 1 : face === "none" ? 100 : 0),
      vy: face === "underside" ? 100 : face === "top" ? -200 : 0,
    });
    const sim = createRaceSimulation(start);
    try {
      const result = sim.step({ ...start, tick: 1 }, inputFor({ right: face === "left", left: face === "right" }));
      if (face === "left" || face === "right") {
        expect(result.sideContacts).toHaveLength(1);
        expect(result.sideContacts[0]).toMatchObject({ tick: 1, playerId: PLAYER_ID, floorId: floor.id, facingLeft: face === "right" });
        expect(result.sideContacts[0]!.y).toBeCloseTo(floor.y, 0);
      } else expect(result.sideContacts).toEqual([]);
    } finally { sim.dispose(); }
  });
});

it("keeps authority and race events identical when presentation consumes the side observations", () => {
  const start = freshRaceState();
  const floor = start.course.floors.find((f) => f.index > 0 && f.kind === "stationary")!;
  Object.assign(start.players[PLAYER_ID]!, { x: floor.x - (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2 + 1, y: floor.y, vy: 0 });
  const a = createRaceSimulation(start);
  const b = createRaceSimulation(start);
  let observed = start;
  let ignored = start;
  let count = 0;
  try {
    for (let tick = 1; tick <= 60; tick++) {
      const left = a.step({ ...observed, tick }, inputFor({ right: true }));
      const right = b.step({ ...ignored, tick }, inputFor({ right: true }));
      count += left.sideContacts.length;
      for (const contact of left.sideContacts) expect(Number.isFinite(contact.x + contact.y)).toBe(true);
      expect(left.state).toEqual(right.state);
      expect(left.events).toEqual(right.events);
      observed = left.state; ignored = right.state;
    }
    expect(count).toBeGreaterThan(0);
  } finally { a.dispose(); b.dispose(); }
});
