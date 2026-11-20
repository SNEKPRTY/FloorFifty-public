import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { DRAIN_MAX_MS, drainOnSigterm, waitForRoomsToEmpty, type DrainResult } from "../../apps/server/src/drain";

/** A clock that moves only when the drain sleeps, so the cap is exact. */
function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

describe("waiting for rooms to empty", () => {
  it("returns at once when no room is open", async () => {
    const clock = fakeClock();
    const result = await waitForRoomsToEmpty({ countRooms: async () => 0, ...clock });
    expect(result).toBe("empty");
    expect(clock.sleeps).toEqual([]);
  });

  it("polls until the last room closes", async () => {
    const clock = fakeClock();
    const counts = [2, 1, 0];
    const result = await waitForRoomsToEmpty({ countRooms: async () => counts.shift() ?? 0, pollMs: 1_000, ...clock });
    expect(result).toBe("empty");
    expect(clock.sleeps).toEqual([1_000, 1_000]);
  });

  it("gives up at the cap, never past it", async () => {
    const clock = fakeClock();
    const result = await waitForRoomsToEmpty({ countRooms: async () => 1, capMs: 2_500, pollMs: 1_000, ...clock });
    expect(result).toBe("cap");
    expect(clock.sleeps).toEqual([1_000, 1_000, 500]);
  });

  // Fly stops a Machine after `kill_timeout`, at most 300 s and best-effort, so
  // the drain must end well inside it (finish for launch §2.3).
  it("caps at 270 s by default, under Fly's 300 s kill timeout", () => {
    expect(DRAIN_MAX_MS).toBe(270_000);
    expect(DRAIN_MAX_MS).toBeLessThanOrEqual(270_000);
  });
});

describe("draining on SIGTERM", () => {
  it("drains once and exits 0, however many times the signal comes", async () => {
    const signals = new EventEmitter();
    let drains = 0;
    let finish: (result: DrainResult) => void = () => undefined;
    const server = {
      drain: () => {
        drains += 1;
        return new Promise<DrainResult>((resolve) => (finish = resolve));
      },
    };
    const exits: number[] = [];
    const lines: string[] = [];

    drainOnSigterm(server, signals, (code) => exits.push(code), (line) => lines.push(line));
    signals.emit("SIGTERM");
    signals.emit("SIGTERM");
    finish("empty");
    await new Promise((resolve) => setImmediate(resolve));

    expect(drains).toBe(1);
    expect(exits).toEqual([0]);
    expect(lines).toEqual(["floor-fifty server draining", "floor-fifty server drained (empty)"]);
  });

  it("exits 1 when the drain itself fails", async () => {
    const signals = new EventEmitter();
    const exits: number[] = [];
    drainOnSigterm({ drain: () => Promise.reject(new Error("boom")) }, signals, (code) => exits.push(code), () => undefined);
    signals.emit("SIGTERM");
    await new Promise((resolve) => setImmediate(resolve));
    expect(exits).toEqual([1]);
  });
});
