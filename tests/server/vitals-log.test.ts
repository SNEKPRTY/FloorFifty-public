import { afterEach, describe, expect, it } from "vitest";
import { ContentStore } from "../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../apps/server/src/content/generated-content";
import { createColyseusRaceServer, type ColyseusRaceServer } from "../../apps/server/src/colyseus-server";

/**
 * Audit S25: the one regular line was the room count, once a minute. Players,
 * sockets, memory, event-loop delay and the build at start were not recorded,
 * so a climb toward running out of memory was invisible until the restart. The
 * numbers only: nothing in a line names a person, an address or a room code.
 */

let server: ColyseusRaceServer | undefined;
let lines: string[] = [];
afterEach(async () => {
  await server?.close();
  server = undefined;
  lines = [];
});

const start = async (): Promise<void> => {
  server = await createColyseusRaceServer({
    port: 0,
    contentStore: new ContentStore(GENERATED_CONTENT),
    buildId: "202611140000-abc1234",
    telemetry: { log: (line) => void lines.push(line) },
    roomsLogEveryMs: 20,
  });
};

const records = (event: string): Record<string, unknown>[] =>
  lines.flatMap((line) => {
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      return record.event === event ? [record] : [];
    } catch {
      return [];
    }
  });

describe("the process's vital signs (audit S25)", () => {
  it("says which build started, once", async () => {
    await start();
    expect(records("start")).toEqual([{ event: "start", build: "202611140000-abc1234", node: process.version }]);
  });

  it("writes rooms, sockets, memory and event-loop delay on its interval", async () => {
    await start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const vitals = records("vitals");
    expect(vitals.length).toBeGreaterThan(0);
    expect(vitals.at(-1)).toEqual({
      event: "vitals",
      rooms: 0,
      sockets: 0,
      rssMb: expect.any(Number),
      heapMb: expect.any(Number),
      loopP99Ms: expect.any(Number),
      uptimeS: expect.any(Number),
    });
    expect(vitals.at(-1)!["rssMb"]).toBeGreaterThan(0);
  });

  it("keeps the room count line the weekly report already reads", async () => {
    await start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(records("rooms").length).toBeGreaterThan(0);
  });

  it("names no address, name or code", async () => {
    await start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(lines.join("\n")).not.toContain("127.0.0.1");
  });
});
