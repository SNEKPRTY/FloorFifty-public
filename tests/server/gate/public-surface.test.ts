import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SOCKETS_PER_IP, PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";
import { forgetRoom, liveRooms, registerRoom } from "../../../apps/server/src/rooms/live-rooms";
import { RaceRoom } from "../../../apps/server/src/rooms/race-room";
import { ContentStore } from "../../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import {
  createColyseusRaceServer,
  type ColyseusRaceServer,
  type ColyseusRaceServerOptions,
} from "../../../apps/server/src/colyseus-server";

const RUKEN = "https://g-abc.rukengames.com";
let server: ColyseusRaceServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const start = async (over: Partial<ColyseusRaceServerOptions> = {}): Promise<string> => {
  server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT), ...over });
  return `http://127.0.0.1:${server.port}`;
};

/** Asks for a WebSocket upgrade and reports the status line the server answers with, if any. */
const upgradeStatus = (port: number, origin: string | undefined): Promise<number | "upgraded" | "closed"> =>
  new Promise((resolve) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/no-such-room",
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...(origin === undefined ? {} : { origin }),
      },
    });
    request.on("response", (response) => resolve(response.statusCode ?? 0));
    request.on("upgrade", () => resolve("upgraded"));
    request.on("error", () => resolve("closed"));
    request.on("close", () => resolve("closed"));
    request.end();
  });

/** Opens an upgrade and keeps its socket open until `close`, reporting the status it got. */
const holdUpgrade = (port: number): Promise<{ status: number; close(): void }> =>
  new Promise((resolve) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/no-such-room",
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    request.on("upgrade", (response, socket) => resolve({ status: response.statusCode ?? 0, close: () => socket.destroy() }));
    request.on("response", (response) =>
      resolve({ status: response.statusCode ?? 0, close: () => response.socket.destroy() }),
    );
    request.on("error", () => resolve({ status: 0, close: () => undefined }));
    request.end();
  });

/** Lets the server see a closed socket's end. */
const waitForClose = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100));

describe("the public surface's origins (release readiness §6.5)", () => {
  it("answers content to a listed origin, and gives another none", async () => {
    const base = await start({ allowedOrigins: RUKEN });
    const listed = await fetch(`${base}/content`, { headers: { origin: RUKEN } });
    expect(listed.headers.get("access-control-allow-origin")).toBe(RUKEN);
    const other = await fetch(`${base}/content`, { headers: { origin: "https://elsewhere.test" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  // The client reads /health at boot to compare builds (§4.2); from its own
  // origin that is a cross-origin read, which needs the same allowlist.
  it("lets a listed origin read /health, and no other", async () => {
    const base = await start({ allowedOrigins: RUKEN });
    const listed = await fetch(`${base}/health`, { headers: { origin: RUKEN } });
    expect(listed.headers.get("access-control-allow-origin")).toBe(RUKEN);
    const other = await fetch(`${base}/health`, { headers: { origin: "https://elsewhere.test" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("lets a listed origin through matchmaking's CORS, and no other", async () => {
    const base = await start({ allowedOrigins: RUKEN });
    const create = (origin: string) =>
      fetch(`${base}/matchmake/create/race`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
      });
    expect((await create(RUKEN)).headers.get("access-control-allow-origin")).toBe(RUKEN);
    expect((await create("https://elsewhere.test")).headers.get("access-control-allow-origin")).not.toBe(
      "https://elsewhere.test",
    );
  });

  it("refuses a socket from an unlisted origin, or from none, before Colyseus sees it", async () => {
    await start({ allowedOrigins: RUKEN });
    expect(await upgradeStatus(server!.port, "https://elsewhere.test")).toBe(403);
    expect(await upgradeStatus(server!.port, undefined)).toBe(403);
    // A listed origin is handed on: whatever Colyseus makes of the path, it is not our refusal.
    expect(await upgradeStatus(server!.port, RUKEN)).not.toBe(403);
  });

  it("allows every origin when none is listed, as in dev", async () => {
    const base = await start();
    const content = await fetch(`${base}/content`, { headers: { origin: "http://192.168.1.20:5173" } });
    expect(content.headers.get("access-control-allow-origin")).toBe("*");
    expect(await upgradeStatus(server!.port, "http://192.168.1.20:5173")).not.toBe(403);
  });
});

describe("the socket caps through the server (release readiness §6.1)", () => {
  it("refuses an address's socket past its cap, and lets one in again once one closes", async () => {
    await start({ socketLimits: { maxPerIp: 2, maxTotal: 100 } });
    const held = [await holdUpgrade(server!.port), await holdUpgrade(server!.port)];
    expect(held.map((socket) => socket.status)).toEqual([101, 101]);
    const third = await holdUpgrade(server!.port);
    expect(third.status).toBe(429);

    // A socket that closes gives its place back.
    held[0]!.close();
    await waitForClose();
    const fourth = await holdUpgrade(server!.port);
    expect(fourth.status).toBe(101);
    for (const socket of [held[1]!, third, fourth]) socket.close();
  });

  it("keeps no address cap on a server the browser suite drives, whose every client is one address", async () => {
    await start({ testDriverToken: "e2e-driver-token" });
    const held = await Promise.all(Array.from({ length: MAX_SOCKETS_PER_IP + 4 }, () => holdUpgrade(server!.port)));
    expect(held.filter((socket) => socket.status !== 101)).toEqual([]);
    for (const socket of held) socket.close();
  });

  it("refuses a socket past the total, whoever sends it", async () => {
    await start({ socketLimits: { maxPerIp: 100, maxTotal: 1 } });
    const first = await holdUpgrade(server!.port);
    const second = await holdUpgrade(server!.port);
    expect([first.status, second.status]).toEqual([101, 429]);
    for (const socket of [first, second]) socket.close();
  });
});

describe("a room that fails to start (release readiness §6.1, §5.4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const room of [...liveRooms]) forgetRoom(room);
  });

  it("holds no MAX_ROOMS slot once its creation fails", async () => {
    const base = await start({ maxRooms: 5 });
    vi.spyOn(RaceRoom.prototype as unknown as { registerHandlers(): void }, "registerHandlers").mockImplementation(() => {
      throw new Error("broken on purpose");
    });
    await fetch(`${base}/matchmake/create/race`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
    });
    expect(liveRooms.size).toBe(0);
  });

  it("still tells every other room to drain when one of them throws", async () => {
    await start();
    const told: string[] = [];
    registerRoom({ beginDrain: () => { throw new Error("broken room"); } });
    registerRoom({ beginDrain: () => void told.push("healthy") });
    await server!.drain(500);
    expect(told).toEqual(["healthy"]);
  });
});

describe("the room cap (release readiness §6.1)", () => {
  it("refuses a room past MAX_ROOMS with the server-is-full words", async () => {
    const base = await start({ maxRooms: 2 });
    const create = () =>
      fetch(`${base}/matchmake/create/race`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
      });
    expect((await create()).status).toBe(200);
    expect((await create()).status).toBe(200);
    const third = await create();
    expect(third.status).not.toBe(200);
    const body = (await third.json()) as { error?: string; message?: string };
    expect(`${body.error ?? ""} ${body.message ?? ""}`).toMatch(/server is full/);
  });
});
