/**
 * Refuses a client on another protocol version at its matchmaking request.
 *
 * The room checks the version too, but Colyseus 0.18 runs a join's check only
 * once the socket opens, after the matchmaking reply. A tab left open across a
 * deploy still runs the old client, which cannot read that reply and would tell
 * its player the room does not exist. Refused here, it gets an HTTP error with
 * `{ code, error }`, the one shape every client reads, and its own words for
 * "protocol version" ask the player to reload.
 *
 * A reconnect carries only its token, never a version, so it passes untouched.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { ErrorCode, matchMaker } from "@colyseus/core";
import { MATCHMAKE_BODY_LIMIT_BYTES, PROTOCOL_VERSION } from "@floor-fifty/shared/common/constants";
import { protocolMismatchMessage } from "@floor-fifty/shared/common/schemas";
import { compareBuildIds } from "@floor-fifty/shared/common/build";
import { serverUpdatingMessage } from "@floor-fifty/shared/common/refusals";
import { SERVER_BUILD } from "./build-facts";
import { readCappedBody, refuseTooLarge } from "./http-body";

/** The matchmaking calls whose options carry the client's protocol version. */
const VERSIONED_MATCHMAKE = /^\/matchmake\/(create|join|joinById|joinOrCreate)\//;

/** Join options are a few hundred bytes; anything far larger is not a join. */
const BODY_LIMIT_BYTES = MATCHMAKE_BODY_LIMIT_BYTES;

function factsOf(body: string): { protocolVersion?: unknown; buildId?: unknown } {
  try {
    return (JSON.parse(body) as { protocolVersion?: unknown; buildId?: unknown } | null) ?? {};
  } catch {
    return {};
  }
}

/**
 * Answers a versioned matchmaking request from another protocol, and says
 * whether it did. Any other request is left to Colyseus, with its body already
 * read into `request.body`, which Colyseus's router reads in place of the
 * stream.
 */
export async function refuseStaleProtocol(
  request: IncomingMessage,
  response: ServerResponse,
  serverBuildId: string = SERVER_BUILD.buildId,
  /** Hears the refusal by its reason, for the weekly report (audit S23). */
  onRefused?: (limit: string) => void,
  /** How long the body may take to arrive; `BODY_TIMEOUT_MS` unless a test asks for less. */
  bodyTimeoutMs?: number,
): Promise<boolean> {
  // Every matchmaking body is read here, once, under the 4 KB cap (release
  // readiness §6.1); only the calls that carry a version are checked for one.
  if (request.method !== "POST" || !(request.url ?? "").startsWith("/matchmake/")) return false;

  const body = await readCappedBody(request, BODY_LIMIT_BYTES, bodyTimeoutMs);
  if (body === undefined) {
    refuseTooLarge(request, response);
    return true;
  }
  (request as IncomingMessage & { body?: string }).body = body;
  if (!VERSIONED_MATCHMAKE.test(request.url ?? "")) return false;

  // A missing or malformed version is the room's to refuse, as before.
  const { protocolVersion: version, buildId } = factsOf(body);
  if (typeof version !== "number" || version === PROTOCOL_VERSION) return false;

  // A client newer than this server is mid-rollout or after a rollback: it
  // should wait, not reload (release readiness D-G7). Only a client that sends
  // its build can be newer; every older client still reads "protocol version".
  const newer = typeof buildId === "string" && compareBuildIds(buildId, serverBuildId) === 1;

  onRefused?.(newer ? "updating" : "protocol");
  writeRefusal(request, response, 400, newer ? serverUpdatingMessage() : protocolMismatchMessage(version));
  return true;
}

/**
 * A matchmaking refusal in the one shape every client reads, `{ code, error }`,
 * with Colyseus's own CORS headers so a listed origin can read it. Every
 * refusal before Colyseus -- protocol, drain, rate -- is written here.
 */
export function writeRefusal(request: IncomingMessage, response: ServerResponse, status: number, error: string): true {
  response.writeHead(status, {
    ...matchMaker.controller.DEFAULT_CORS_HEADERS,
    ...matchMaker.controller.getCorsHeaders(new Headers(request.headers as Record<string, string>)),
    "content-type": "application/json",
  });
  response.end(JSON.stringify({ code: ErrorCode.AUTH_FAILED, error }));
  return true;
}
