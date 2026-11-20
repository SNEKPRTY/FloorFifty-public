import { describe, expect, it } from "vitest";
import { TICK_MS } from "@floor-fifty/shared/common/constants";
import { scoreToSubmit } from "../../../../apps/client/src/features/race/scores";
import { SCORE_BOARDS } from "../../../../apps/client/src/features/ruken/score-boards";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

/** A finished race in which the local player crossed the line at `ticks`. */
const finishedRace = (ticks: number | undefined, overrides: Parameters<typeof snapshotAt>[1] = {}) =>
  snapshotAt(ticks ?? 0, {
    phase: "finished",
    players: [playerSnapshot({ id: LOCAL_ID, ...(ticks === undefined ? {} : { finishedAtTick: ticks }) }), playerSnapshot({ id: REMOTE_ID, finishedAtTick: 3000 })],
    standings: [LOCAL_ID, REMOTE_ID],
    winnerId: LOCAL_ID,
    ...overrides,
  });

describe("the score a finished race gives the leaderboard", () => {
  it("is the local player's own finish time in milliseconds, on the board of the race's mode", () => {
    expect(scoreToSubmit(finishedRace(1200), LOCAL_ID)).toEqual({ board: "floors-20", score: Math.round(1200 * TICK_MS) });
    const fifty = finishedRace(3600, { modeId: "floors-50", floorCount: 50 });
    expect(scoreToSubmit(fifty, LOCAL_ID)).toEqual({ board: "floors-50", score: Math.round(3600 * TICK_MS) });
  });

  it("is a whole number, because the leaderboard only takes integers", () => {
    // One tick is 16.666... ms.
    const score = scoreToSubmit(finishedRace(1001), LOCAL_ID)?.score;
    expect(Number.isSafeInteger(score)).toBe(true);
    expect(score).toBe(Math.round(1001 * TICK_MS));
  });

  it("uses the local player's time, not the winner's", () => {
    const race = finishedRace(2400, { winnerId: REMOTE_ID, standings: [REMOTE_ID, LOCAL_ID] });
    expect(scoreToSubmit(race, LOCAL_ID)?.score).toBe(Math.round(2400 * TICK_MS));
  });

  it("is nothing for a player who did not finish", () => {
    expect(scoreToSubmit(finishedRace(undefined), LOCAL_ID)).toBeUndefined();
  });

  it("is nothing for a player who was never placed, even with a time", () => {
    expect(scoreToSubmit(finishedRace(1200, { standings: [REMOTE_ID] }), LOCAL_ID)).toBeUndefined();
  });

  it("is nothing for a player who did not start (DNS)", () => {
    const race = finishedRace(1200, {
      // No finish time: a racer who did not start never has one. (One who finished and then left the results
      // keeps their place and their time, audit S12.)
      players: [playerSnapshot({ id: LOCAL_ID, status: "dns" }), playerSnapshot({ id: REMOTE_ID })],
    });
    expect(scoreToSubmit(race, LOCAL_ID)).toBeUndefined();
  });

  it("is nothing when the local player is not in the room's snapshot", () => {
    expect(scoreToSubmit(finishedRace(1200), undefined)).toBeUndefined();
  });

  it("is nothing for a three-lap race, which is a longer climb than the board's", () => {
    expect(scoreToSubmit(finishedRace(1200, { lapCount: 3 }), LOCAL_ID)).toBeUndefined();
  });

  it("is nothing for a mode with no board", () => {
    expect(scoreToSubmit(finishedRace(1200, { modeId: "no-such-mode" }), LOCAL_ID)).toBeUndefined();
  });

  it("is nothing before the race is over", () => {
    expect(scoreToSubmit(finishedRace(1200, { phase: "racing" }), LOCAL_ID)).toBeUndefined();
  });
});

/** A Survival room (mode `infinite`) in which the local player's best floor is `bestFloor`. */
const survival = (
  phase: "racing" | "finished",
  local: Parameters<typeof playerSnapshot>[0] = {},
  overrides: Parameters<typeof snapshotAt>[1] = {},
) =>
  snapshotAt(900, {
    phase,
    modeId: "infinite",
    floorCount: 50,
    players: [playerSnapshot({ id: LOCAL_ID, bestFloor: 23, ...local }), playerSnapshot({ id: REMOTE_ID, bestFloor: 31 })],
    standings: phase === "finished" ? [REMOTE_ID, LOCAL_ID] : [],
    ...overrides,
  });

describe("the score a Survival run gives the leaderboard", () => {
  it("is the local player's highest floor, on the survival board, when the room finishes", () => {
    expect(scoreToSubmit(survival("finished"), LOCAL_ID)).toEqual({ board: "survival", score: 23 });
  });

  it("is the local player's highest floor, not the winner's", () => {
    expect(scoreToSubmit(survival("finished", { bestFloor: 12 }, { winnerId: REMOTE_ID }), LOCAL_ID)?.score).toBe(12);
  });

  it("is sent when the local player is knocked out while others race on, as their run is over", () => {
    expect(scoreToSubmit(survival("racing", { outAtTick: 640 }), LOCAL_ID)).toEqual({ board: "survival", score: 23 });
  });

  it("is sent when the player leaves mid-run, as that ends their run", () => {
    expect(scoreToSubmit(survival("racing"), LOCAL_ID, { left: true })).toEqual({ board: "survival", score: 23 });
  });

  it("is nothing mid-run, while the local player is still standing", () => {
    expect(scoreToSubmit(survival("racing"), LOCAL_ID)).toBeUndefined();
  });

  it.each([
    ["finishes", survival("finished", { bestFloor: 0 }), false],
    ["is knocked out", survival("racing", { bestFloor: 0, outAtTick: 200 }), false],
    ["is left", survival("racing", { bestFloor: 0 }), true],
  ] as const)("is nothing for a run that %s without clearing a floor, which the board would refuse", (_, room, left) => {
    expect(scoreToSubmit(room, LOCAL_ID, { left })).toBeUndefined();
  });

  it("is nothing above the board's range, so nothing Ruken refuses is sent", () => {
    expect(scoreToSubmit(survival("finished", { bestFloor: SCORE_BOARDS["survival"]!.max + 1 }), LOCAL_ID)).toBeUndefined();
  });

  it("is nothing for a player who did not start (DNS)", () => {
    expect(scoreToSubmit(survival("finished", { status: "dns", bestFloor: 4 }), LOCAL_ID)).toBeUndefined();
  });

  it("is nothing for a time race the player leaves, which has no time to post", () => {
    expect(scoreToSubmit(finishedRace(1200, { phase: "racing" }), LOCAL_ID, { left: true })).toBeUndefined();
  });
});

describe("the boards Floor Fifty declares", () => {
  it("are the two best-time boards, lowest first, and Survival's highest floor, highest first", () => {
    expect(Object.keys(SCORE_BOARDS)).toEqual(["floors-20", "floors-50", "survival"]);
    for (const id of ["floors-20", "floors-50"]) {
      expect(SCORE_BOARDS[id]!.order).toBe("asc");
      expect(SCORE_BOARDS[id]!.min).toBeGreaterThan(0);
      expect(SCORE_BOARDS[id]!.max).toBeGreaterThan(SCORE_BOARDS[id]!.min);
    }
    // The Owner's F1 decision (2026-10-27): higher is better; floor 0 is never sent.
    expect(SCORE_BOARDS["survival"]).toEqual({ order: "desc", min: 1, max: 1000, title: "Highest floor" });
  });
});
