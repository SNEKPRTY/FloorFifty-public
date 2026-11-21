import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECONNECT_GRACE_TICKS } from "@floor-fifty/shared/common/constants";
import { createColyseusHarness, type ColyseusHarness } from "../support/colyseus-harness";

/**
 * Audit S24: creating, joining, leaving and closing a room logged nothing, and
 * neither did a reconnect that succeeded or ran out, so "the race froze at
 * 19:42" could only be matched by the clock. A room is named by its
 * process-local serial; no address, name or room code is ever logged.
 */

let harness: ColyseusHarness;
let lines: string[] = [];
beforeEach(async () => {
  lines = [];
  harness = await createColyseusHarness(4182, { telemetry: { log: (line) => void lines.push(line) } });
});
afterEach(async () => {
  await harness.close();
});

type Record = { event?: string; op?: string; room?: number; [key: string]: unknown };
const records = (event: string): Record[] =>
  lines.flatMap((line) => {
    try {
      const record = JSON.parse(line) as Record;
      return record.event === event ? [record] : [];
    } catch {
      return [];
    }
  });
const ops = (event: string): string[] => records(event).map((record) => String(record.op));

describe("a room's life in the journal (audit S24)", () => {
  it("opens with its serial and whether it is public", async () => {
    await harness.create("Kite");
    expect(records("room")).toEqual([{ event: "room", op: "open", room: harness.room.telemetry.serial, access: "private" }]);
  });

  it("logs each seat joining, with how many sit in the room", async () => {
    const host = await harness.create("Kite");
    await harness.joinById(host.roomId, "Ninja");
    expect(records("seat")).toEqual([
      { event: "seat", op: "join", room: harness.room.telemetry.serial, players: 1 },
      { event: "seat", op: "join", room: harness.room.telemetry.serial, players: 2 },
    ]);
  });

  it("tells a seat that left for good from one that dropped", async () => {
    const host = await harness.create("Kite");
    const guest = await harness.joinById(host.roomId, "Ninja");
    const dropper = await harness.joinById(host.roomId, "Wren");
    await guest.leave(true);
    await harness.drop(dropper);
    await harness.advanceTicks(1);
    const leaves = records("seat").filter((record) => record.op === "leave");
    expect(leaves.map((record) => record.consented)).toEqual([true, false]);
  });

  it("logs a held seat that came back, and one that ran out of grace", async () => {
    const host = await harness.create("Kite");
    const back = await harness.joinById(host.roomId, "Ninja");
    const gone = await harness.joinById(host.roomId, "Wren");
    const token = back.reconnectionToken;
    await harness.drop(back);
    await harness.drop(gone);
    await harness.advanceTicks(2);
    await harness.reconnect(token);
    await harness.advanceTicks(RECONNECT_GRACE_TICKS + 1);
    expect(ops("seat")).toContain("return");
    expect(ops("seat")).toContain("expired");
  });

  it("closes with its serial and how many ticks it ran", async () => {
    const host = await harness.create("Kite");
    await harness.advanceTicks(5);
    await host.leave(true);
    await harness.waitForDisposal();
    const closed = records("room").find((record) => record.op === "close");
    expect(closed).toMatchObject({ event: "room", op: "close", room: harness.room.telemetry.serial });
    expect(closed!["ticks"]).toBeGreaterThanOrEqual(5);
  });

  it("logs no name, no address and no room code", async () => {
    const host = await harness.create("Kite");
    await harness.joinById(host.roomId, "Latecomer");
    const text = lines.join("\n");
    expect(text).not.toContain("Kite");
    expect(text).not.toContain("Latecomer");
    expect(text).not.toContain(host.roomId);
    expect(text).not.toContain("127.0.0.1");
  });
});
