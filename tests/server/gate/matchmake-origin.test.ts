import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";
import { ContentStore } from "../../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import {
  createColyseusRaceServer,
  type ColyseusRaceServer,
  type ColyseusRaceServerOptions,
} from "../../../apps/server/src/colyseus-server";
import { liveRooms } from "../../../apps/server/src/rooms/live-rooms";

/**
 * Audit S6: the origin list was enforced on the socket upgrade but not on the
 * matchmaking requests. A hostile page could make its visitors' browsers send
 * room-creating requests from the visitors' own addresses (CORS only stops the
 * page reading the answer), which spreads B1 over many addresses with no
 * sockets. The list now applies to the HTTP calls as it does to the socket.
 */

const LISTED = "https://g-abc.rukengames.com";
let server: ColyseusRaceServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const start = async (over: Partial<ColyseusRaceServerOptions> = {}): Promise<string> => {
  server = await createColyseusRaceServer({ port: 0, contentStore: new ContentStore(GENERATED_CONTENT), ...over });
  return `http://127.0.0.1:${server.port}`;
};

const call = (base: string, verb: string, origin?: string): Promise<Response> =>
  fetch(`${base}/matchmake/${verb}/race`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin === undefined ? {} : { origin }) },
    body: JSON.stringify({ name: "Kite", protocolVersion: PROTOCOL_VERSION }),
  });

describe("the origin list on matchmaking requests (audit S6)", () => {
  it("lets a listed origin open a room", async () => {
    const base = await start({ allowedOrigins: LISTED });
    expect((await call(base, "create", LISTED)).status).toBe(200);
    expect(liveRooms.size).toBe(1);
  });

  it.each(["create", "joinOrCreate", "join", "joinById", "reconnect"])(
    "refuses an unlisted origin on %s, and opens no room",
    async (verb) => {
      const base = await start({ allowedOrigins: LISTED });
      const response = await call(base, verb, "https://evil.example");
      expect(response.status).toBe(403);
      expect(liveRooms.size).toBe(0);
    },
  );

  it("refuses a request with no origin, as the socket does", async () => {
    const base = await start({ allowedOrigins: LISTED });
    expect((await call(base, "create")).status).toBe(403);
    expect(liveRooms.size).toBe(0);
  });

  it("answers a refusal in the shape every client reads, with the words and without the room", async () => {
    const base = await start({ allowedOrigins: LISTED });
    const body = (await (await call(base, "create", "https://evil.example")).json()) as { code?: unknown; error?: string };
    expect(typeof body.code).toBe("number");
    expect(body.error).toMatch(/^ORIGIN_REFUSED:/);
  });

  it("logs the refusal by its limit, never by address", async () => {
    const lines: string[] = [];
    const base = await start({ allowedOrigins: LISTED, telemetry: { log: (line) => void lines.push(line) } });
    await call(base, "create", "https://evil.example");
    expect(lines).toContain(JSON.stringify({ event: "refused", limit: "origin" }));
  });

  it("applies no list when none is set, as in development", async () => {
    const base = await start();
    expect((await call(base, "create", "https://anything.example")).status).toBe(200);
    expect((await call(base, "create")).status).toBe(200);
  });
});
