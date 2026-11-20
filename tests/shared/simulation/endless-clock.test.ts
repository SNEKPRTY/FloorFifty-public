/**
 * Infinite's clock and standings (race-options spec §5.2): the race ends on
 * its limit tick, and racers rank by the best floor they ever reached.
 */
import { describe, expect, it } from "vitest";
import { ENDLESS_FLOOR_CAP, FLOOR_WINDOW_ABOVE, FLOOR_WINDOW_BELOW, TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput, RaceEvent } from "@floor-fifty/shared/common/protocol";
import { cloneRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { creditFloor } from "@floor-fifty/shared/simulation/collision";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { resolveLapAndWinner } from "@floor-fifty/shared/simulation/step";
import { ENDLESS_TUNING, endlessRaceState, placeAtFloor } from "../support/race";

const [P1, P2, P3, P4] = ["p1", "p2", "p3", "p4"].map(asPlayerId) as [PlayerId, PlayerId, PlayerId, PlayerId];

/** The race at its limit tick, each racer given a best floor (and its tick) or made a DNS. */
function atLimit(state: RaceState, best: Record<string, [number, number | undefined] | "dns">): RaceState {
  const next = cloneRaceState({ ...state, tick: state.tuning.RACE_TIME_LIMIT_TICKS });
  for (const [id, value] of Object.entries(best)) {
    const player = next.players[id as PlayerId]!;
    if (value === "dns") {
      player.status = "dns";
      continue;
    }
    player.bestFloor = value[0];
    if (value[1] === undefined) delete player.bestFloorAtTick;
    else player.bestFloorAtTick = value[1];
  }
  return next;
}

describe("the Survival clock (race-options spec §5.2, survival spec §4)", () => {
  it("finishes the race on the limit tick, not before", () => {
    const tuning = ENDLESS_TUNING({ RACE_TIME_LIMIT_TICKS: 120 });
    let state = endlessRaceState(2, 35229, tuning);
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    while (state.phase === "racing" && state.tick < 200) state = simulation.step({ ...state, tick: state.tick + 1 }, new Map()).state;
    simulation.dispose();
    expect(state.tick - state.raceStartedAtTick!).toBe(120);
    expect(Object.values(state.players).map((p) => p.finishedAtTick)).toEqual([120, 120]);
  });

  it("orders by best floor, then the tick it was reached, then player ID; DNS last", () => {
    const state = atLimit(endlessRaceState(4), { p1: [10, 500], p2: [12, 900], p3: [10, 400], p4: "dns" });
    const events: RaceEvent[] = [];
    resolveLapAndWinner(state, events, state.tuning);
    expect(state.phase).toBe("finished");
    expect(state.standings).toEqual([P2, P3, P1, P4]);
    expect(state.winnerId).toBe(P2);
    expect(events).toMatchObject([{ type: "raceFinished", winnerId: P2 }]);
    expect(state.players[P4]!.finishedAtTick).toBeUndefined();
  });

  it("breaks a full tie by player ID, and sorts an absent tick last", () => {
    const state = atLimit(endlessRaceState(3), { p1: [0, undefined], p2: [4, 300], p3: [4, 300] });
    resolveLapAndWinner(state, [], state.tuning);
    expect(state.standings).toEqual([P2, P3, P1]);
  });

  it("finishes with no winner when everyone is a DNS", () => {
    const state = atLimit(endlessRaceState(2), { p1: "dns", p2: "dns" });
    const events: RaceEvent[] = [];
    resolveLapAndWinner(state, events, state.tuning);
    expect(state.phase).toBe("finished");
    expect(state.winnerId).toBeUndefined();
    expect(events).toEqual([]);
  });

  it("never completes a lap", () => {
    const state = cloneRaceState(endlessRaceState(1));
    state.players[P1]!.visitedFloorIds = state.course.floors.map((floor) => floor.id);
    resolveLapAndWinner(state, [], state.tuning);
    expect(state.players[P1]!.lap).toBe(1);
    expect(state.phase).toBe("racing");
  });
});

describe("a best floor (race-options spec §5.2)", () => {
  it("rises with a credit above it, race-relative", () => {
    const state = cloneRaceState({ ...endlessRaceState(1), tick: 700, raceStartedAtTick: 100 });
    const player = state.players[P1]!;
    expect(player.bestFloor).toBe(0);
    creditFloor(state, player, state.course.floors[7]!, []);
    expect([player.bestFloor, player.bestFloorAtTick]).toEqual([7, 600]);
    creditFloor(state, player, state.course.floors[3]!, []);
    expect([player.bestFloor, player.bestFloorAtTick]).toEqual([7, 600]);
  });

  it("is kept when the racer falls out (survival spec §3)", () => {
    const state = cloneRaceState(placeAtFloor(endlessRaceState(1), P1, 30));
    state.players[P1]!.bestFloor = 30;
    state.players[P1]!.bestFloorAtTick = 900;
    state.players[P1]!.floorEdgeY = state.players[P1]!.y + 100;
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    const result = simulation.step({ ...state, tick: state.tick + 1 }, new Map());
    simulation.dispose();
    expect(result.events.some((event) => event.type === "playerReset")).toBe(false);
    expect(result.state.players[P1]!.outAtTick).toBeDefined();
    expect(result.state.players[P1]!.bestFloor).toBe(30);
  });
});

describe("four reference bots for 3:00 (race-options spec §10.1, memory bound)", () => {
  // Survival's edge puts even the reference bots out by a fall (they drop
  // several floors through the ramp), so the widest view keeps them climbing
  // as long as it can; the bound is checked for as long as the race runs.
  it("stay under ENDLESS_FLOOR_CAP, and the bodies never exceed four windows", { timeout: 120_000 }, () => {
    let state = endlessRaceState(4, 35229, ENDLESS_TUNING({ SURVIVAL_VIEW_HEIGHT: 1200, SURVIVAL_PUSH_AT: 0.9 }));
    const ids = Object.keys(state.players) as PlayerId[];
    const controllers = new Map(ids.map((id) => [id, createClimbController(id)]));
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    const bound = ids.length * (FLOOR_WINDOW_BELOW + FLOOR_WINDOW_ABOVE + 1) + ids.length;
    let most = 0;
    for (let tick = 0; state.phase === "racing" && tick <= TICK_HZ * 181; tick += 1) {
      const inputs = new Map<PlayerId, HeldInput>();
      for (const [id, controller] of controllers) {
        const input = controller.next(state, tick + 1);
        if (input !== undefined) inputs.set(id, input);
      }
      state = simulation.step({ ...state, tick: state.tick + 1 }, inputs).state;
      most = Math.max(most, simulation.stats().bodies);
    }
    simulation.dispose();
    expect(most).toBeLessThanOrEqual(bound);
    expect(state.phase).toBe("finished");
    expect(state.course.floorCount).toBeLessThan(ENDLESS_FLOOR_CAP);
    expect(state.standings).toHaveLength(4);
  });
});
