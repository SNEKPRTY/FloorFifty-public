/**
 * `POST /telemetry`: the client's anonymous operational events (release
 * readiness §7.1).
 *
 * One strict JSON line per event goes to the journal, with no address, and
 * nothing else is kept. Bodies are capped at 2 KB and each address gets a
 * burst of twenty, then one every three seconds. A client ignores every
 * answer, so the answers are only for tests and curl.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  RATE_BUCKET_MAX_KEYS,
  RATE_LIMITS,
  TELEMETRY_BODY_LIMIT_BYTES,
} from "@floor-fifty/shared/common/constants";
import { opsEventSchema } from "@floor-fifty/shared/common/ops-telemetry";
import { clientIp } from "./gate/client-ip";
import type { OriginPolicy } from "./gate/origins";
import { TokenBuckets } from "./gate/token-buckets";
import { readCappedBody, refuseTooLarge } from "./http-body";

export const TELEMETRY_INGEST_PATH = "/telemetry";

export type TelemetryEndpoint = {
  /** Answers a request to the ingest path, and says whether it was one. */
  (request: IncomingMessage, response: ServerResponse): boolean;
};

export function createTelemetryEndpoint(options: {
  write: (line: string) => void;
  origins: OriginPolicy;
  /** False on a server the browser suite drives: its every client is one address. */
  rateLimit?: boolean;
  /** Who a request is from; the TCP-peer-or-Caddy rule unless the server runs behind Fly. */
  clientIp?: (request: IncomingMessage) => string;
  now?: () => number;
  /** How long a body may take to arrive; `BODY_TIMEOUT_MS` unless a test asks for less. */
  bodyTimeoutMs?: number;
}): TelemetryEndpoint {
  const buckets = new TokenBuckets({
    ...RATE_LIMITS.telemetry,
    maxKeys: RATE_BUCKET_MAX_KEYS,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const now = options.now ?? Date.now;

  return (request, response) => {
    if (request.url !== TELEMETRY_INGEST_PATH || request.method !== "POST") return false;
    const headers = {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...options.origins.corsHeaders(request.headers.origin),
    };
    const answer = (status: number): void => {
      response.writeHead(status, headers);
      response.end();
    };

    // The same list as the socket and matchmaking: a page that may not use this
    // server may not write to its journal either (audit S26). First, so a refused
    // page spends no one's allowance.
    if (!options.origins.allows(request.headers.origin)) {
      request.resume();
      answer(403);
      return true;
    }

    if (options.rateLimit !== false && !buckets.take((options.clientIp ?? clientIp)(request))) {
      request.resume();
      answer(429);
      return true;
    }

    readCappedBody(request, TELEMETRY_BODY_LIMIT_BYTES, options.bodyTimeoutMs).then((text) => {
      if (text === undefined) return refuseTooLarge(request, response, headers);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return answer(400);
      }
      const parsed = opsEventSchema.safeParse(body);
      if (!parsed.success) return answer(400);
      // Marked as the client's, so a posted `fatal` is never read as the server's
      // own crash line, which the runbook rolls back on (audit S26).
      options.write(JSON.stringify({ src: "client", t: now(), ...parsed.data }));
      answer(204);
    }, () => response.destroy());
    return true;
  };
}
