import { describe, expect, it } from "vitest";
import { orderedResults } from "../../../../apps/client/src/features/race/results";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { playerSnapshot, snapshotAt } from "../../support/snapshots";

/**
 * The walk of 2026-11-19 (review R20 on #218): racers who did not finish a floors race came in
 * roster order, so "Floor 42" stood above "Floor 43". The list reads top to bottom as best to
 * worst: the server's placed racers first, then the rest by the floor they reached, then by who
 * reached it first; a racer who never started is last.
 */
describe("the results order", () => {
  it("puts the racers who did not finish in order of the floor they reached", () => {
    const snapshot = snapshotAt(1_000, {
      phase: "finished",
      winnerId: asPlayerId("koi"),
      standings: [asPlayerId("koi")],
      players: [
        playerSnapshot({ id: asPlayerId("koi"), status: "connected", finishedAtTick: 900, bestFloor: 50 }),
        playerSnapshot({ id: asPlayerId("nana"), status: "connected", bestFloor: 24, bestFloorAtTick: 500 }),
        playerSnapshot({ id: asPlayerId("gone"), status: "dns", bestFloor: 0 }),
        playerSnapshot({ id: asPlayerId("moth"), status: "connected", bestFloor: 30, bestFloorAtTick: 700 }),
        playerSnapshot({ id: asPlayerId("sunny"), status: "connected", bestFloor: 30, bestFloorAtTick: 600 }),
      ],
    });
    expect(orderedResults(snapshot).map((player) => String(player.id))).toEqual(["koi", "sunny", "moth", "nana", "gone"]);
  });
});
