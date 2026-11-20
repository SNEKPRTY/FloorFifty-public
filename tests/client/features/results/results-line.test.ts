import { describe, expect, it } from "vitest";
import { resultLine } from "../../../../apps/client/src/features/race/results";
import * as m from "../../../../apps/client/src/paraglide/messages.js";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const race = (overrides: Parameters<typeof snapshotAt>[1] = {}) =>
  snapshotAt(2_000, { phase: "finished", standings: [LOCAL_ID], winnerId: LOCAL_ID, ...overrides });

describe("resultLine", () => {
  it("tells a floors racer who did not finish how far they got", () => {
    const snapshot = race({
      players: [
        playerSnapshot({ id: LOCAL_ID, finishedAtTick: 900, bestFloor: 50 }),
        playerSnapshot({ id: REMOTE_ID, bestFloor: 12 }),
      ],
    });
    expect(resultLine(snapshot.players[1]!, snapshot)).toBe(m.results_best_floor({ floor: 12 }));
  });

  it("gives a finisher the time, not the floor", () => {
    const snapshot = race({ players: [playerSnapshot({ id: LOCAL_ID, finishedAtTick: 900, bestFloor: 50 })] });
    expect(resultLine(snapshot.players[0]!, snapshot)).toMatch(/^\d+:\d\d\.\d\d$/);
  });

  it("still says Did not start for a racer who never started", () => {
    const snapshot = race({ players: [playerSnapshot({ id: LOCAL_ID, status: "dns" })] });
    expect(resultLine(snapshot.players[0]!, snapshot)).toBe(m.race_status_dns());
  });
});
