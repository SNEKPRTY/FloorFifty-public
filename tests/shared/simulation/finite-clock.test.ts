/**
 * Audit S11: a floors-20 or floors-50 race ended only when someone completed
 * the course, and `RACE_TIME_LIMIT_TICKS` was read only in Survival. A room with
 * one racer who never finished stepped for ever, and its replay recording grew
 * without bound. A finite race now has a clock too (the Owner's, 10 minutes),
 * and when it runs out the racers rank by the highest floor they reached.
 */
import { describe, expect, it } from "vitest";
import { FINITE_RACE_TIME_LIMIT_TICKS, TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { resolveLapAndWinner } from "@floor-fifty/shared/simulation/step";
import { SEED } from "../support/race";

const [P1, P2, P3] = ["p1", "p2", "p3"].map(asPlayerId) as [PlayerId, PlayerId, PlayerId];

/** A finite race in `racing` at `tick`, three racers still on the course. */
function finiteRace(tick: number): RaceState {
  const tuning = resolveTuning();
  const state = createRaceState({
    seed: SEED,
    lapCount: 1,
    tuning,
    players: [P1, P2, P3].map((id, index) => ({ id, name: asPlayerName(`Racer ${index + 1}`) })),
  });
  return { ...state, phase: "racing", raceStartedAtTick: 0, tick };
}

describe("a finite race's clock (audit S11)", () => {
  it("is ten minutes", () => {
    expect(FINITE_RACE_TIME_LIMIT_TICKS).toBe(10 * 60 * TICK_HZ);
  });

  it("does not end a race one tick before it", () => {
    const state = finiteRace(FINITE_RACE_TIME_LIMIT_TICKS - 1);
    resolveLapAndWinner(state, [], state.tuning);
    expect(state.phase).toBe("racing");
  });

  it("ends a race nobody finished, ranking by the highest floor, then who reached it first", () => {
    const state = finiteRace(FINITE_RACE_TIME_LIMIT_TICKS);
    state.players[P1]!.bestFloor = 7;
    state.players[P1]!.bestFloorAtTick = 500;
    state.players[P2]!.bestFloor = 9;
    state.players[P2]!.bestFloorAtTick = 900;
    state.players[P3]!.bestFloor = 7;
    state.players[P3]!.bestFloorAtTick = 400;
    const events: RaceEvent[] = [];
    resolveLapAndWinner(state, events, state.tuning);
    expect(state.phase).toBe("finished");
    expect(state.standings).toEqual([P2, P3, P1]);
    expect(state.winnerId).toBe(P2);
    expect(state.players[P2]!.finishedAtTick).toBe(FINITE_RACE_TIME_LIMIT_TICKS);
    expect(events).toMatchObject([{ type: "raceFinished", winnerId: P2 }]);
  });

  it("puts a racer who never started last, whatever floor they reached before", () => {
    const state = finiteRace(FINITE_RACE_TIME_LIMIT_TICKS);
    state.players[P1]!.bestFloor = 12;
    state.players[P1]!.status = "dns";
    state.players[P2]!.bestFloor = 3;
    resolveLapAndWinner(state, [], state.tuning);
    expect(state.standings.at(-1)).toBe(P1);
    expect(state.winnerId).not.toBe(P1);
  });

  it("ends a lone racer's race on the clock too, so a room with one racer cannot step for ever", () => {
    const state = finiteRace(FINITE_RACE_TIME_LIMIT_TICKS);
    delete state.players[P2];
    delete state.players[P3];
    resolveLapAndWinner(state, [], state.tuning);
    expect([state.phase, state.winnerId]).toEqual(["finished", P1]);
  });

  it("ends a race in which nobody is left to rank, with no winner", () => {
    const state = finiteRace(FINITE_RACE_TIME_LIMIT_TICKS);
    for (const id of [P1, P2, P3]) state.players[id]!.status = "dns";
    resolveLapAndWinner(state, [], state.tuning);
    expect([state.phase, state.winnerId]).toEqual(["finished", undefined]);
  });
});
