import { describe, expect, it } from "vitest";
import { orderedResults, wasPlaced, winnerName } from "../../../../apps/client/src/features/race/results";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

/**
 * Audit S12 (found on 5 October as A04): leaving the results screen removed a
 * racer from everyone's results while `winnerId` and the standings still named
 * them, so the winner leaving first left the others with no winner and second
 * place shown as first. The server now keeps a leaver's row as a DNS, as it does
 * mid-race; the screen must still show a racer who finished as placed.
 */

const finished = (overrides: Parameters<typeof snapshotAt>[1] = {}) =>
  snapshotAt(1_000, {
    phase: "finished",
    winnerId: LOCAL_ID,
    standings: [LOCAL_ID, REMOTE_ID],
    players: [
      playerSnapshot({ id: LOCAL_ID, status: "dns", finishedAtTick: 900, bestFloor: 20 }),
      playerSnapshot({ id: REMOTE_ID, status: "connected", finishedAtTick: 960, bestFloor: 19 }),
    ],
    ...overrides,
  });

describe("a racer who finished and then left (audit S12)", () => {
  it("is still placed, with the place their finish earned", () => {
    const snapshot = finished();
    expect(wasPlaced(snapshot, snapshot.players[0]!)).toBe(true);
    expect(orderedResults(snapshot).map((player) => player.id)).toEqual([LOCAL_ID, REMOTE_ID]);
  });

  it("is still named as the winner for those who stay", () => {
    expect(winnerName(finished())).toBeDefined();
  });

  it("is not placed when they never finished, whatever their status", () => {
    const snapshot = finished({
      standings: [REMOTE_ID],
      winnerId: REMOTE_ID,
      players: [
        playerSnapshot({ id: LOCAL_ID, status: "dns" }),
        playerSnapshot({ id: REMOTE_ID, status: "connected", finishedAtTick: 960 }),
      ],
    });
    expect(wasPlaced(snapshot, snapshot.players[0]!)).toBe(false);
  });
});
