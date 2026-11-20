/**
 * The race server, on Colyseus.
 *
 * Process concerns only: the HTTP listener, the Colyseus transport, and the
 * two plain routes that are not realtime. Every game rule lives in
 * `packages/shared`; every room rule lives in `rooms/`.
 *
 * `/health` and `/content` are answered by a listener installed *after*
 * Colyseus binds its router, which hands every path it does not answer to
 * Colyseus. The client keeps asking its own origin for content exactly as it
 * always has, and only the realtime path has changed.
 */

import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { matchMaker, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createAppConfig } from "./colyseus-app";
import type { RoomTelemetryConfig } from "./rooms/race-room";
import { liveRoomSummaries } from "./rooms/room-telemetry";
import type { ContentStore } from "./content/content-store";
import { DRAIN_MAX_MS, waitForRoomsToEmpty, type DrainResult } from "./drain";
import { createHash } from "node:crypto";
import { securityTxt } from "./security-txt";
import { createTelemetryEndpoint } from "./telemetry-endpoint";
import { createMatchmakeGate } from "./gate/matchmake-gate";
import { BODY_TIMEOUT_MS } from "./http-body";

/** The probes' answers are never cached and never sniffed (release readiness §6.3). */
const PROBE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" } as const;
import { clientIp, type ProxySource } from "./gate/client-ip";
import { withRoomOwner } from "./gate/room-owner-context";
import { createRefusalCoalescer } from "./gate/refusal-coalescer";
import { originPolicy } from "./gate/origins";
import { createSocketGate } from "./gate/socket-gate";
import type { Duplex } from "node:stream";
import {
  MAX_ROOMS_PER_ADDRESS,
  MAX_SOCKETS_PER_IP,
  SOCKET_HEADROOM,
  WS_MAX_PAYLOAD_BYTES,
} from "@floor-fifty/shared/common/constants";
import { SERVER_BUILD } from "./build-facts";
import { liveRooms } from "./rooms/live-rooms";
import { TickHistogram } from "./rooms/tick-histogram";

export type ColyseusRaceServerOptions = {
  /** `0` asks the operating system for an ephemeral port, as tests do. */
  port?: number;
  contentStore: ContentStore;
  /**
   * Enables the end-to-end room driver.
   *
   * Absent by default and absent from normal production startup: the endpoint
   * is not mounted at all unless a token is supplied here or in
   * `FLOOR_FIFTY_TEST_DRIVER_TOKEN`.
   */
  testDriverToken?: string;
  fixedSeed?: number;
  /**
   * Where each room's telemetry goes.
   *
   * The entry points attach a sink; a test attaches none. `endpoint` mounts
   * `GET /debug/telemetry`, which reports every live room by serial number
   * and never by code.
   */
  telemetry?: RoomTelemetryConfig & { endpoint?: boolean };
  /** This server's build id. The bundle's stamp unless a test names one (release readiness §4.1). */
  buildId?: string;
  /** `FLOOR_FIFTY_ALLOWED_ORIGINS`: the client origins allowed in. Unset allows all, as in dev (§6.5). */
  allowedOrigins?: string;
  /** `MAX_ROOMS`: the most rooms this process holds at once. Unset is no cap (§6.1). */
  maxRooms?: number;
  /**
   * Rooms one address may have open, by who created them (audit B1).
   * `MAX_ROOMS_PER_ADDRESS` unless a test asks for another; none on a server the
   * browser suite drives, where every browser is one address.
   */
  maxRoomsPerAddress?: number;
  /**
   * Which proxy stands in front of this server (`FLOOR_FIFTY_PROXY`): Caddy on
   * loopback, the default, or Fly's, whose `Fly-Client-IP` names the player.
   * It decides who a request is from, for every rate limit (finish for launch §2.3).
   */
  proxy?: ProxySource;
  /** The socket caps, per address and in total; §6.1's unless a test asks for smaller ones. */
  socketLimits?: { maxPerIp: number; maxTotal: number };
  /** How often the live room count is logged; a minute unless a test asks sooner. */
  roomsLogEveryMs?: number;
  /** `HTTP_REQUEST_TIMEOUT_MS` unless a test asks for a shorter one. */
  requestTimeoutMs?: number;
};

/**
 * The longest one HTTP request may take to arrive, headers and body (QC: read
 * timeouts). Matchmaking and telemetry bodies are a few hundred bytes, capped
 * at 4 KB; Node's own default is five minutes, so a client trickling a body
 * could hold a connection that long. A WebSocket is no longer an HTTP request
 * once upgraded, so a seated player is never cut off by it.
 */
export const HTTP_REQUEST_TIMEOUT_MS = BODY_TIMEOUT_MS;

/** The debug endpoint's path. Mounted only when asked for. */
export const TELEMETRY_PATH = "/debug/telemetry";

export type ColyseusRaceServer = {
  port: number;
  gameServer: Server;
  close(): Promise<void>;
  /**
   * Stops being ready, waits for every room to close (at most `capMs`), then
   * shuts Colyseus down. Idempotent: a second call returns the first drain.
   */
  drain(capMs?: number): Promise<DrainResult>;
};

export async function createColyseusRaceServer(
  options: ColyseusRaceServerOptions,
): Promise<ColyseusRaceServer> {
  let handleTestDrive:
    | ((request: IncomingMessage, response: ServerResponse) => Promise<boolean>)
    | undefined;

  let draining = false;
  const buildId = options.buildId ?? SERVER_BUILD.buildId;
  const origins = originPolicy(options.allowedOrigins);

  let served: { of: unknown; body: string; etag: string } | undefined;
  const contentBody = (): { body: string; etag: string } => {
    const current = options.contentStore.current();
    if (served?.of !== current) {
      const body = JSON.stringify(current);
      const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
      served = { of: current, body, etag };
    }
    return served;
  };
  const maxRooms = options.maxRooms ?? Number.POSITIVE_INFINITY;
  const requestTimeout = options.requestTimeoutMs ?? HTTP_REQUEST_TIMEOUT_MS;
  const proxy = options.proxy ?? "caddy";
  const addressOf = (request: IncomingMessage): string => clientIp(request, proxy);
  const driverToken = options.testDriverToken ?? process.env["FLOOR_FIFTY_TEST_DRIVER_TOKEN"];
  const driven = driverToken !== undefined && driverToken !== "";
  // Every browser the suite drives is 127.0.0.1, two workers of four-player
  // rooms at once, so the address caps refused its sockets and its telemetry
  // with a 429. As the matchmaking limits below, a driven server keeps only
  // the total.
  const sockets = createSocketGate(
    options.socketLimits ?? {
      maxPerIp: driven ? Number.POSITIVE_INFINITY : MAX_SOCKETS_PER_IP,
      maxTotal: 4 * maxRooms + SOCKET_HEADROOM,
    },
  );

  // The client's operational events go where the room telemetry goes: the
  // journal in production, nowhere in a test that attaches no sink.
  // Every refusal line, from the gate and from the rooms alike, passes one
  // coalescer, so a loop of refused requests writes a line and a count rather
  // than a line each (audit S26).
  const refusals = options.telemetry?.log === undefined ? undefined : createRefusalCoalescer(options.telemetry.log);
  const telemetryLog = refusals?.log;
  const tickCosts = new TickHistogram();
  const refusalFlush = setInterval(() => refusals?.flush(), 1_000);
  refusalFlush.unref();
  const ingestTelemetry = createTelemetryEndpoint({
    write: (line) => telemetryLog?.(line),
    origins,
    rateLimit: !driven,
    clientIp: addressOf,
    bodyTimeoutMs: requestTimeout,
  });
  /** One line per refusal, by limit and never by address, for the weekly report (§7.3). */
  const logRefused = (limit: string): void => telemetryLog?.(JSON.stringify({ event: "refused", limit }));

  const answerOwnRoute = (request: IncomingMessage, response: ServerResponse): boolean => {
    if (ingestTelemetry(request, response)) return true;
    // Readiness, as opposed to liveness: a draining process is alive -- its
    // races are still running -- but must not be sent anyone new. The deploy
    // waits on this before pointing Caddy at a new build.
    if (request.url === "/ready") {
      response.writeHead(draining ? 503 : 200, { "content-type": "application/json", ...PROBE_HEADERS });
      response.end(JSON.stringify({ ready: !draining }));
      return true;
    }
    // Liveness, with the facts a client compares itself against at boot
    // (release readiness §4.1). The ruleset is the loaded artifact's: it is
    // what the rooms enforce.
    if (request.url === "/health") {
      const current = options.contentStore.current();
      // Read cross-origin by the client's boot check (§4.2), so it follows the allowlist.
      response.writeHead(200, {
        "content-type": "application/json",
        ...PROBE_HEADERS,
        ...origins.corsHeaders(request.headers.origin),
      });
      response.end(JSON.stringify({
        ok: true,
        buildId,
        protocolVersion: SERVER_BUILD.protocolVersion,
        rulesetRevision: current.rulesetRevision,
        contentRevision: current.contentRevision,
        draining,
      }));
      return true;
    }
    // Public, and readable by the listed client origins; with no list, as in
    // dev, by any origin, so a development client can reach it from another
    // port (release readiness §6.5).
    // Serialised once per artifact, not per request, and revalidated by ETag:
    // an unchanged artifact costs a 304 (release readiness §6.4).
    if (request.url === "/content") {
      const { body, etag } = contentBody();
      const headers = {
        "cache-control": "no-cache",
        etag,
        "x-content-type-options": "nosniff",
        ...origins.corsHeaders(request.headers.origin),
      };
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, headers);
        response.end();
        return true;
      }
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", ...headers });
      response.end(body);
      return true;
    }
    if (request.url === "/.well-known/security.txt") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
      response.end(securityTxt());
      return true;
    }
    if (request.url === TELEMETRY_PATH) {
      if (options.telemetry?.endpoint !== true) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "telemetry is not enabled" }));
        return true;
      }
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ rooms: liveRoomSummaries() }));
      return true;
    }
    // The driver's path is answered here rather than left to Colyseus, whose
    // bare 404 would not say that the endpoint is absent.
    if (request.url?.startsWith("/__test__") === true) {
      if (handleTestDrive === undefined) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "the test driver is not mounted" }));
        return true;
      }
      void handleTestDrive(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      });
      return true;
    }
    // Everything else is Colyseus's: matchmaking, and its 404 for the rest.
    return false;
  };

  // Node checks its timeouts on a sweep, every 30 s by default; a second keeps
  // the limit close to what it says.
  const httpServer: HttpServer = createServer({
    requestTimeout,
    headersTimeout: requestTimeout,
    connectionsCheckingInterval: Math.min(1_000, requestTimeout),
  });

  // A fixed course seed makes an end-to-end run reproducible. It is read only
  // when the driver is enabled, so a normal deployment generates a fresh
  // course every time.
  const envSeed = Number(process.env["FLOOR_FIFTY_TEST_SEED"] ?? Number.NaN);
  const fixedSeed =
    options.fixedSeed ??
    (driverToken !== undefined && Number.isFinite(envSeed) ? envSeed : undefined);

  const gameServer = new Server({
    // The frame cap is ws's default today; pinned so an upgrade cannot move it (§6.1).
    transport: new WebSocketTransport({ server: httpServer, maxPayload: WS_MAX_PAYLOAD_BYTES }),
    // Colyseus would otherwise take SIGTERM itself and disconnect every room
    // at once, ending the races a deploy's drain exists to let finish. The
    // entry points own the signal instead (`drain.ts`).
    gracefullyShutdown: false,
  });
  createAppConfig({
    contentStore: options.contentStore,
    ...(fixedSeed === undefined ? {} : { fixedSeed }),
    ...(options.telemetry === undefined
      ? {}
      : { telemetry: { ...options.telemetry, ...(telemetryLog === undefined ? {} : { log: telemetryLog }), tickCost: (ms: number) => tickCosts.add(ms) } }),
    isDraining: () => draining,
    maxRooms,
    maxRoomsPerAddress: options.maxRoomsPerAddress ?? (driven ? Number.POSITIVE_INFINITY : MAX_ROOMS_PER_ADDRESS),
  }).initializeGameServer(gameServer);

  // Loaded only when a token asks for it, so a production bundle carries the
  // driver in a chunk nothing imports (release readiness §6.6).
  handleTestDrive =
    driverToken === undefined || driverToken === ""
      ? undefined
      : (await import("./rooms/room-driver")).createColyseusTestDriver(driverToken);

  await gameServer.listen(options.port ?? 0);

  // Matchmaking's CORS follows the same list as /content. The router merges
  // these over its defaults, whose capitalised allow-origin is "*", so an
  // unlisted origin gets that header blanked rather than left out.
  matchMaker.controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get("origin") ?? undefined;
    if (origins.allows(undefined)) return { "Access-Control-Allow-Origin": origin ?? "*" };
    return { "Access-Control-Allow-Origin": origins.allows(origin) ? origin! : "", Vary: "Origin" };
  };

  // Every socket upgrade passes the origin list and the socket caps before
  // the transport sees it (§6.1, §6.5). Wrapped like the request listeners
  // below, rather than through the transport's `beforeUpgrade`, because the
  // count needs to see each socket close.
  const upgradeListeners = httpServer.listeners("upgrade") as ((
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void)[];
  httpServer.removeAllListeners("upgrade");
  httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!origins.allows(request.headers.origin)) {
      logRefused("origin");
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const ip = addressOf(request);
    if (!sockets.admit(ip)) {
      logRefused("sockets");
      socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    socket.once("close", () => sockets.release(ip));
    for (const listener of upgradeListeners) listener.call(httpServer, request, socket, head);
  });

  // Colyseus 0.18 binds a router at `listen()` that answers every path, with a
  // 404 for those it does not know. Running it beside ours answered our routes
  // twice, so its listeners now run only for what ours leaves.
  // A server driven by the browser suite opens rooms faster than any player;
  // it is never production (process-safety.ts refuses the token there).
  const gate = createMatchmakeGate({
    clientIp: addressOf,
    isDraining: () => draining,
    serverBuildId: buildId,
    origins,
    rateLimits: handleTestDrive === undefined,
    onRefused: logRefused,
    bodyTimeoutMs: requestTimeout,
  });
  const colyseusListeners = httpServer.listeners("request") as RequestListener[];
  httpServer.removeAllListeners("request");
  httpServer.on("request", (request, response) => {
    if (answerOwnRoute(request, response)) return;
    gate(request, response).then(
      (refused) => {
        if (refused) return;
        // Inside the request's context, so a room it opens knows who asked (audit B1).
        withRoomOwner(addressOf(request), () => {
          for (const listener of colyseusListeners) listener.call(httpServer, request, response);
        });
      },
      // The client went away while sending its request; there is no one to answer.
      () => response.destroy(),
    );
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  // The live room count, once a minute, so the report can name the week's peak (§7.3), and
  // the minute's tick costs across every room, which the watch Worker keeps past Fly's buffer.
  const roomsLog = setInterval(() => {
    telemetryLog?.(JSON.stringify({ event: "rooms", live: liveRooms.size }));
    const minute = tickCosts.take();
    if (minute !== undefined) telemetryLog?.(JSON.stringify({ event: "ticks", ...minute }));
  }, options.roomsLogEveryMs ?? 60_000);
  roomsLog.unref();

  let shutDown: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    gate.stop();
    clearInterval(roomsLog);
    clearInterval(refusalFlush);
    refusals?.flush(true);
    return (shutDown ??= gameServer.gracefullyShutdown(false));
  };
  let drained: Promise<DrainResult> | undefined;

  return {
    port,
    gameServer,
    close: shutdown,
    drain(capMs = DRAIN_MAX_MS) {
      if (!draining) {
        draining = true;
        // Every room hears it once: lobbies move on now, races finish first.
        // One room that cannot hear it never keeps the rest from hearing.
        for (const room of [...liveRooms]) {
          try {
            room.beginDrain();
          } catch (error) {
            telemetryLog?.(JSON.stringify({ event: "drain-failed", class: error instanceof Error ? error.name : typeof error }));
          }
        }
      }
      drained ??= waitForRoomsToEmpty({
        countRooms: async () => (await matchMaker.query({})).length,
        capMs,
      }).then(async (result) => {
        await shutdown();
        return result;
      });
      return drained;
    },
  };
}
