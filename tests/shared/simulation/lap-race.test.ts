import { describe, expect, it } from "vitest";
import {
  PLAYER_ID,
  advance,
  completeAscent,
  completeLaps,
  freshRaceState,
  inputFor,
  noInput,
  playerOf,
} from "../support/race";

const oneLapRace = () => freshRaceState(1);
const threeLapRace = () => freshRaceState(3);

describe("lap accounting", () => {
  it("finishes a one-lap race after a single complete ascent", () => {
    const result = completeAscent(oneLapRace());
    expect(result.state.phase).toBe("finished");
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: "raceFinished", winnerId: PLAYER_ID }),
    );
  });

  it("finishes only after the configured third ascent", () => {
    const afterTwo = completeLaps(2, threeLapRace());
    expect(afterTwo.state.phase).toBe("racing");
    expect(completeLaps(1, afterTwo.state).state.phase).toBe("finished");
  });

  it("restarts the ascent at the starting floor on a non-final lap", () => {
    const afterOne = completeAscent(threeLapRace());
    const player = playerOf(afterOne.state);
    expect(player.lap).toBe(2);
    expect(player.visitedFloorIds).toEqual([afterOne.state.course.floors[0]!.id]);
    expect(player.y).toBeGreaterThan(afterOne.state.course.floors[0]!.y);
    expect(afterOne.events).toContainEqual(
      expect.objectContaining({ type: "lapCompleted", playerId: PLAYER_ID, lap: 1 }),
    );
  });

  it("emits exactly one raceFinished event for a race", () => {
    const result = completeLaps(3, threeLapRace());
    const finishes = result.events.filter((event) => event.type === "raceFinished");
    expect(finishes).toHaveLength(1);
  });

  it("records the winner and the standings on the server state alone", () => {
    const result = completeAscent(oneLapRace());
    expect(result.state.winnerId).toBe(PLAYER_ID);
    expect(result.state.standings).toEqual([PLAYER_ID]);
    expect(playerOf(result.state).finishedAtTick).toBeGreaterThan(0);
  });
});

describe("finished races", () => {
  it("ignores movement input once the race is finished", () => {
    const finished = completeAscent(oneLapRace()).state;
    const after = advance(finished, inputFor({ right: true, sequence: 9_999 }));
    expect(after.state.players[PLAYER_ID]!.x).toBe(finished.players[PLAYER_ID]!.x);
    expect(after.events).toEqual([]);
  });

  it("does not advance a race that is still in the lobby", () => {
    const lobby = { ...oneLapRace(), phase: "lobby" as const };
    const after = advance(lobby, noInput());
    expect(after.state.players[PLAYER_ID]!.y).toBe(lobby.players[PLAYER_ID]!.y);
  });
});
