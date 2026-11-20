import { describe, expect, it } from "vitest";
import { QUICK_MATCH_SEARCH_TICKS, QUICK_MATCH_START_TICKS } from "@floor-fifty/shared/common/constants";
import { asPlayerId, asPlayerName, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { RoomAccess } from "@floor-fifty/shared/common/protocol";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import {
  evaluateQuickMatch,
  evaluateReadiness,
  isSearching,
  nextRace,
  setReady,
} from "../../../apps/server/src/rooms/lobby-rules";
import { RoomCommandError } from "../../../apps/server/src/rooms/room-errors";

const HOST = asPlayerId("room-p1");
const GUEST = asPlayerId("room-p2");
const THIRD = asPlayerId("room-p3");

function lobby(access: RoomAccess, ...ids: PlayerId[]): RaceState {
  return createRaceState({
    seed: 7,
    lapCount: 1,
    tuning: resolveTuning(),
    access,
    players: ids.map((id) => ({ id, name: asPlayerName(id) })),
  });
}

function refusal(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof RoomCommandError) return error.code;
    throw error;
  }
  return undefined;
}

describe("a private room", () => {
  it("never sets a clock, whoever is in it", () => {
    const race = lobby("private", HOST, GUEST);
    evaluateQuickMatch(race);
    expect(race.startsAtTick).toBeUndefined();
    expect(race.soloFromTick).toBeUndefined();
  });

  it("lets a lone racer ready at once, as before", () => {
    const race = lobby("private", HOST);
    setReady(race, HOST, true);
    expect(race.phase).toBe("select");
  });
});

describe("the search clock", () => {
  it("is set to twenty seconds ahead for a lone racer, and kept as time passes", () => {
    const race = lobby("public", HOST);
    evaluateQuickMatch(race);
    expect(race.soloFromTick).toBe(QUICK_MATCH_SEARCH_TICKS);
    expect(race.startsAtTick).toBeUndefined();

    race.tick = 500;
    evaluateQuickMatch(race);
    expect(race.soloFromTick).toBe(QUICK_MATCH_SEARCH_TICKS);
  });

  it("ends at once when the lone racer presses Race alone, and opens select", () => {
    const race = lobby("public", HOST);
    evaluateQuickMatch(race);
    race.tick = 100;
    expect(isSearching(race)).toBe(true);
    expect(refusal(() => setReady(race, HOST, true))).toBeUndefined();
    expect(race.phase).toBe("select");
  });

  it("lets the lone racer ready, and leave the lobby, once it has run out", () => {
    const race = lobby("public", HOST);
    evaluateQuickMatch(race);
    race.tick = QUICK_MATCH_SEARCH_TICKS;
    expect(isSearching(race)).toBe(false);
    setReady(race, HOST, true);
    expect(race.phase).toBe("select");
  });

  it("still lets a lone racer take their Ready back during the search", () => {
    const race = lobby("public", HOST);
    evaluateQuickMatch(race);
    race.players[HOST]!.ready = true;
    expect(refusal(() => setReady(race, HOST, false))).toBeUndefined();
  });

  it("keeps a racer's readiness when the others leave, and opens select when it runs out", () => {
    const race = lobby("public", HOST, GUEST);
    evaluateQuickMatch(race);
    race.players[HOST]!.ready = true;

    race.tick = 100;
    delete race.players[GUEST];
    evaluateQuickMatch(race);
    evaluateReadiness(race);
    expect(race.phase).toBe("lobby");
    expect(race.players[HOST]!.ready).toBe(true);
    expect(race.soloFromTick).toBe(100 + QUICK_MATCH_SEARCH_TICKS);

    race.tick = 100 + QUICK_MATCH_SEARCH_TICKS;
    evaluateQuickMatch(race);
    evaluateReadiness(race);
    expect(race.phase).toBe("select");
  });

  it("restarts from the moment the room is back to one racer", () => {
    const race = lobby("public", HOST, GUEST);
    evaluateQuickMatch(race);
    race.tick = 900;
    race.players[GUEST]!.status = "ghost";
    evaluateQuickMatch(race);
    expect(race.startsAtTick).toBeUndefined();
    expect(race.soloFromTick).toBe(900 + QUICK_MATCH_SEARCH_TICKS);
  });
});

describe("the start clock", () => {
  it("is set to thirty seconds ahead once two racers are connected, and clears the search clock", () => {
    const race = lobby("public", HOST);
    evaluateQuickMatch(race);
    race.tick = 300;
    race.players[GUEST] = { ...race.players[HOST]!, id: GUEST };
    evaluateQuickMatch(race);
    expect(race.startsAtTick).toBe(300 + QUICK_MATCH_START_TICKS);
    expect(race.soloFromTick).toBeUndefined();
  });

  it("is not moved by a later join", () => {
    const race = lobby("public", HOST, GUEST);
    evaluateQuickMatch(race);
    const first = race.startsAtTick;
    race.tick = 600;
    race.players[THIRD] = { ...race.players[HOST]!, id: THIRD };
    evaluateQuickMatch(race);
    expect(race.startsAtTick).toBe(first);
  });

  it("makes every connected seat ready when it runs out, and select opens", () => {
    const race = lobby("public", HOST, GUEST);
    evaluateQuickMatch(race);
    race.tick = QUICK_MATCH_START_TICKS - 1;
    evaluateQuickMatch(race);
    expect(race.players[HOST]!.ready).toBe(false);

    race.tick = QUICK_MATCH_START_TICKS;
    evaluateQuickMatch(race);
    evaluateReadiness(race);
    expect(race.players[HOST]!.ready).toBe(true);
    expect(race.players[GUEST]!.ready).toBe(true);
    expect(race.phase).toBe("select");
  });

  it("is ended early by everyone being ready, and the clocks are cleared with the lobby", () => {
    const race = lobby("public", HOST, GUEST);
    evaluateQuickMatch(race);
    setReady(race, HOST, true);
    setReady(race, GUEST, true);
    expect(race.phase).toBe("select");
    expect(race.startsAtTick).toBeUndefined();
    expect(race.soloFromTick).toBeUndefined();
  });

  it("does not count a ghost, so a ghost and one racer is a lone racer", () => {
    const race = lobby("public", HOST, GUEST);
    race.players[GUEST]!.status = "ghost";
    evaluateQuickMatch(race);
    expect(race.startsAtTick).toBeUndefined();
    expect(race.soloFromTick).toBe(QUICK_MATCH_SEARCH_TICKS);
  });

  it("clears both clocks when nobody is connected", () => {
    const race = lobby("public", HOST);
    evaluateQuickMatch(race);
    race.players[HOST]!.status = "ghost";
    evaluateQuickMatch(race);
    expect(race.startsAtTick).toBeUndefined();
    expect(race.soloFromTick).toBeUndefined();
  });
});

describe("race again", () => {
  it("keeps the room public and starts with no clock", () => {
    const race = lobby("public", HOST, GUEST);
    evaluateQuickMatch(race);
    race.phase = "finished";
    const next = nextRace(race);
    expect(next.access).toBe("public");
    expect(next.phase).toBe("lobby");
    expect(next.startsAtTick).toBeUndefined();
    expect(next.soloFromTick).toBeUndefined();
  });
});
