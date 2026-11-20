import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOADING_TIMEOUT_TICKS, REVEAL_TICKS, SELECT_STEP_TICKS } from "@floor-fifty/shared/common/constants";
import { spawnPosition } from "@floor-fifty/shared/common/state";
import { createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

let harness: ColyseusHarness;

/**
 * The room's own state. After a batch of ticks the harness has sent a patch,
 * but a slow machine may not have delivered it yet, so the rules are read at
 * the source; what a client sees is waited for where it is the point.
 */
const room = () => harness.room.raceState;
beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

describe("a stage pick's seed in the room (stage seeds spec §3)", () => {
  it("carries the seat's choice to every client, and races an entered seed", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Sable");
    await harness.setReady(host, true);
    await harness.setReady(guest, true);
    await vi.waitFor(() => expect(guest.state.select.picks.get(host.sessionPlayerId)!.seed).toBe("random"), { timeout: 2_000 });
    await host.pickSeed(4321);
    await guest.pickSeed(4321);
    await vi.waitFor(() => expect(guest.state.select.picks.get(host.sessionPlayerId)!.seed).toBe("4321"), { timeout: 2_000 });
    await host.lockIn();
    await guest.lockIn();
    expect(room().select?.stage?.seed).toBe(4321);
    await vi.waitFor(
      () => {
        expect(host.state.select.stageSeed).toBe(4321);
        expect(host.state.select.stageClassic).toBe(false);
        expect(host.state.seed).toBe(4321);
      },
      { timeout: 2_000 },
    );
  });

  it("refuses a seed out of bounds and keeps the choice", async () => {
    const host = await harness.create("Kite");
    await harness.setReady(host, true);
    await host.pickSeed(1_000_000);
    const result = host.messages("commandResult").at(-1) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MALFORMED_MESSAGE");
    expect(room().select?.picks[host.sessionPlayerId as never]?.seed).toBe("random");
  });

  it("shows the authored seed as Classic", async () => {
    const host = await harness.create("Kite");
    await harness.setReady(host, true);
    await host.pickSeed("classic");
    await host.lockIn();
    await vi.waitFor(
      () => {
        expect(host.state.select.stageClassic).toBe(true);
        expect(host.state.select.stageSeed).toBe(room().seed);
      },
      { timeout: 2_000 },
    );
  });
});

describe("select in the room", () => {
  it("opens the stage step once everyone is ready, and shows it to every client", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Sable");
    await harness.setReady(host, true);
    await harness.setReady(guest, true);
    await vi.waitFor(
      () => {
        expect(guest.state.phase).toBe("select");
        expect(guest.state.select.step).toBe("stage");
        expect(guest.state.select.picks.get(host.sessionPlayerId)!.focus).toBe("rooftops");
      },
      { timeout: 2_000 },
    );
  });

  it("refuses a join during select", async () => {
    const host = await harness.create("Kite");
    await harness.setReady(host, true);
    const refusal = await harness.joinById(host.roomId, "Late").catch((error: unknown) => error);
    expect(String((refusal as Error).message)).toMatch(/racing|closed/);
  });

  it("refuses readiness changes in select", async () => {
    const host = await harness.create("Kite");
    await harness.setReady(host, true);
    host.send("setReady", { requestId: nextRequestId(), ready: false });
    await harness.advanceTicks(1);
    expect(room().phase).toBe("select");
    await vi.waitFor(() => expect(host.state.phase).toBe("select"), { timeout: 2_000 });
  });

  it("races the chosen stage on its own course, and the client can rebuild it from the snapshot", async () => {
    const host = await harness.create("Kite", { access: { stages: ["rooftops", "snow-shrine", "sunken-dome"], songs: ["moving-on"], characters: ["ninja"] } });
    await harness.setReady(host, true);
    await host.pickStage("snow-shrine");
    await host.lockIn();
    expect(host.state.select.stageId).toBe("snow-shrine");
    await harness.advanceTicks(REVEAL_TICKS + 1);
    expect(room().select?.step).toBe("song");
    await host.lockIn();
    await harness.advanceTicks(REVEAL_TICKS + 1);
    expect(room().select?.step).toBe("loading");
    await host.loaded();
    expect(host.state.phase).toBe("countdown");
    expect(host.state.stageId).toBe("snow-shrine");
    const stage = harness.room.raceState;
    expect(host.state.seed).toBe(stage.seed);
    expect(host.state.seed).not.toBe(host.state.roomSeed);
    expect(host.state.courseRevision).toMatch(/^[0-9a-f]{64}$/);
  });

  it("locks the focus at 15 s and loads anyway at 10 s", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Sable");
    await harness.setReady(host, true);
    await harness.setReady(guest, true);
    await harness.advanceTicks(SELECT_STEP_TICKS + 1);
    expect(room().select?.step).toBe("stageReveal");
    await harness.advanceTicks(REVEAL_TICKS + 1);
    expect(room().select?.step).toBe("song");
    await harness.advanceTicks(SELECT_STEP_TICKS + 1);
    expect(room().select?.step).toBe("songReveal");
    await harness.advanceTicks(REVEAL_TICKS + 1);
    await host.loaded();
    await harness.advanceTicks(LOADING_TIMEOUT_TICKS + 1);
    expect(room().phase).toBe("countdown");
    await vi.waitFor(() => expect(host.state.phase).toBe("countdown"), { timeout: 2_000 });
  });

  it("goes back to the ready room on race again, keeping the room seed", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    const roomSeed = harness.room.raceState.roomSeed;
    harness.room.finishForTest();
    await harness.advanceTicks(1);
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(room().phase).toBe("lobby");
    await vi.waitFor(() => expect(host.state.phase).toBe("lobby"), { timeout: 2_000 });
    expect(harness.room.raceState.roomSeed).toBe(roomSeed);
  });

  it("shows every racer at the spawn in a countdown snapshot, and races at countdownEndsAtTick", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Sable");
    await harness.setReady(host, true);
    await harness.setReady(guest, true);
    await harness.passSelect();
    expect(room().phase).toBe("countdown");
    const spawn = spawnPosition(room().course, room().tuning);
    for (const player of Object.values(room().players)) {
      expect(player.x).toBe(spawn.x);
      expect(player.y).toBe(spawn.y);
    }
    const endsAt = room().countdownEndsAtTick!;
    await harness.advanceTicks(endsAt - room().tick - 1);
    expect(room().phase).toBe("countdown");
    await harness.advanceTicks(1);
    expect(room().phase).toBe("racing");
  });
});
