import { afterEach, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";
import { ContentStore } from "../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../apps/server/src/content/generated-content";
import { liveRooms } from "../../apps/server/src/rooms/live-rooms";
import type { RaceRoom } from "../../apps/server/src/rooms/race-room";
import {
  TELEMETRY_PATH,
  createColyseusRaceServer,
  type ColyseusRaceServer,
} from "../../apps/server/src/colyseus-server";

let server: ColyseusRaceServer | undefined;

/**
 * Opens a room and moves it past its race, so a drain lets it run on
 * (release readiness §5.4) and the process stays up for the test to ask.
 */
async function holdTheDrainOpen(base: string): Promise<RaceRoom> {
  const created = (await (
    await fetch(`${base}/matchmake/create/race`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
    })
  ).json()) as { roomId: string };
  const room = matchMaker.getLocalRoomById(created.roomId) as unknown as RaceRoom;
  room.finishForTest();
  return room;
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("the colyseus race server", () => {
  it("still answers the health probe and serves content", async () => {
    server = await createColyseusRaceServer({
      port: 0,
      contentStore: new ContentStore(GENERATED_CONTENT),
    });
    const base = `http://127.0.0.1:${server.port}`;

    const health = await fetch(`${base}/health`);
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(await health.json()).toEqual({
      ok: true,
      buildId: "dev",
      protocolVersion: PROTOCOL_VERSION,
      rulesetRevision: GENERATED_CONTENT.rulesetRevision,
      contentRevision: GENERATED_CONTENT.contentRevision,
      draining: false,
    });

    const content = await fetch(`${base}/content`);
    expect(content.headers.get("access-control-allow-origin")).toBe("*");
    expect((await content.json()).contentRevision).toBe(GENERATED_CONTENT.contentRevision);
  });

  it("still answers health while draining, and says so", async () => {
    server = await createColyseusRaceServer({
      port: 0,
      contentStore: new ContentStore(GENERATED_CONTENT),
    });
    const base = `http://127.0.0.1:${server.port}`;
    // A room past its race holds the drain open, so the process is still there to ask.
    await holdTheDrainOpen(base);
    void server.drain(1_500);
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, draining: true });
  });

  it("moves its lobbies on and refuses new rooms once it drains (release readiness §5.4)", async () => {
    server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT) });
    const base = `http://127.0.0.1:${server.port}`;
    const create = () =>
      fetch(`${base}/matchmake/create/race`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
      });
    expect((await create()).status).toBe(200);
    const held = await holdTheDrainOpen(base);
    expect(liveRooms.size).toBe(2);

    void server.drain(2_000);
    const refused = await create();
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { error?: string }).error).toMatch(/server is updating/);
    // The lobby was told and closed at once; the room past its race is still there.
    await until(() => liveRooms.size === 1);
    expect([...liveRooms][0]).toBe(held);
  });

  it("answers matchmaking on the same origin", async () => {
    server = await createColyseusRaceServer({
      port: 0,
      contentStore: new ContentStore(GENERATED_CONTENT),
    });
    const response = await fetch(`http://127.0.0.1:${server.port}/matchmake/create/race`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
    });
    const body = (await response.json()) as { roomId?: string; error?: number };
    expect(body.roomId).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("answers each request once: its own routes first, Colyseus's for the rest", async () => {
    server = await createColyseusRaceServer({
      port: 0,
      contentStore: new ContentStore(GENERATED_CONTENT),
    });
    const base = `http://127.0.0.1:${server.port}`;

    // One listener: ours, which hands what it does not answer to Colyseus.
    expect(server.gameServer.transport.server?.listenerCount("request")).toBe(1);
    await expect((await fetch(`${base}/health`)).json()).resolves.toMatchObject({ ok: true });
    expect(await (await fetch(`${base}/`)).text()).toMatch(/^Colyseus 0\.18/);
    expect((await fetch(`${base}/no-such-route`)).status).toBe(404);
  });

  it("is ready until it drains, and drains to empty with no rooms", async () => {
    server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT) });
    const base = `http://127.0.0.1:${server.port}`;

    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    await expect(ready.json()).resolves.toEqual({ ready: true });

    await expect(server.drain(5_000)).resolves.toBe("empty");
    server = undefined;
  });

  it("answers not ready while a room holds the drain open, and stops at the cap", async () => {
    server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT) });
    const base = `http://127.0.0.1:${server.port}`;
    await holdTheDrainOpen(base);

    const drained = server.drain(1_500);
    const during = await fetch(`${base}/ready`);
    expect(during.status).toBe(503);
    await expect(during.json()).resolves.toEqual({ ready: false });
    // The drain is idempotent: a second call joins the first.
    expect(server.drain(1_500)).toBe(drained);

    await expect(drained).resolves.toBe("cap");
    server = undefined;
  });

  it("leaves SIGTERM to the drain rather than Colyseus's immediate shutdown", async () => {
    const before = process.listenerCount("SIGTERM");
    server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT) });
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("does not mount the test driver without a token", async () => {
    server = await createColyseusRaceServer({
      port: 0,
      contentStore: new ContentStore(GENERATED_CONTENT),
    });
    // The driver, and the two routes that read and hold a room (`room-driver.ts`):
    // all answer 404 where no token mounts them.
    for (const path of ["/__test__/drive", "/__test__/room", "/__test__/clock"]) {
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
        method: "POST",
        body: "{}",
      });
      expect(response.status, path).toBe(404);
    }
  });
});

describe("the protocol version", () => {
  it("is nineteen: a seat's snapshot carries its edge's wait (first-race spec §2), after eighteen put the client's build in the join (release readiness §4.2)", () => {
    expect(PROTOCOL_VERSION).toBe(19);
  });
});

// A tab left open across a deploy still runs the old client. Colyseus 0.18
// answers a join with a reply that client cannot read, and only checks the
// room's own version once the socket opens, so the server refuses a stale
// version at the matchmaking request, in the one shape every client reads.
describe("a client from an older protocol", () => {
  const stale = PROTOCOL_VERSION - 1;
  const matchmake = (method: string, target: string, body: object) =>
    fetch(`http://127.0.0.1:${server!.port}/matchmake/${method}/${target}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://elsewhere.test" },
      body: JSON.stringify(body),
    });
  const expectTheReloadRefusal = async (response: Response) => {
    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).not.toBeNull();
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe(
      `unsupported protocol version ${stale}; this server speaks version ${PROTOCOL_VERSION}`,
    );
  };

  it("is told to reload when it creates a room, and no room is made", async () => {
    server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT) });

    await expectTheReloadRefusal(await matchmake("create", "race", { name: "Kite", protocolVersion: stale }));
    expect(await matchMaker.query({})).toHaveLength(0);
  });

  it("is told to reload when it joins a room by its code", async () => {
    server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT) });
    const created = (await (
      await matchmake("create", "race", { name: "Kite", protocolVersion: PROTOCOL_VERSION })
    ).json()) as { roomId: string };

    await expectTheReloadRefusal(
      await matchmake("joinById", created.roomId, { name: "Ninja", protocolVersion: stale }),
    );
  });

  it("is told to reload when it finds a race", async () => {
    server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT) });

    await expectTheReloadRefusal(
      await matchmake("joinOrCreate", "race", { name: "Kite", protocolVersion: stale, quickMatch: true }),
    );
  });

  it("is told to reload when its build is older, even with a build id", async () => {
    server = await createColyseusRaceServer({
      port: 0,
      contentStore: new ContentStore(GENERATED_CONTENT),
      buildId: "202610041200-bbbbbbb",
    });

    await expectTheReloadRefusal(
      await matchmake("create", "race", { name: "Kite", protocolVersion: stale, buildId: "202610031200-aaaaaaa" }),
    );
  });

  it("hears the server is updating when its build is newer than the server's", async () => {
    server = await createColyseusRaceServer({
      port: 0,
      contentStore: new ContentStore(GENERATED_CONTENT),
      buildId: "202610041200-bbbbbbb",
    });

    const response = await matchmake("create", "race", {
      name: "Kite",
      protocolVersion: PROTOCOL_VERSION + 1,
      buildId: "202610051200-ccccccc",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/server is updating/);
    expect(body.error).not.toMatch(/protocol version/);
    expect(await matchMaker.query({})).toHaveLength(0);
  });

  it("leaves a reconnect, which carries no version, to Colyseus", async () => {
    server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT) });

    const response = await matchmake("reconnect", "ABC123", { reconnectionToken: "not-a-token" });
    const body = (await response.json()) as { error?: string; message?: string };
    expect(`${body.error ?? ""} ${body.message ?? ""}`).not.toMatch(/protocol version/);
  });
});

/**
 * Asks a server one question over loopback, and says who answered if nobody did.
 *
 * CI once saw "fetch failed / other side closed" here: a fresh connection,
 * one request written, nothing read back. That is either this server dropping
 * the request, or the connection having reached a different listener on the
 * same port (the runner hands a just-freed port to another test worker).
 * This server's own connection and request counts tell the two apart, so a
 * second sighting names its cause. The assertions and the request are the
 * test's own; nothing here retries.
 */
const seen = new WeakMap<ColyseusRaceServer, { connections: number; requests: number }>();

async function askTheServer(running: ColyseusRaceServer, path: string, init?: RequestInit): Promise<Response> {
  const http = running.gameServer.transport.server;
  // Counted from the server's first question, so a kept-alive connection a
  // later question reuses still counts as one this server saw.
  let counts = seen.get(running);
  if (counts === undefined) {
    const fresh = { connections: 0, requests: 0 };
    counts = fresh;
    seen.set(running, fresh);
    http?.on("connection", () => (fresh.connections += 1));
    http?.on("request", () => (fresh.requests += 1));
  }
  try {
    return await fetch(`http://127.0.0.1:${running.port}${path}`, init);
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message ?? String(error);
    throw new Error(
      `${path} on 127.0.0.1:${running.port} got no answer (${cause}); ` +
        `this server has seen ${counts.connections} connection(s) and ${counts.requests} request(s), ` +
        `and is ${http?.listening === true ? "still" : "no longer"} listening. ` +
        "No connection means another listener on the port took it; one connection and one request means this server dropped it.",
      { cause: error },
    );
  }
}

describe("the telemetry endpoint", () => {
  it("is absent unless the host asks for it", async () => {
    server = await createColyseusRaceServer({
      port: 0,
      contentStore: new ContentStore(GENERATED_CONTENT),
    });
    const response = await askTheServer(server, TELEMETRY_PATH);
    expect(response.status).toBe(404);
  });

  it("reports live rooms by serial number when enabled", async () => {
    server = await createColyseusRaceServer({
      port: 0,
      contentStore: new ContentStore(GENERATED_CONTENT),
      telemetry: { endpoint: true },
    });
    const created = await askTheServer(server, "/matchmake/create/race", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
    });
    const room = (await created.json()) as { roomId: string };

    const response = await askTheServer(server, TELEMETRY_PATH);
    const text = await response.text();
    const body = JSON.parse(text) as { rooms: { room: number; tickRateHz: number }[] };
    expect(response.status).toBe(200);
    expect(body.rooms.length).toBeGreaterThan(0);
    expect(text).not.toContain(room.roomId);
  });
});
