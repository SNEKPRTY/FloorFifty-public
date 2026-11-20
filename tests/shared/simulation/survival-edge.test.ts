/**
 * Survival's rising edge (survival spec §3): the rise, the push, and going
 * out, which never respawns anyone.
 */
import { describe, expect, it } from "vitest";
import { TICK_HZ, TICK_SECONDS } from "@floor-fifty/shared/common/constants";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { cloneRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { createClimbController } from "@floor-fifty/shared/level/steering";
import { createRaceSimulation } from "@floor-fifty/shared/simulation/simulation";
import { advanceEdges, bandedRiseSpeed, riseBand, riseSpeed } from "@floor-fifty/shared/simulation/survival";
import { ENDLESS_TUNING, endlessRaceState, inputFor, placeAtFloor } from "../support/race";

const P1 = asPlayerId("p1");

/** Steps a race with no input until `ticks` have passed or it ends. */
function idle(start: RaceState, ticks: number): RaceState {
  let state = start;
  const simulation = createRaceSimulation(state);
  simulation.restore(state);
  while (state.phase === "racing" && state.tick < start.tick + ticks) {
    state = simulation.step({ ...state, tick: state.tick + 1 }, new Map()).state;
  }
  simulation.dispose();
  return state;
}

describe("the rise (survival spec §3)", () => {
  const tuning = ENDLESS_TUNING();

  it("rests through the grace period", () => {
    expect([riseSpeed(0, tuning), riseSpeed(179, tuning), riseSpeed(180, tuning)]).toEqual([0, 0, 55]);
  });

  it("steps up every 30 s and stops at the cap", () => {
    expect(riseSpeed(180 + 1800, tuning)).toBe(75);
    expect(riseSpeed(180 + 1800 * 100, tuning)).toBe(150);
  });
});

describe("the rubber band (lava band, gap to the leader)", () => {
  const tuning = ENDLESS_TUNING();
  const racers = (...floors: number[]) => floors.map((bestFloor, i) => ({ id: `p${i + 1}`, bestFloor }));

  it("leaves a lone racer's lava alone", () => {
    expect(riseBand(racers(12), "p1", tuning)).toBe(1);
    expect(riseBand([], "p1", tuning)).toBe(1);
  });

  it("speeds the leader's lava by the floors they lead second place by, up to the max", () => {
    expect(riseBand(racers(13, 10), "p1", tuning)).toBeCloseTo(1.3, 9);
    expect(riseBand(racers(30, 10), "p1", tuning)).toBe(tuning.SURVIVAL_BAND_AHEAD_MAX);
  });

  it("slows a trailer's lava by the floors they trail the leader by, down to the min", () => {
    expect(riseBand(racers(14, 10), "p2", tuning)).toBeCloseTo(0.8, 9);
    expect(riseBand(racers(40, 10), "p2", tuning)).toBe(tuning.SURVIVAL_BAND_BEHIND_MIN);
  });

  it("leaves tied leaders level", () => {
    expect(riseBand(racers(10, 10, 4), "p1", tuning)).toBe(1);
    expect(riseBand(racers(10, 10, 4), "p2", tuning)).toBe(1);
  });

  it("never lifts the banded rise past the cap", () => {
    expect(bandedRiseSpeed(1_000_000, racers(30, 10), "p1", tuning)).toBe(tuning.SURVIVAL_RISE_CAP);
    expect(bandedRiseSpeed(tuning.SURVIVAL_GRACE_TICKS, racers(30, 10), "p1", tuning)).toBeCloseTo(55 * 1.5, 9);
  });

  it("bands each standing racer's edge in a race, and leaves out racers out of the pack", () => {
    const P2 = asPlayerId("p2");
    const P3 = asPlayerId("p3");
    const state = cloneRaceState({ ...endlessRaceState(3), tick: 200 });
    const elapsed = 200 - (state.raceStartedAtTick ?? 0);
    const base = riseSpeed(elapsed, state.tuning) * TICK_SECONDS;
    const [leader, trailer, out] = [state.players[P1]!, state.players[P2]!, state.players[P3]!];
    leader.bestFloor = 10;
    trailer.bestFloor = 4;
    out.bestFloor = 40;
    out.outAtTick = 100;
    out.finishedAtTick = 100;
    // Above any push target, so the rise alone moves them.
    for (const racer of [leader, trailer]) {
      racer.y = 1e6;
      racer.floorEdgeY = 1e5;
    }
    advanceEdges(state, [], state.tuning);
    expect(leader.floorEdgeY - 1e5).toBeCloseTo(base * state.tuning.SURVIVAL_BAND_AHEAD_MAX, 9);
    expect(trailer.floorEdgeY - 1e5).toBeCloseTo(base * state.tuning.SURVIVAL_BAND_BEHIND_MIN, 9);
  });
});

describe("an edge (survival spec §3)", () => {
  it("starts at the death line", () => {
    const state = endlessRaceState(1);
    expect(state.players[P1]!.floorEdgeY).toBe(state.course.deathLineY);
  });

  it("rises by the tick's share of the speed", () => {
    const state = cloneRaceState({ ...endlessRaceState(1), tick: 200 });
    // Above the push line, so the rise alone moves it.
    state.players[P1]!.floorEdgeY = 0;
    const before = state.players[P1]!.floorEdgeY;
    advanceEdges(state, [], state.tuning);
    expect(state.players[P1]!.floorEdgeY).toBeCloseTo(before + 55 * TICK_SECONDS, 9);
  });

  it("closes on the push target at PUSH_SPEED on top of the rise, not in one step", () => {
    const state = cloneRaceState({ ...placeAtFloor(endlessRaceState(1), P1, 30), tick: 200 });
    const player = state.players[P1]!;
    player.bestFloor = 30;
    const target = state.course.floors[30]!.y - state.tuning.SURVIVAL_PUSH_AT * state.tuning.SURVIVAL_VIEW_HEIGHT;
    player.floorEdgeY = target - 1000;
    const before = player.floorEdgeY;
    advanceEdges(state, [], state.tuning);
    const rise = riseSpeed(200 - (state.raceStartedAtTick ?? 0), state.tuning);
    expect(player.floorEdgeY).toBeCloseTo(before + (rise + state.tuning.SURVIVAL_PUSH_SPEED) * TICK_SECONDS, 9);
  });

  it("stops at the target rather than overshooting it", () => {
    const state = cloneRaceState(placeAtFloor(endlessRaceState(1), P1, 30));
    const player = state.players[P1]!;
    player.bestFloor = 30;
    const target = state.course.floors[30]!.y - state.tuning.SURVIVAL_PUSH_AT * state.tuning.SURVIVAL_VIEW_HEIGHT;
    player.floorEdgeY = target - 0.5;
    advanceEdges(state, [], state.tuning);
    expect(player.floorEdgeY).toBeLessThanOrEqual(target + 1e-9);
    expect(player.floorEdgeY).toBeGreaterThan(target - 0.5);
  });

  it("at the target, only the rise moves it (review focus 1)", () => {
    const state = cloneRaceState({ ...placeAtFloor(endlessRaceState(1), P1, 30), tick: 200 });
    const player = state.players[P1]!;
    player.bestFloor = 30;
    const target = state.course.floors[30]!.y - state.tuning.SURVIVAL_PUSH_AT * state.tuning.SURVIVAL_VIEW_HEIGHT;
    player.floorEdgeY = target;
    advanceEdges(state, [], state.tuning);
    const rise = riseSpeed(200 - (state.raceStartedAtTick ?? 0), state.tuning);
    expect(player.floorEdgeY).toBeCloseTo(target + rise * TICK_SECONDS, 9);
  });

  it("above the target, keeps the rise and is never pulled down (review focus 2)", () => {
    const state = cloneRaceState({ ...placeAtFloor(endlessRaceState(1), P1, 30), tick: 200 });
    const player = state.players[P1]!;
    player.bestFloor = 30;
    const target = state.course.floors[30]!.y - state.tuning.SURVIVAL_PUSH_AT * state.tuning.SURVIVAL_VIEW_HEIGHT;
    player.floorEdgeY = target + 100;
    advanceEdges(state, [], state.tuning);
    const rise = riseSpeed(200 - (state.raceStartedAtTick ?? 0), state.tuning);
    expect(player.floorEdgeY).toBeCloseTo(target + 100 + rise * TICK_SECONDS, 9);
  });

  it("closes a new best floor's gap in under half a second", () => {
    const state = cloneRaceState(placeAtFloor(endlessRaceState(1), P1, 30));
    const player = state.players[P1]!;
    player.bestFloor = 30;
    const target = state.course.floors[30]!.y - state.tuning.SURVIVAL_PUSH_AT * state.tuning.SURVIVAL_VIEW_HEIGHT;
    player.floorEdgeY = target - state.tuning.FLOOR_GAP_MAX;
    for (let tick = 0; tick < TICK_HZ / 2; tick += 1) advanceEdges(state, [], state.tuning);
    expect(player.floorEdgeY).toBeGreaterThanOrEqual(target - 1e-9);
  });

  // The rise is capped under the reference bot's climb (survival spec §3), so
  // the edge never catches it on the way up; what puts it out is its own fall
  // through the ramp above floor 50, as the screen rule means it to.
  it("lets the reference bot climb past floor 50 before a fall puts it out", { timeout: 120_000 }, () => {
    let state = endlessRaceState(1);
    const controller = createClimbController(P1);
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    for (let tick = 0; state.phase === "racing" && tick < TICK_HZ * 180; tick += 1) {
      const input = controller.next(state, tick + 1);
      state = simulation.step({ ...state, tick: state.tick + 1 }, input === undefined ? new Map() : new Map([[P1, input]])).state;
    }
    simulation.dispose();
    expect(state.players[P1]!.bestFloor).toBeGreaterThanOrEqual(50);
  });

  it("keeps a racer whose body still pokes above it in, and puts them out once it is all below", () => {
    const state = cloneRaceState({ ...endlessRaceState(1), tick: 900, raceStartedAtTick: 100 });
    const player = state.players[P1]!;
    player.floorEdgeY = player.y + state.tuning.PLAYER_HEIGHT / 2 - 1;
    advanceEdges(state, [], state.tuning);
    expect(player.outAtTick).toBeUndefined();
    player.floorEdgeY = player.y + state.tuning.PLAYER_HEIGHT / 2 + 1;
    advanceEdges(state, [], state.tuning);
    expect(player.outAtTick).toBe(800);
  });

  it("raises a disconnected racer's edge too, so dropping out is no shelter", () => {
    const state = cloneRaceState({ ...endlessRaceState(1), tick: 900, raceStartedAtTick: 100 });
    const player = state.players[P1]!;
    player.status = "ghost";
    const before = player.floorEdgeY;
    advanceEdges(state, [], state.tuning);
    expect(player.floorEdgeY).toBeGreaterThan(before);
    player.floorEdgeY = player.y + 100;
    const events: RaceEvent[] = [];
    advanceEdges(state, events, state.tuning);
    expect(player.outAtTick).toBe(800);
    expect(events).toMatchObject([{ type: "playerOut", playerId: P1 }]);
  });

  it("leaves a DNS alone", () => {
    const state = cloneRaceState({ ...endlessRaceState(1), tick: 900, raceStartedAtTick: 100 });
    const player = state.players[P1]!;
    player.status = "dns";
    player.floorEdgeY = player.y + 100;
    advanceEdges(state, [], state.tuning);
    expect(player.outAtTick).toBeUndefined();
  });

  it("puts a racer below it out, once, held still, without a respawn", () => {
    const state = cloneRaceState({ ...endlessRaceState(1), tick: 900, raceStartedAtTick: 100 });
    const player = state.players[P1]!;
    player.floorEdgeY = player.y + 100;
    const events: RaceEvent[] = [];
    advanceEdges(state, events, state.tuning);
    expect([player.outAtTick, player.finishedAtTick, player.vx, player.vy]).toEqual([800, 800, 0, 0]);
    expect(events).toMatchObject([{ type: "playerOut", playerId: P1 }]);
    advanceEdges(state, events, state.tuning);
    expect(events).toHaveLength(1);
  });

  it("leaves a finite race's racers alone", () => {
    const state = cloneRaceState({ ...endlessRaceState(1, 35229, ENDLESS_TUNING({ RACE_TIME_LIMIT_TICKS: 0 })), tick: 900 });
    const before = state.players[P1]!.floorEdgeY;
    advanceEdges(state, [], state.tuning);
    expect(state.players[P1]!.floorEdgeY).toBe(before);
  });

  it("puts out a racer who never pressed anything, once the edge passes them", () => {
    const start = endlessRaceState(1);
    const waiting = { ...start, players: { [P1]: { ...start.players[P1]!, awaitingInput: true, vy: 0 } } };
    const state = idle(waiting, TICK_HZ * 30);
    expect(state.players[P1]!.outAtTick).toBeDefined();
    expect(state.players[P1]!.y).toBeGreaterThan(state.course.deathLineY);
  });

  it("ignores a reset in Survival", () => {
    const state = cloneRaceState(placeAtFloor(endlessRaceState(1), P1, 10));
    const simulation = createRaceSimulation(state);
    simulation.restore(state);
    const y = state.players[P1]!.y;
    const result = simulation.step({ ...state, tick: state.tick + 1 }, inputFor({ reset: true, sequence: 1 }));
    simulation.dispose();
    expect(result.events.some((event) => event.type === "playerReset")).toBe(false);
    expect(result.state.players[P1]!.y).toBeGreaterThan(y - 50);
  });
});
