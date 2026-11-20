/** How a Survival race ends (survival spec §4). */
import { describe, expect, it } from "vitest";
import { asPlayerId, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { cloneRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveLapAndWinner } from "@floor-fifty/shared/simulation/step";
import { endlessRaceState } from "../support/race";

const [P1, P2, P3, P4] = ["p1", "p2", "p3", "p4"].map(asPlayerId) as [PlayerId, PlayerId, PlayerId, PlayerId];

/** The race at `tick`, with the named racers out at their ticks and given best floors. */
function at(state: RaceState, tick: number, out: Partial<Record<string, number>>, best: Partial<Record<string, number>> = {}): RaceState {
  const next = cloneRaceState({ ...state, tick, raceStartedAtTick: 0 });
  for (const [id, outAt] of Object.entries(out)) {
    next.players[id as PlayerId]!.outAtTick = outAt!;
    next.players[id as PlayerId]!.finishedAtTick = outAt!;
  }
  for (const [id, floor] of Object.entries(best)) next.players[id as PlayerId]!.bestFloor = floor!;
  return next;
}

describe("a Survival race ends (survival spec §4)", () => {
  it("when one racer of several is left, who wins", () => {
    const state = at(endlessRaceState(3), 1000, { p1: 400, p3: 900 });
    const events: RaceEvent[] = [];
    resolveLapAndWinner(state, events, state.tuning);
    expect(state.phase).toBe("finished");
    expect(state.standings).toEqual([P2, P3, P1]);
    expect(state.winnerId).toBe(P2);
    expect(state.players[P2]!.finishedAtTick).toBe(1000);
    expect(events).toMatchObject([{ type: "raceFinished", winnerId: P2 }]);
  });

  it("not while two stand", () => {
    const state = at(endlessRaceState(3), 1000, { p1: 400 });
    resolveLapAndWinner(state, [], state.tuning);
    expect(state.phase).toBe("racing");
  });

  it("when a solo racer goes out", () => {
    const state = at(endlessRaceState(1), 1000, { p1: 1000 });
    resolveLapAndWinner(state, [], state.tuning);
    expect([state.phase, state.winnerId]).toEqual(["finished", P1]);
  });

  it("when the last two go out on one tick, by best floor", () => {
    const state = at(endlessRaceState(2), 1000, { p1: 1000, p2: 1000 }, { p1: 12, p2: 15 });
    resolveLapAndWinner(state, [], state.tuning);
    expect(state.standings).toEqual([P2, P1]);
  });

  it("on the clock with survivors by best floor, then the out by how long they lasted, DNS last", () => {
    const base = endlessRaceState(4);
    const state = at(base, base.tuning.RACE_TIME_LIMIT_TICKS, { p3: 500 }, { p1: 20, p2: 25, p3: 40 });
    state.players[P4]!.status = "dns";
    resolveLapAndWinner(state, [], state.tuning);
    expect(state.standings).toEqual([P2, P1, P3, P4]);
  });

  it("keeps an out racer's place when they leave afterwards: going out decides it, not the DNS that follows", () => {
    const state = at(endlessRaceState(3), 1200, { p1: 1000, p2: 400 });
    state.players[P1]!.status = "dns";
    resolveLapAndWinner(state, [], state.tuning);
    expect(state.standings).toEqual([P3, P1, P2]);
  });

  it("keeps a ghost standing, so a drop is not a win", () => {
    const state = at(endlessRaceState(2), 1000, {});
    state.players[P2]!.status = "ghost";
    resolveLapAndWinner(state, [], state.tuning);
    expect(state.phase).toBe("racing");
  });

  it("gives the race to the last one standing when the other becomes a DNS", () => {
    const state = at(endlessRaceState(2), 1000, {});
    state.players[P2]!.status = "dns";
    resolveLapAndWinner(state, [], state.tuning);
    expect([state.phase, state.winnerId, state.standings]).toEqual(["finished", P1, [P1, P2]]);
  });
});
