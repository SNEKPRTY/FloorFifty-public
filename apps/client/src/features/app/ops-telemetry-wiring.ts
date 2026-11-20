/**
 * Which client moments become operational events (release readiness §7.1):
 * the socket's life, each room phase, asset failures, a seat given up, and a
 * refusal the player was shown (by its code).
 * Boot and fatal errors are reported where they happen, in `main.ts`.
 */

import type { NetworkPort } from "../net/network";
import type { OpsTelemetry } from "./ops-telemetry";
import type { ErrorChannel } from "../net/error-view";

/**
 * The refusals a player is shown when a join fails; the rest of a room's errors are not about getting in.
 * `UNREACHABLE` is one: a join nothing answered (server down, gateway failing, phone offline) is a failed join too,
 * and on launch day it is the one that says the server, not a code, was the problem (audit S7, S23).
 */
const REFUSALS: ReadonlySet<string> = new Set([
  "VERSION_MISMATCH",
  "ROOM_FULL",
  "ROOM_CLOSED",
  "INVALID_ROOM",
  "SERVER_UPDATING",
  "SERVER_BUSY",
  "RATE_LIMITED",
  "UNREACHABLE",
]);

const SOCKET_STATE = { connected: "open", reconnecting: "reconnect", offline: "close" } as const;

export function wireOpsTelemetry(options: {
  telemetry: OpsTelemetry;
  network: Pick<NetworkPort, "subscribe">;
  errors: ErrorChannel;
}): () => void {
  const { telemetry } = options;
  let lastPhase: string | undefined;

  const unsubscribe = options.network.subscribe({
    onConnectionState: (state) => {
      if (state === "connecting") return;
      telemetry.report({ event: "socket", state: SOCKET_STATE[state] });
    },
    onError: (error) => {
      if (error.detail === "seat-lost") telemetry.report({ event: "socket", state: "gave-up" });
      else if (REFUSALS.has(error.code)) telemetry.report({ event: "refusal", code: error.code });
    },
    onSnapshot: (snapshot) => {
      if (snapshot.phase === lastPhase) return;
      lastPhase = snapshot.phase;
      telemetry.report({ event: "phase", phase: snapshot.phase });
    },
  });
  const unwatch = options.errors.watch((error) => {
    if (error.code === "ASSET_LOAD_FAILED") {
      telemetry.report({ event: "asset-failure", alias: error.detail ?? "assets" });
    }
  });

  return () => {
    unsubscribe();
    unwatch();
  };
}
