import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ContentStore } from "../../apps/server/src/content/content-store";
import { GENERATED_CONTENT } from "../../apps/server/src/content/generated-content";
import {
  createColyseusRaceServer,
  type ColyseusRaceServer,
  type ColyseusRaceServerOptions,
} from "../../apps/server/src/colyseus-server";

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

const event = {
  event: "phase",
  phase: "racing",
  buildId: "202610041200-abc1234",
  rulesetRevision: "r",
  contentRevision: "c",
  deviceClass: "phone",
  load: "0123456789abcdef",
};

const send = (base: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base}/telemetry`, {
    method: "POST",
    // sendBeacon's own type, which needs no CORS preflight.
    headers: { "content-type": "text/plain;charset=UTF-8", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /telemetry (release readiness §7.1)", () => {
  it("takes a valid event and writes one JSON line with no address", async () => {
    const base = await start();
    const response = await send(base, event);
    expect(response.status).toBe(204);
    const written = lines.filter((line) => line.includes('"event":"phase"'));
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!)).toMatchObject({ event: "phase", phase: "racing", load: "0123456789abcdef" });
    expect(written[0]).not.toContain("127.0.0.1");
  });

  // Audit S26: `/telemetry` checked no origin, and a posted `fatal` event shared
  // its name with the server's own crash line, which the runbook rolls back on.
  it("refuses a page the origin list does not name, and writes nothing", async () => {
    const base = await start({ allowedOrigins: "https://g-abc.rukengames.com" });
    const response = await send(base, event, { origin: "https://elsewhere.test" });
    expect(response.status).toBe(403);
    expect(lines.filter((line) => line.includes('"event":"phase"'))).toEqual([]);
  });

  it("refuses a post with no origin when a list is set, as the socket does", async () => {
    const base = await start({ allowedOrigins: "https://g-abc.rukengames.com" });
    expect((await send(base, event)).status).toBe(403);
  });

  it("takes a post from a listed origin", async () => {
    const base = await start({ allowedOrigins: "https://g-abc.rukengames.com" });
    expect((await send(base, event, { origin: "https://g-abc.rukengames.com" })).status).toBe(204);
  });

  it("marks what it writes as the client's, so a posted fatal cannot pass for the server's own", async () => {
    const base = await start();
    const fatal = { ...event, event: "fatal", class: "Boom", screen: "Gameplay" };
    delete (fatal as Record<string, unknown>)["phase"];
    expect((await send(base, fatal)).status).toBe(204);
    const written = lines.filter((line) => line.includes('"event":"fatal"'));
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!)).toMatchObject({ src: "client", event: "fatal", class: "Boom" });
  });

  it("refuses an event with a field it does not know", async () => {
    const base = await start();
    expect((await send(base, { ...event, name: "Kite" })).status).toBe(400);
    expect(lines.some((line) => line.includes("Kite"))).toBe(false);
  });

  it("refuses a body over 2 KB", async () => {
    const base = await start();
    expect((await send(base, "x".repeat(2_049))).status).toBe(413);
  });

  // A body that never ends must not hold the server reading it: the 413 goes
  // out as soon as the cap is passed, and the connection closes.
  it("answers an oversized body at once, without waiting for it to end", async () => {
    await start();
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: server!.port,
          path: "/telemetry",
          method: "POST",
          headers: { "content-type": "text/plain", "transfer-encoding": "chunked" },
        },
        (response) => resolve(response.statusCode ?? 0),
      );
      request.on("error", reject);
      request.write("x".repeat(3_000));
      // Never ended: only an answer given mid-body can resolve this.
    });
    expect(status).toBe(413);
  });

  it("refuses what is not JSON", async () => {
    const base = await start();
    expect((await send(base, "not json")).status).toBe(400);
  });

  it("lets an address send twenty at once, then one every three seconds", async () => {
    const base = await start();
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) statuses.push((await send(base, event)).status);
    expect(statuses.slice(0, 20).every((status) => status === 204)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("keeps no rate on a server the browser suite drives, whose every client is one address", async () => {
    const base = await start({ testDriverToken: "e2e-driver-token" });
    const statuses: number[] = [];
    for (let index = 0; index < 30; index += 1) statuses.push((await send(base, event)).status);
    expect(statuses.filter((status) => status !== 204)).toEqual([]);
  });

  it("answers a listed origin's CORS, and gives another none", async () => {
    const base = await start({ allowedOrigins: "https://g-abc.rukengames.com" });
    const listed = await send(base, event, { origin: "https://g-abc.rukengames.com" });
    expect(listed.headers.get("access-control-allow-origin")).toBe("https://g-abc.rukengames.com");
    const other = await send(base, event, { origin: "https://elsewhere.test" });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("is never cached", async () => {
    const base = await start();
    const response = await send(base, event);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
