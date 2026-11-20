/**
 * How a host process wires room telemetry from its environment.
 *
 * Both entry points read the same variable the same way, so production and
 * development cannot disagree about what `FLOOR_FIFTY_TELEMETRY` means.
 *
 * - Anomalies are always written: a stalled timer or a slow tick in production
 *   is exactly what an operator needs to hear about.
 * - `FLOOR_FIFTY_TELEMETRY=1` adds a summary line per room every ten seconds
 *   and mounts `GET /debug/telemetry`.
 */

import type { RoomTelemetryConfig } from "./rooms/race-room";

export function telemetryFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): RoomTelemetryConfig & { endpoint: boolean } {
  const verbose = env["FLOOR_FIFTY_TELEMETRY"] === "1";
  return { log: write, summaries: verbose, endpoint: verbose };
}
