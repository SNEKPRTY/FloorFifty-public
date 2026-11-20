import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMAND_BUDGET, COUNTDOWN_TICKS, MAX_MESSAGES_PER_SECOND, RECONNECT_GRACE_TICKS, TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { CommandResult } from "@floor-fifty/shared/common/protocol";
import { answered, createColyseusHarness, nextRequestId, type ColyseusHarness } from "../support/colyseus-harness";

let harness: ColyseusHarness;

beforeEach(async () => {
  harness = await createColyseusHarness();
});
afterEach(async () => {
  await harness.close();
});

const lastResult = (client: { messages(type: string): unknown[] }): CommandResult =>
  client.messages("commandResult").at(-1) as CommandResult;

/**
 * Collects errors that escape to the process while a test runs.
 *
 * In production an escaped error ends the process (`process-safety.ts`), so a
 * message that lets one escape takes every room on the server down with it.
 */
function catchUncaught(): { readonly errors: unknown[]; stop(): void } {
  const errors: unknown[] = [];
  const record = (error: unknown): void => {
    errors.push(error);
  };
  process.on("uncaughtException", record);
  return { errors, stop: () => process.off("uncaughtException", record) };
}

describe("correlated commands", () => {
  it("answers a successful command with its own request id", async () => {
    const host = await harness.create("Kite");
    const requestId = nextRequestId();
    host.send("setReady", { requestId, ready: true });
    await harness.advanceTicks(1);
    expect(lastResult(host)).toEqual({ requestId, ok: true });
  });

  it("answers a refused command with a typed error and changes nothing", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    const requestId = nextRequestId();

    guest.send("setLapCount", { requestId, lapCount: 3 });
    await harness.advanceTicks(1);

    const result = lastResult(guest) as Extract<CommandResult, { ok: false }>;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("NOT_HOST");
    expect(host.state.lapCount).toBe(1);
  });

  it("lets the host set the mode, and shows it to everyone (race-options spec §3.2)", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Wren");
    host.send("setMode", { requestId: nextRequestId(), modeId: "floors-50" });
    await harness.advanceTicks(1);
    expect(lastResult(host).ok).toBe(true);
    expect(guest.state.modeId).toBe("floors-50");
  });

  it("refuses a lap count the mode does not offer", async () => {
    const host = await harness.create("Kite");
    host.send("setMode", { requestId: nextRequestId(), modeId: "infinite" });
    await harness.advanceTicks(1);
    host.send("setLapCount", { requestId: nextRequestId(), lapCount: 3 });
    await harness.advanceTicks(1);
    expect((lastResult(host) as Extract<CommandResult, { ok: false }>).error.code).toBe("MALFORMED_MESSAGE");
    expect(host.state.lapCount).toBe(1);
  });

  it("lets the host pick Survival's clock, shows it to everyone, and races it (survival spec §5)", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Wren");
    host.send("setMode", { requestId: nextRequestId(), modeId: "infinite" });
    await harness.advanceTicks(1);
    host.send("setClock", { requestId: nextRequestId(), seconds: 60 });
    await harness.advanceTicks(1);
    expect(lastResult(host).ok).toBe(true);
    expect(guest.state.clockSeconds).toBe(60);
    await harness.startRace();
    expect(harness.room.raceState.tuning.RACE_TIME_LIMIT_TICKS).toBe(60 * 60);
  });

  it("refuses a clock on a finite mode", async () => {
    const host = await harness.create("Kite");
    host.send("setMode", { requestId: nextRequestId(), modeId: "floors-20" });
    await harness.advanceTicks(1);
    host.send("setClock", { requestId: nextRequestId(), seconds: 60 });
    await harness.advanceTicks(1);
    expect((lastResult(host) as Extract<CommandResult, { ok: false }>).error.code).toBe("MALFORMED_MESSAGE");
    expect(host.state.clockSeconds).toBe(180);
  });

  it("races the mode's tuning over the stage's", async () => {
    const host = await harness.create("Kite");
    host.send("setMode", { requestId: nextRequestId(), modeId: "floors-50" });
    await harness.advanceTicks(1);
    await harness.startRace();
    expect(harness.room.raceState.tuning.COURSE_FLOOR_COUNT).toBe(50);
    expect(harness.room.raceState.course.floorCount).toBe(50);
  });

  it("refuses a malformed command without mutating the room", async () => {
    const host = await harness.create("Kite");
    host.send("setLapCount", { requestId: nextRequestId(), lapCount: 7 });
    await harness.advanceTicks(1);
    expect((lastResult(host) as Extract<CommandResult, { ok: false }>).error.code).toBe(
      "MALFORMED_MESSAGE",
    );
    expect(host.state.lapCount).toBe(1);
  });

  it("ignores a command whose request id cannot be read, and keeps serving the room (audit A01)", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    const uncaught = catchUncaught();
    try {
      // `toString` that is not a function: converting this id to a string throws.
      guest.send("setReady", { requestId: { toString: 1 }, ready: true });
      guest.send("setReady", { requestId: 42, ready: true });
      guest.send("setReady", { requestId: "x".repeat(65), ready: true });

      // A valid command on the same socket: messages from one socket are
      // handled in order, so its answer proves the three above were processed.
      const requestId = nextRequestId();
      guest.send("setReady", { requestId, ready: false });
      await answered(guest, requestId);

      expect(uncaught.errors).toEqual([]);
      // Only the valid command was answered; the unreadable ids got nothing.
      expect(guest.messages("commandResult")).toEqual([{ requestId, ok: true }]);
      expect(harness.room.race.players[guest.sessionPlayerId]!.ready).toBe(false);
      expect(harness.room.telemetry.summary().droppedRequestIds).toBe(3);
    } finally {
      uncaught.stop();
    }
  });

  it("keeps a message that throws past its handler inside the room (audit A01)", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    const uncaught = catchUncaught();
    // No tick runs between here and the answer below (the harness stops the
    // room's clock; only `advanceTicks` steps it), so the tick's own
    // `project()` call cannot use this up: only the message handler can.
    const project = vi.spyOn(harness.room, "project").mockImplementationOnce(() => {
      throw new TypeError("a bug after the command ran");
    });
    try {
      const guestRequestId = nextRequestId();
      guest.send("setReady", { requestId: guestRequestId, ready: true });
      await answered(guest, guestRequestId);
      // The handler sent its answer, then threw from `project()`.
      expect(project).toHaveBeenCalledTimes(1);
      expect(lastResult(guest)).toEqual({ requestId: guestRequestId, ok: true });
      project.mockRestore();

      const hostRequestId = nextRequestId();
      host.send("setReady", { requestId: hostRequestId, ready: true });
      await answered(host, hostRequestId);

      expect(uncaught.errors).toEqual([]);
      expect(lastResult(host)).toEqual({ requestId: hostRequestId, ok: true });
    } finally {
      project.mockRestore();
      uncaught.stop();
    }
  });

  it("replays a stored answer for a repeated request id rather than acting twice", async () => {
    const host = await harness.create("Kite");
    const requestId = nextRequestId();

    host.send("setReady", { requestId, ready: true });
    await harness.advanceTicks(1);
    host.send("setReady", { requestId, ready: false });
    await harness.advanceTicks(1);

    expect(lastResult(host)).toEqual({ requestId, ok: true });
    expect(host.state.players.get(host.sessionPlayerId)!.ready).toBe(true);
  });

  it("lets the host choose a three-lap race in the lobby", async () => {
    const host = await harness.create("Kite");
    host.send("setMode", { requestId: nextRequestId(), modeId: "floors-20" });
    await harness.advanceTicks(1);
    const requestId = nextRequestId();

    host.send("setLapCount", { requestId, lapCount: 3 });
    await harness.advanceTicks(1);

    expect(lastResult(host)).toEqual({ requestId, ok: true });
    expect(host.state.lapCount).toBe(3);
  });

  it("refuses a lap change once the room has left the lobby", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();

    host.send("setLapCount", { requestId: nextRequestId(), lapCount: 3 });
    await harness.advanceTicks(1);

    expect((lastResult(host) as Extract<CommandResult, { ok: false }>).error.code).toBe(
      "MALFORMED_MESSAGE",
    );
    expect(host.state.lapCount).toBe(1);
  });

  it("remembers only the most recent results", async () => {
    const host = await harness.create("Kite");
    // A second seat, unready, keeps the room in the lobby, where readiness can change.
    await harness.joinById(host.roomId, "Sable");
    const first = nextRequestId();
    host.send("setReady", { requestId: first, ready: true });
    await harness.advanceTicks(1);
    // One command per earned credit: the room clock pays COMMAND_BUDGET.perSecond a second, and a
    // faster run is dropped before the ledger sees it (audit B2).
    const ticksPerCommand = Math.ceil(TICK_HZ / COMMAND_BUDGET.perSecond);
    for (let index = 0; index < 80; index += 1) {
      host.send("setReady", { requestId: nextRequestId(), ready: true });
      await harness.advanceTicks(ticksPerCommand);
    }
    // Forgotten, so the command runs again -- which is correct and bounded.
    host.send("setReady", { requestId: first, ready: false });
    await harness.advanceTicks(1);
    expect(host.state.players.get(host.sessionPlayerId)!.ready).toBe(false);
  });
});

describe("input authority", () => {
  // Stamped for tick zero, which is always in the past once a race is under
  // way: each frame takes effect on the next tick the room steps.
  const frame = (sequence: number) => ({
    sequence,
    tick: 0,
    left: false,
    right: true,
    fastFall: false,
    reset: false,
  });

  it("acknowledges the highest sequence it has consumed", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();

    host.send("input", frame(5));
    await harness.advanceTicks(2);

    expect(host.state.players.get(host.sessionPlayerId)!.lastAckedSequence).toBe(5);
  });

  it("ignores a sequence that moved backward", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();

    host.send("input", frame(9));
    await harness.advanceTicks(2);
    host.send("input", frame(3));
    await harness.advanceTicks(2);

    expect(host.state.players.get(host.sessionPlayerId)!.lastAckedSequence).toBe(9);
  });

  it("holds the latest frame until a newer one arrives", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();

    host.send("input", frame(1));
    await harness.advanceTicks(10);

    expect(host.state.players.get(host.sessionPlayerId)!.vx).toBeGreaterThan(0);
  });

  // A burst well over the one-second input budget and just under
  // MAX_MESSAGES_PER_SECOND. These tests once sent 240 frames and expected no
  // disconnect, because nothing limited messages. The rule changed (audit B2):
  // over 200 in a second Colyseus closes the socket, so 240 is no longer a
  // flood the room survives. The same test with a burst just over the limit is
  // in `race-room-command-budget.test.ts`.
  const FLOOD = MAX_MESSAGES_PER_SECOND - 10;

  it("drops a flood without disconnecting the player", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();

    for (let index = 1; index <= FLOOD; index += 1) host.send("input", frame(index));
    await harness.advanceTicks(2);

    const acked = host.state.players.get(host.sessionPlayerId)!.lastAckedSequence;
    expect(acked).toBeLessThan(FLOOD);
    expect(host.state.players.size).toBe(1);
  });

  it("refuses input over the one-second budget as rate-limited, and earns it back", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();

    for (let index = 1; index <= FLOOD; index += 1) host.send("input", frame(index));
    await harness.advanceTicks(1);
    const flooded = harness.room.telemetry.summary().inputs;
    expect(flooded["rejected-rate"]).toBeGreaterThan(0);

    // A tick later the seat has earned credit back, so its next frame is taken.
    await harness.advanceTicks(1);
    host.send("input", frame(FLOOD + 1));
    await harness.advanceTicks(1);
    expect(harness.room.telemetry.summary().inputs.late).toBe(flooded.late + 1);
  });

  it("refuses input outside a race", async () => {
    const host = await harness.create("Kite");
    host.send("input", frame(1));
    await harness.advanceTicks(2);
    expect(host.state.players.get(host.sessionPlayerId)!.lastAckedSequence).toBe(0);
  });

  it("refuses an input sequence that jumps beyond the reconnect window", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();

    // A frame far ahead of the one authority holds is not a fast client, it is
    // a client that has lost track -- and accepting it would skip the race
    // forward by the distance the sequence implies.
    host.send("input", frame(RECONNECT_GRACE_TICKS + 5));
    await harness.advanceTicks(2);

    expect(host.state.players.get(host.sessionPlayerId)!.lastAckedSequence).toBe(0);
  });

  it("holds a frame stamped ahead until its own tick", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    const due = harness.room.raceState.tick + 4;

    host.send("input", { ...frame(1), tick: due });
    await harness.advanceTicks(3);
    expect(host.state.players.get(host.sessionPlayerId)!.lastAckedSequence).toBe(0);

    await harness.advanceTicks(1);
    expect(harness.room.raceState.tick).toBe(due);
    expect(host.state.players.get(host.sessionPlayerId)!.lastAckedSequence).toBe(1);
    expect(host.state.players.get(host.sessionPlayerId)!.vx).toBeGreaterThan(0);
  });

  it("takes input during the countdown and applies it on the first racing tick", async () => {
    // Holding a direction through GO must move the racer on the first tick,
    // exactly as it would in a local game.
    const host = await harness.create("Kite");
    await harness.setReady(host, true);
    await harness.passSelect();
    host.send("input", { ...frame(1), tick: 0 });
    await harness.advanceTicks(COUNTDOWN_TICKS + 1);

    const player = harness.room.raceState.players[host.sessionPlayerId]!;
    expect(harness.room.raceState.phase).toBe("racing");
    expect(player.lastSequence).toBe(1);
    expect(player.vx).toBeGreaterThan(0);
  });

  it("answers a ping with how early its tick was", async () => {
    const host = await harness.create("Kite");
    await harness.advanceTicks(10);
    const now = harness.room.raceState.tick;

    host.send("ping", { id: 7, tick: now + 3 });
    host.send("ping", { id: 8, tick: -1 });
    await harness.advanceTicks(1);

    const pongs = host.messages("pong") as { id: number; slack: number | null }[];
    expect(pongs[0]?.id).toBe(7);
    // Three ticks ahead of the room, less however far it had got toward the
    // next tick when the probe arrived.
    expect(pongs[0]!.slack!).toBeGreaterThan(1.9);
    expect(pongs[0]!.slack!).toBeLessThanOrEqual(3);
    // The second probe came too soon after the first, and is not answered.
    expect(pongs.map((pong) => pong.id)).not.toContain(8);
  });

  it("never lets a frame claim a position", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    const before = host.state.players.get(host.sessionPlayerId)!.y;

    host.send("input", { ...frame(1), y: 9_999, progress: 1 });
    await harness.advanceTicks(1);

    expect(host.state.players.get(host.sessionPlayerId)!.y).not.toBe(9_999);
    expect(host.state.players.get(host.sessionPlayerId)!.progress).toBeLessThan(1);
    void before;
  });
});

describe("race again", () => {
  it("returns a finished room to a fresh lobby keeping the roster", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    harness.room.finishForTest();
    await harness.advanceTicks(1);

    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);

    expect(host.state.phase).toBe("lobby");
    expect(host.state.players.size).toBe(1);
    expect(host.state.players.get(host.sessionPlayerId)!.ready).toBe(false);
    expect(host.state.winnerId).toBe("");
  });

  it("hands the host to a remaining racer when the host expired to a DNS", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await harness.startRace();

    await harness.drop(host);
    await harness.advanceTicks(RECONNECT_GRACE_TICKS + 1);
    harness.room.finishForTest();
    await harness.advanceTicks(1);

    guest.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);

    expect(harness.room.raceState.phase).toBe("lobby");
    expect(harness.room.raceState.players[host.sessionPlayerId]).toBeUndefined();
    expect(harness.room.raceState.hostId).toBe(guest.sessionPlayerId);
  });

  it("keeps a racer who dropped before race again as a ghost the new lobby can let go", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await harness.startRace();
    harness.room.finishForTest();
    await harness.advanceTicks(1);

    await harness.drop(guest);
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    // Still held for them, and shown as dropped rather than as a racer.
    expect(harness.room.raceState.players[guest.sessionPlayerId]?.status).toBe("ghost");

    // They never come back: the seat frees, and the host can start alone.
    await harness.advanceTicks(RECONNECT_GRACE_TICKS + 1);
    expect(harness.room.raceState.players[guest.sessionPlayerId]).toBeUndefined();
    await harness.setReady(host, true);
    expect(harness.room.raceState.phase).toBe("select");
  });

  it("lets a racer who dropped before race again come back to the new lobby", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    await harness.startRace();
    harness.room.finishForTest();
    await harness.advanceTicks(1);

    const token = guest.reconnectionToken;
    await harness.drop(guest);
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    const resumed = await harness.reconnect(token);

    expect(harness.room.raceState.players[resumed.sessionPlayerId]?.status).toBe("connected");
    expect(harness.room.raceState.players[resumed.sessionPlayerId]?.ghostDeadlineTick).toBeUndefined();
  });

  it("refuses race again while a race is still running", async () => {
    const host = await harness.create("Kite");
    await harness.startRace();
    host.send("raceAgain", { requestId: nextRequestId() });
    await harness.advanceTicks(1);
    expect(lastResult(host)).toMatchObject({ ok: false });
  });
});
