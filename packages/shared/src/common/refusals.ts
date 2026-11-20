/**
 * The words of every refusal the server sends before, or instead of, a seat.
 *
 * Clients read the code from these words (`refusalCode` in the client's
 * colyseus-network.ts), because a matchmaking refusal reaches the browser as a
 * message, not a typed code. So the words are wire: change one only with a
 * protocol bump, and never change `protocolMismatchMessage` (schemas.ts),
 * which every old client reads as VERSION_MISMATCH.
 */

import { compareBuildIds, DEV_BUILD_ID, type BuildFacts } from "./build";

export const serverUpdatingMessage = (): string =>
  "SERVER_UPDATING: the server is updating; try again in a minute";

export const serverBusyMessage = (): string => "SERVER_BUSY: the server is full; try again in a minute";

export const rateLimitedMessage = (): string => "RATE_LIMITED: too many requests; slow down";

/** A matchmaking request from a page the server's origin list does not name (audit S6). */
export const originRefusedMessage = (): string => "ORIGIN_REFUSED: this page may not use this server";

export const rulesetMismatchMessage = (client: string, server: string): string =>
  `VERSION_MISMATCH: this client's rules are out of date (${client} against ${server})`;

export type VersionVerdict = "seat" | "skew" | "VERSION_MISMATCH" | "SERVER_UPDATING";

/**
 * How a join is answered (release readiness D-G7): the same protocol and
 * ruleset is seated, even on another build; anything else is refused, and the
 * build order says which side should move.
 */
export function versionVerdict(client: BuildFacts, server: BuildFacts): VersionVerdict {
  // Two dev builds are one checkout: `pnpm dev` swaps content live while the
  // client keeps the ruleset it started with, so only the protocol counts.
  const bothDev = client.buildId === DEV_BUILD_ID && server.buildId === DEV_BUILD_ID;
  const sameRules =
    client.protocolVersion === server.protocolVersion &&
    (bothDev || client.rulesetRevision === server.rulesetRevision);
  if (sameRules) return client.buildId === server.buildId ? "seat" : "skew";
  return compareBuildIds(client.buildId, server.buildId) === 1 ? "SERVER_UPDATING" : "VERSION_MISMATCH";
}
