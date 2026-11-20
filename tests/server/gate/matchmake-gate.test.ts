import { afterEach, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";
import { ContentStore } from "../../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import {
  createColyseusRaceServer,
  type ColyseusRaceServer,
} from "../../../apps/server/src/colyseus-server";
import type { RaceRoom } from "../../../apps/server/src/rooms/race-room";

let server: ColyseusRaceServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const start = async (proxy?: "fly"): Promise<string> => {
  server = await createColyseusRaceServer({
    port: 0,
    contentStore: new ContentStore(GENERATED_CONTENT),
    ...(proxy === undefined ? {} : { proxy }),
  });
  return `http://127.0.0.1:${server.port}`;
};

const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base}/matchmake/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const join = { name: "Kite", protocolVersion: PROTOCOL_VERSION };

const errorOf = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => ({}))) as { error?: unknown; message?: unknown };
  return `${String(body.error ?? "")} ${String(body.message ?? "")}`;
};

describe("the matchmaking gate behind Fly (finish for launch §2.3)", () => {
  // Fly's proxy is the TCP peer for every player, so without the header every
  // player would share one set of limits. Here the peer is always loopback.
  it("limits each Fly-Client-IP on its own", async () => {
    const base = await start("fly");
    const asA = { "fly-client-ip": "203.0.113.9" };
    const asB = { "fly-client-ip": "203.0.113.10" };
    for (let index = 0; index < 3; index += 1) {
      expect((await post(base, "create/race", join, asA)).status).toBe(200);
    }
    expect((await post(base, "create/race", join, asA)).status).toBe(429);
    expect((await post(base, "create/race", join, asB)).status).toBe(200);
  });

  it("shares one limit among players it cannot tell apart, as before", async () => {
    const base = await start();
    for (let index = 0; index < 3; index += 1) {
      expect((await post(base, "create/race", join, { "fly-client-ip": `203.0.113.${index}` })).status).toBe(200);
    }
    expect((await post(base, "create/race", join, { "fly-client-ip": "203.0.113.99" })).status).toBe(429);
  });
});

describe("the matchmaking gate (release readiness §6.1)", () => {
  it("lets an address open three rooms at once, then one per twenty seconds", async () => {
    const base = await start();
    for (let index = 0; index < 3; index += 1) {
      expect((await post(base, "create/race", join)).status).toBe(200);
    }
    const fourth = await post(base, "create/race", join);
    expect(fourth.status).toBe(429);
    expect(await errorOf(fourth)).toMatch(/too many requests/);
    expect(fourth.headers.get("access-control-allow-origin")).not.toBeNull();
  });

  // Find a race may open a room, so one address cannot use it to open rooms
  // much faster than Create room allows: eight at once, then one per 10 s.
  // Each room takes four reservations, so that is two rooms, then one a 40 s.
  it("limits Find a race on its own, tighter than joins", async () => {
    const base = await start();
    const statuses: number[] = [];
    for (let index = 0; index < 9; index += 1) {
      statuses.push((await post(base, "joinOrCreate/race", { ...join, quickMatch: true })).status);
    }
    expect(statuses.slice(0, 8).every((status) => status === 200)).toBe(true);
    expect(statuses[8]).toBe(429);
  });

  it("lets an address try ten codes at once, then one per two seconds", async () => {
    const base = await start();
    for (let index = 0; index < 10; index += 1) {
      const response = await post(base, "joinById/ZZZZZZ", join);
      expect(await errorOf(response)).not.toMatch(/too many requests/);
    }
    const eleventh = await post(base, "joinById/ZZZZZZ", join);
    expect(eleventh.status).toBe(429);
  });

  // Review Focus 2: a family pressing Find a race together. Only the first
  // opens a room; the others fill it. MAX_ROOMS bounds the rooms either way.
  it("lets four players behind one router all find a race at once", async () => {
    const base = await start();
    const answers: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      answers.push((await post(base, "joinOrCreate/race", { ...join, quickMatch: true })).status);
    }
    expect(answers).toEqual([200, 200, 200, 200]);
  });

  it("lets four players behind one router join and reconnect eight times between them", async () => {
    const base = await start();
    const answers: string[] = [];
    for (let index = 0; index < 4; index += 1) answers.push(await errorOf(await post(base, "joinById/ZZZZZZ", join)));
    for (let index = 0; index < 8; index += 1) {
      answers.push(await errorOf(await post(base, "reconnect/ZZZZZZ", { reconnectionToken: "not-a-token" })));
    }
    expect(answers.filter((answer) => /too many requests/.test(answer))).toEqual([]);
  });

  // The browser suite opens dozens of rooms from one address. It runs against a
  // server with the test driver mounted, which production refuses to start
  // with (process-safety.ts), so the limits stay on wherever players are.
  it("sets no limits on a server that mounts the test driver", async () => {
    server = await createColyseusRaceServer({
      port: 0,
      contentStore: new ContentStore(GENERATED_CONTENT),
      testDriverToken: "e2e-driver-token",
    });
    const base = `http://127.0.0.1:${server.port}`;
    for (let index = 0; index < 6; index += 1) {
      expect((await post(base, "create/race", join)).status).toBe(200);
    }
  });

  it("refuses a matchmaking body over 4 KB", async () => {
    const base = await start();
    const response = await post(base, "create/race", { ...join, padding: "x".repeat(5_000) });
    expect(response.status).toBe(413);
  });

  it("lets a reconnection through while the server drains", async () => {
    const base = await start();
    const created = (await (await post(base, "create/race", join)).json()) as { roomId: string };
    (matchMaker.getLocalRoomById(created.roomId) as unknown as RaceRoom).finishForTest();
    void server!.drain(2_000);

    const response = await post(base, "reconnect/ZZZZZZ", { reconnectionToken: "not-a-token" });
    expect(await errorOf(response)).not.toMatch(/server is updating|too many requests/);
    const fresh = await post(base, "create/race", join);
    expect(fresh.status).toBe(503);
  });
});
