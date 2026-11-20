import { describe, expect, it } from "vitest";
import { TICK_MS } from "@floor-fifty/shared/common/constants";
import {
  RoomTelemetry,
  SLOW_TICK_MS,
  STALL_MS,
  formatRoomSummary,
  liveRoomSummaries,
} from "../../../apps/server/src/rooms/room-telemetry";
import { createColyseusHarness, nextRequestId } from "../support/colyseus-harness";

/** A telemetry collector on a clock the test moves by hand. */
function driven(options: { summaries?: boolean } = {}) {
  let now = 0;
  const lines: string[] = [];
  const telemetry = new RoomTelemetry({
    serial: 7,
    now: () => now,
    log: (line) => lines.push(line),
    ...options,
  });
  return {
    telemetry,
    lines,
    advance(ms: number) {
      now += ms;
    },
    /** One ordinary tick costing `costMs`, starting `gapMs` after the last. */
    tick(gapMs = TICK_MS, costMs = 0.2) {
      now += gapMs;
      telemetry.tickStarted();
      now += costMs;
      telemetry.tickFinished({ stepMs: costMs / 2, projectMs: costMs / 4 });
      now -= costMs;
    },
  };
}

describe("room telemetry", () => {
  it("measures the tick rate the room actually delivered", () => {
    const room = driven();
    // Node's timers fire on whole milliseconds, so a 16.67 ms interval really
    // arrives every 17 ms. That is what this has to be able to see.
    for (let index = 0; index < 300; index += 1) room.tick(17);

    const summary = room.telemetry.summary();
    expect(summary.ticks).toBe(300);
    expect(summary.tickRateHz).toBeCloseTo(1000 / 17, 1);
    expect(summary.tickIntervalMs.p50).toBe(17);
    room.telemetry.dispose();
  });

  it("logs a slow tick once, then holds its peace for the cooldown", () => {
    const room = driven();
    room.tick(TICK_MS, SLOW_TICK_MS + 1);
    room.tick(TICK_MS, SLOW_TICK_MS + 1);

    const slow = room.lines.filter((line) => line.includes("slow tick"));
    expect(slow).toHaveLength(1);
    expect(slow[0]).toMatch(/^\[ff:room 7\] slow tick/);

    room.advance(10_001);
    room.tick(TICK_MS, SLOW_TICK_MS + 1);
    expect(room.lines.filter((line) => line.includes("slow tick"))).toHaveLength(2);
    room.telemetry.dispose();
  });

  it("names a stalled timer and time dropped catching up", () => {
    const room = driven();
    room.tick();
    room.tick(STALL_MS + 20);
    room.telemetry.callback(5, 42);

    expect(room.lines.some((line) => line.includes("timer stalled"))).toBe(true);
    expect(room.lines.some((line) => line.includes("dropped 42.0ms"))).toBe(true);
    expect(room.telemetry.summary().droppedMs).toBe(42);
    room.telemetry.dispose();
  });

  it("names a message that failed past its handler, once per cooldown", () => {
    const room = driven();
    room.telemetry.messageFailed("setReady", new TypeError("boom"));
    room.telemetry.messageFailed("setReady", new TypeError("boom"));

    const failed = room.lines.filter((line) => line.includes("message failed"));
    expect(failed).toEqual(["[ff:room 7] message failed setReady TypeError"]);

    room.advance(10_001);
    room.telemetry.messageFailed("pickStage", "not an error");
    expect(room.lines.at(-1)).toBe("[ff:room 7] message failed pickStage unknown");
    room.telemetry.dispose();
  });

  it("counts command request ids it could not read", () => {
    const room = driven();
    room.telemetry.requestIdDropped();
    room.telemetry.requestIdDropped();

    expect(room.telemetry.summary().droppedRequestIds).toBe(2);
    room.telemetry.dispose();
  });

  it("writes summaries only when asked to", () => {
    const quiet = driven();
    const verbose = driven({ summaries: true });
    for (const room of [quiet, verbose]) {
      for (let index = 0; index < 700; index += 1) room.tick(TICK_MS);
    }

    expect(quiet.lines).toEqual([]);
    expect(verbose.lines.some((line) => /Hz, tick ms/.test(line))).toBe(true);
    quiet.telemetry.dispose();
    verbose.telemetry.dispose();
  });

  it("counts inputs by outcome and keeps their slack", () => {
    const room = driven();
    room.telemetry.input("accepted", 2);
    room.telemetry.input("late", -1);
    room.telemetry.input("rejected-rate");

    const summary = room.telemetry.summary();
    expect(summary.inputs.accepted).toBe(1);
    expect(summary.inputs.late).toBe(1);
    expect(summary.inputs["rejected-rate"]).toBe(1);
    expect(summary.slackTicks.min).toBe(-1);
    expect(formatRoomSummary(summary)).toContain("inputs 1 ok / 1 late / 1 rejected");
    room.telemetry.dispose();
  });

  it("records a step's physics once, however often it is asked", () => {
    const room = driven();
    const stats = {
      steps: 1,
      facts: { top: 1, side: 2, underside: 0, foot: 1 },
      contacts: 9,
      bodies: 24,
    };
    room.telemetry.physics(stats);
    room.telemetry.physics(stats);

    const physics = room.telemetry.summary().physics;
    expect(physics.contacts.count).toBe(1);
    expect(physics.side.max).toBe(2);
    expect(physics.bodies).toBe(24);
    room.telemetry.dispose();
  });
});

describe("a room's telemetry", () => {
  it("measures real ticks, patches and physics, and never names the room", async () => {
    const lines: string[] = [];
    const harness = await createColyseusHarness(4182, {
      telemetry: { log: (line) => lines.push(line) },
    });
    try {
      const host = await harness.create("Kite");
      host.send("setMode", { requestId: nextRequestId(), modeId: "floors-20" });
      await harness.advanceTicks(1);
      await harness.startRace();
      await harness.driveTicks(90);

      const summary = harness.room.telemetry.summary();
      expect(summary.ticks).toBeGreaterThanOrEqual(90);
      expect(summary.physics.steps).toBeGreaterThan(0);
      expect(summary.physics.bodies).toBe(harness.room.raceState.course.floorCount + 1);
      expect(liveRoomSummaries().some((room) => room.room === summary.room)).toBe(true);

      for (const line of lines) {
        expect(line).not.toContain(host.roomId);
        expect(line).not.toContain("Kite");
      }
    } finally {
      await harness.close();
    }
  });
});
