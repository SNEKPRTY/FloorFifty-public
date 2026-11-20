import { afterEach, describe, expect, it, vi } from "vitest";
import { matchMaker } from "@colyseus/core";
import { PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";
import { ContentStore } from "../../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import {
  createColyseusRaceServer,
  type ColyseusRaceServer,
  type ColyseusRaceServerOptions,
} from "../../../apps/server/src/colyseus-server";

let server: ColyseusRaceServer | undefined;
let lines: string[] = [];

afterEach(async () => {
  await server?.close();
  server = undefined;
  lines = [];
});

const start = async (over: Partial<ColyseusRaceServerOptions> = {}): Promise<string> => {
  server = await createColyseusRaceServer({
    port: 0,
    contentStore: new ContentStore(GENERATED_CONTENT),
    telemetry: { log: (line) => lines.push(line) },
    ...over,
  });
  return `http://127.0.0.1:${server.port}`;
};

const create = (base: string) =>
  fetch(`${base}/matchmake/create/race`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
  });

const refusals = (): string[] =>
  lines.flatMap((line) => {
    try {
      const record = JSON.parse(line) as { event?: string; limit?: string };
      return record.event === "refused" ? [String(record.limit)] : [];
    } catch {
      return [];
    }
  });

describe("what the server tells the weekly report (release readiness §7.3)", () => {
  it("logs a rate refusal by its limit, with no address", async () => {
    const base = await start();
    for (let index = 0; index < 4; index += 1) await create(base);
    expect(refusals()).toEqual(["create"]);
    expect(lines.join("\n")).not.toContain("127.0.0.1");
  });

  // Audit S26: one line per refused request let a loop of them bury the journal.
  it("writes a flood of refusals as a line and a count, and loses none of them", async () => {
    const base = await start();
    for (let index = 0; index < 30; index += 1) await create(base);
    // Closing writes what is still counted.
    await server!.close();
    server = undefined;
    const records = lines
      .map((line) => JSON.parse(line) as { event?: string; limit?: string; n?: number })
      .filter((record) => record.event === "refused" && record.limit === "create");
    expect(records.length).toBeLessThanOrEqual(3);
    expect(records.reduce((total, record) => total + (record.n ?? 1), 0)).toBe(27);
  });

  it("logs a room refused at the cap as busy", async () => {
    const base = await start({ maxRooms: 1 });
    await create(base);
    await create(base);
    expect(refusals()).toEqual(["busy"]);
  });

  // A refused room never finished building; tearing it down must not throw,
  // or every refusal at capacity writes a stack trace to the journal.
  it("tears down a room refused at the cap without an error", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args));
    const base = await start({ maxRooms: 1 });
    await create(base);
    await create(base);
    await new Promise((resolve) => setTimeout(resolve, 50));
    spy.mockRestore();
    expect(errors.map(String).join("\n")).not.toMatch(/onDispose|reading 'dispose'/);
  });

  it("logs a new room refused while draining", async () => {
    const base = await start();
    // A room past its race holds the drain open, so the server is there to refuse.
    const { roomId } = (await (await create(base)).json()) as { roomId: string };
    (matchMaker.getLocalRoomById(roomId) as unknown as { finishForTest(): void }).finishForTest();
    void server!.drain(2_000);
    await create(base);
    expect(refusals()).toContain("draining");
  });

  // Audit S23: a failed join was invisible, so after a release a version
  // lock-out could not be told from mistyped codes.
  it("logs a request from another protocol, by the word protocol", async () => {
    const base = await start();
    await fetch(`${base}/matchmake/create/race`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION + 1 }),
    });
    expect(refusals()).toEqual(["protocol"]);
  });

  it("logs a client newer than the server as updating, apart from an old client", async () => {
    const base = await start({ buildId: "202611140000-abc1234" });
    await fetch(`${base}/matchmake/create/race`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION + 1, buildId: "299912312359-abcdef1" }),
    });
    expect(refusals()).toEqual(["updating"]);
  });

  it("logs a join by a code no room holds, and never the code", async () => {
    const base = await start();
    await fetch(`${base}/matchmake/joinById/ZZZZZZ`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
    });
    expect(refusals()).toEqual(["unknown-room"]);
    expect(lines.join("\n")).not.toContain("ZZZZZZ");
  });

  it("logs a join to a full room as full, and not as an unknown code", async () => {
    const base = await start();
    const { roomId } = (await (await create(base)).json()) as { roomId: string };
    const join = (name: string) =>
      fetch(`${base}/matchmake/joinById/${roomId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, protocolVersion: PROTOCOL_VERSION }),
      });
    for (let seat = 1; seat < 4; seat += 1) expect((await join(`Ninja ${seat}`)).status).toBe(200);
    expect((await join("Late")).status).not.toBe(200);
    expect(refusals()).toEqual(["full"]);
  });

  it("logs nothing for a join by the code of a room that is there", async () => {
    const base = await start();
    const { roomId } = (await (await create(base)).json()) as { roomId: string };
    await fetch(`${base}/matchmake/joinById/${roomId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sable", protocolVersion: PROTOCOL_VERSION }),
    });
    expect(refusals()).toEqual([]);
  });

  it("logs the live room count on its interval", async () => {
    const base = await start({ roomsLogEveryMs: 20 });
    await create(base);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const counts = lines.filter((line) => line.includes('"event":"rooms"')).map((line) => JSON.parse(line) as { live: number });
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.at(-1)!.live).toBe(1);
  });

  // The watch Worker keeps these past Fly's short buffer (server-down email spec, Design 4).
  it("logs the interval's tick costs across rooms, and nothing for an interval with no tick", async () => {
    await start({ roomsLogEveryMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(lines.some((line) => line.includes('"event":"ticks"'))).toBe(false);

    await server?.close();
    lines = [];
    const base = await start({ roomsLogEveryMs: 200 });
    await create(base);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const ticks = lines.filter((line) => line.includes('"event":"ticks"')).map((line) => JSON.parse(line) as Record<string, number>);
    expect(ticks.length).toBeGreaterThan(0);
    for (const minute of ticks) {
      expect(Object.keys(minute).sort()).toEqual(["event", "max", "n", "p50", "p90", "p99"]);
      expect(minute["n"]).toBeGreaterThan(0);
      expect(minute["p50"]).toBeLessThanOrEqual(minute["p99"]!);
    }
  });
});
