/**
 * Everything a matchmaking request passes before Colyseus sees it.
 *
 *   1. A draining server opens no room and seats nobody new; a reconnection
 *      passes (release readiness §5.4).
 *   2. Per-address buckets for opening rooms, taking seats and reconnecting
 *      (§6.1). Find a race takes from both of the first two, since it may
 *      open a room.
 *   3. The body cap and the protocol check (`matchmake-version-gate.ts`).
 *
 * A refusal is `{ code, error }` with Colyseus's CORS headers, the one shape
 * every client reads, and its words come from the shared `refusals.ts`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { matchMaker } from "@colyseus/core";
import { RATE_BUCKET_MAX_KEYS, RATE_LIMITS } from "@floor-fifty/shared/common/constants";
import { originRefusedMessage, rateLimitedMessage, serverUpdatingMessage } from "@floor-fifty/shared/common/refusals";
import { refuseStaleProtocol, writeRefusal } from "../matchmake-version-gate";
import { clientIp } from "./client-ip";
import type { OriginPolicy } from "./origins";
import { TokenBuckets } from "./token-buckets";

type Limit = keyof typeof RATE_LIMITS;

/** Which buckets each matchmaking call takes from. */
const TAKES: Readonly<Record<string, readonly Limit[]>> = {
  create: ["create"],
  // Find a race fills a listed room or opens one: a bucket of its own, wide
  // enough for a family behind one router (Review Focus 2), narrow enough
  // that it opens rooms no faster than Create room.
  joinOrCreate: ["findRace"],
  join: ["join"],
  joinById: ["join"],
  reconnect: ["reconnect"],
};

const CALL = /^\/matchmake\/(\w+)\//;

export type MatchmakeGateOptions = {
  isDraining: () => boolean;
  /** The client origins allowed in; the same list the socket upgrade checks (audit S6). Absent allows every origin. */
  origins?: OriginPolicy;
  serverBuildId: string;
  /** False only for a server with the test driver mounted, which production refuses to start. */
  rateLimits?: boolean;
  /** Hears each refusal by the limit that made it, for the weekly report (§7.3). */
  onRefused?: (limit: string) => void;
  now?: () => number;
  /** Who a request is from; the TCP-peer-or-Caddy rule unless the server runs behind Fly. */
  clientIp?: (request: IncomingMessage) => string;
  /** How long a body may take to arrive; `BODY_TIMEOUT_MS` unless a test asks for less. */
  bodyTimeoutMs?: number;
};

export type MatchmakeGate = {
  /** Answers the request when it is refused, and says whether it did. */
  (request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  /** Stops the bucket sweep, for a server that is closing. */
  stop(): void;
};

const JOIN_BY_ID = /^\/matchmake\/joinById\/([^/?#]+)/;

/**
 * A join by a code no live room holds, or to a full one, logged by that word alone, never the
 * code (audit S23): after a release, a version lock-out cannot otherwise be told
 * from a mistyped code. Colyseus still answers the request.
 */
function noteUnknownRoom(request: IncomingMessage, onRefused: ((limit: string) => void) | undefined): void {
  const code = JOIN_BY_ID.exec(request.url ?? "")?.[1];
  if (code === undefined) return;
  const room = matchMaker.getLocalRoomById(decodeURIComponent(code));
  if (room === undefined) onRefused?.("unknown-room");
  // A full room is locked, and Colyseus refuses its joiner before the room hears of it.
  else if (room.locked) onRefused?.("full");
}

export function createMatchmakeGate(options: MatchmakeGateOptions): MatchmakeGate {
  const bucket = (limit: Limit): TokenBuckets =>
    new TokenBuckets({
      ...RATE_LIMITS[limit],
      maxKeys: RATE_BUCKET_MAX_KEYS,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  const buckets: Record<Exclude<Limit, "telemetry">, TokenBuckets> = {
    create: bucket("create"),
    join: bucket("join"),
    findRace: bucket("findRace"),
    reconnect: bucket("reconnect"),
  };
  const sweep = setInterval(() => {
    for (const each of Object.values(buckets)) each.sweep();
  }, 60_000);
  sweep.unref();

  const gate = (async (request, response) => {
    const call = request.method === "POST" ? CALL.exec(request.url ?? "")?.[1] : undefined;
    const takes = call === undefined ? undefined : TAKES[call];
    if (takes !== undefined) {
      // First, and before any limit is spent: a page that may not use this server
      // must not be able to use up a visitor's allowance either (audit S6).
      if (options.origins !== undefined && !options.origins.allows(request.headers.origin)) {
        options.onRefused?.("origin");
        return writeRefusal(request, response, 403, originRefusedMessage());
      }
      if (options.isDraining() && call !== "reconnect") {
        options.onRefused?.("draining");
        return writeRefusal(request, response, 503, serverUpdatingMessage());
      }
      if (options.rateLimits !== false) {
        const ip = (options.clientIp ?? clientIp)(request);
        // Every bucket is charged, so a refused Find a race still costs a join.
        const allowed = takes.map((limit) => buckets[limit as keyof typeof buckets].take(ip));
        const spent = takes[allowed.indexOf(false)];
        if (spent !== undefined) {
          options.onRefused?.(spent);
          return writeRefusal(request, response, 429, rateLimitedMessage());
        }
      }
    }
    const refused = await refuseStaleProtocol(request, response, options.serverBuildId, options.onRefused, options.bodyTimeoutMs);
    if (!refused && call === "joinById") noteUnknownRoom(request, options.onRefused);
    return refused;
  }) as MatchmakeGate;
  gate.stop = () => clearInterval(sweep);
  return gate;
}
